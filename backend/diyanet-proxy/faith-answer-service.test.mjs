import assert from "node:assert/strict";
import test from "node:test";
import { createFaithAnswerService } from "./faith-answer-service.mjs";
import { createFaithRetriever } from "./faith-retrieval.mjs";

function mockGroq(data) {
  const calls = [];
  return {
    calls,
    async createStructuredCompletion(input) {
      calls.push(input);
      return {
        data,
        meta: { requestId: "groq-request-1" }
      };
    }
  };
}

test("source-bound generation maps citations from server-owned metadata", async () => {
  let providerQuotaCalls = 0;
  const groq = mockGroq({
    outcome: "answer",
    answer: "De algemene Hanafi-regel is dat ieder gebed binnen zijn eigen tijd wordt verricht. De geciteerde bron beschrijft uitzonderingen bij een belangrijke noodzaak.",
    sourceIds: ["diyanet-combining-prayers"],
    caveat: "De reden en je reisstatus kunnen verschil maken.",
    followUpQuestion: "Ben je op reis, en zo ja hoe ver en hoe lang?"
  });
  const service = createFaithAnswerService({ groqClient: groq, retriever: createFaithRetriever() });

  const result = await service.answer(
    {
      question: "Ik ben Hanafi. Mag ik Dhuhr en Asr combineren tijdens een reis?",
      language: "nl",
      perspective: "hanafi"
    },
    { beforeProviderCall: () => { providerQuotaCalls += 1; } }
  );

  assert.equal(result.outcome, "answer");
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0].id, "diyanet-combining-prayers");
  assert.match(result.citations[0].url, /^https:\/\/kurul\.diyanet\.gov\.tr\//);
  assert.equal(result.meta.providerRequestId, "groq-request-1");
  assert.equal(groq.calls.length, 1);
  assert.equal(providerQuotaCalls, 1);
  assert.match(groq.calls[0].messages[0].content, /Model memory.*forbidden/);
  assert.match(groq.calls[0].messages[0].content, /multi-part question/);
});

test("invented citations turn a generated answer into insufficient sources", async () => {
  const groq = mockGroq({
    outcome: "answer",
    answer: "Invented answer",
    sourceIds: ["made-up-source"],
    caveat: null,
    followUpQuestion: null
  });
  const service = createFaithAnswerService({ groqClient: groq, retriever: createFaithRetriever() });

  const result = await service.answer({
    question: "Can I combine Dhuhr and Asr while travelling?",
    language: "en",
    perspective: "hanafi"
  });

  assert.equal(result.outcome, "insufficient_sources");
  assert.deepEqual(result.citations, []);
});

test("generated clarification without a supplied source fails closed", async () => {
  const groq = mockGroq({
    outcome: "clarification_needed",
    answer: "First clarify whether you are travelling.",
    sourceIds: [],
    caveat: null,
    followUpQuestion: "Are you currently travelling?"
  });
  const service = createFaithAnswerService({ groqClient: groq, retriever: createFaithRetriever() });

  const result = await service.answer({
    question: "Can I combine Dhuhr and Asr while travelling?",
    language: "en",
    perspective: "hanafi"
  });

  assert.equal(result.outcome, "insufficient_sources");
  assert.deepEqual(result.citations, []);
});

test("out-of-scope, referral and unsupported evidence never call Groq", async () => {
  const groq = mockGroq({});
  const service = createFaithAnswerService({ groqClient: groq, retriever: createFaithRetriever() });
  let providerQuotaCalls = 0;
  const hooks = { beforeProviderCall: () => { providerQuotaCalls += 1; } };

  const coding = await service.answer({
    question: "How do I fix a JavaScript error?",
    language: "en",
    perspective: "general_sunni"
  }, hooks);
  const divorce = await service.answer({
    question: "Kun je mijn echtscheiding beoordelen?",
    language: "nl",
    perspective: "general_sunni"
  }, hooks);
  const unsupported = await service.answer({
    question: "Does nail polish invalidate wudu?",
    language: "en",
    perspective: "general_sunni"
  }, hooks);

  assert.equal(coding.outcome, "out_of_scope");
  assert.equal(divorce.outcome, "qualified_referral");
  assert.equal(unsupported.outcome, "insufficient_sources");
  assert.equal(groq.calls.length, 0);
  assert.equal(providerQuotaCalls, 0);
});

test("local boundary answers stay in the requested language", async () => {
  const groq = mockGroq({});
  const service = createFaithAnswerService({ groqClient: groq, retriever: createFaithRetriever() });
  const cases = [
    {
      language: "en",
      question: "How do I repair a JavaScript build?",
      expected: "I can only help with the supported Islamic faith and worship topics"
    },
    {
      language: "nl",
      question: "Hoe repareer ik een JavaScript-build?",
      expected: "Ik kan in deze eerste versie alleen helpen met de ondersteunde islamitische"
    },
    {
      language: "tr",
      question: "JavaScript derleme hatasını nasıl düzeltirim?",
      expected: "Bu ilk sürümde yalnızca desteklenen İslami inanç ve ibadet"
    }
  ];

  for (const row of cases) {
    const result = await service.answer({
      question: row.question,
      language: row.language,
      perspective: "general_sunni"
    });
    assert.equal(result.outcome, "out_of_scope");
    assert.match(result.answer, new RegExp(row.expected));
  }
  assert.equal(groq.calls.length, 0);
});

test("generated requests explicitly select English, Dutch and Turkish", async () => {
  const rows = [
    { language: "en", question: "Can I combine Dhuhr and Asr while travelling?", languageName: "English" },
    { language: "nl", question: "Mag ik Dhuhr en Asr combineren tijdens een reis?", languageName: "Dutch" },
    { language: "tr", question: "Yolculukta öğle ve ikindi namazlarını birleştirebilir miyim?", languageName: "Turkish" }
  ];

  for (const row of rows) {
    const groq = mockGroq({
      outcome: "answer",
      answer: "Source-bound test answer.",
      sourceIds: ["diyanet-combining-prayers"],
      caveat: null,
      followUpQuestion: null
    });
    const service = createFaithAnswerService({ groqClient: groq, retriever: createFaithRetriever() });
    await service.answer({ question: row.question, language: row.language, perspective: "hanafi" });
    assert.equal(groq.calls.length, 1);
    assert.match(groq.calls[0].messages[0].content, new RegExp(`Answer in ${row.languageName}`));
  }
});
