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

function mockGroqSequence(...responses) {
  const calls = [];
  return {
    calls,
    async createStructuredCompletion(input) {
      calls.push(input);
      const data = responses[Math.min(calls.length - 1, responses.length - 1)];
      return { data, meta: { requestId: `groq-request-${calls.length}` } };
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
  assert.equal(result.meta.answerMode, "sourced");
  assert.equal(groq.calls.length, 1);
  assert.equal(providerQuotaCalls, 1);
  assert.match(groq.calls[0].messages[0].content, /Model memory.*forbidden/);
  assert.match(groq.calls[0].messages[0].content, /multi-part question/);
});

test("invalid general Sunni sourced citations fall back to labelled general AI without citations", async () => {
  let providerQuotaCalls = 0;
  let additionalProviderQuotaCalls = 0;
  const groq = mockGroqSequence(
    {
      outcome: "answer",
      answer: "Invented sourced answer",
      sourceIds: ["made-up-source"],
      caveat: null,
      followUpQuestion: null
    },
    {
      outcome: "answer",
      answer: "General educational answer without a claimed source.",
      sourceIds: [],
      caveat: null,
      followUpQuestion: null
    }
  );
  const service = createFaithAnswerService({ groqClient: groq, retriever: createFaithRetriever() });

  const result = await service.answer({
    question: "Can I combine Dhuhr and Asr while travelling?",
    language: "en",
    perspective: "general_sunni"
  }, {
    beforeProviderCall: () => { providerQuotaCalls += 1; },
    beforeAdditionalProviderCall: () => { additionalProviderQuotaCalls += 1; }
  });

  assert.equal(result.outcome, "answer");
  assert.equal(result.meta.answerMode, "general_ai");
  assert.deepEqual(result.citations, []);
  assert.equal(groq.calls.length, 2);
  assert.equal(providerQuotaCalls, 1);
  assert.equal(additionalProviderQuotaCalls, 1);
});

test("source clarification without evidence switches to general clarification", async () => {
  const groq = mockGroqSequence(
    {
      outcome: "clarification_needed",
      answer: "First clarify whether you are travelling.",
      sourceIds: [],
      caveat: null,
      followUpQuestion: "Are you currently travelling?"
    },
    {
      outcome: "clarification_needed",
      answer: "Your circumstances can affect the general answer.",
      sourceIds: [],
      caveat: null,
      followUpQuestion: "Are you currently travelling?"
    }
  );
  const service = createFaithAnswerService({ groqClient: groq, retriever: createFaithRetriever() });

  const result = await service.answer({
    question: "Can I combine Dhuhr and Asr while travelling?",
    language: "en",
    perspective: "general_sunni"
  });

  assert.equal(result.outcome, "clarification_needed");
  assert.equal(result.meta.answerMode, "clarification");
  assert.deepEqual(result.citations, []);
  assert.equal(groq.calls.length, 2);
});

test("out-of-scope and referral boundaries never call Groq", async () => {
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
  assert.equal(coding.outcome, "out_of_scope");
  assert.equal(divorce.outcome, "qualified_referral");
  assert.equal(groq.calls.length, 0);
  assert.equal(providerQuotaCalls, 0);
});

test("an allowed general Sunni question without evidence uses labelled general AI", async () => {
  let providerQuotaCalls = 0;
  const groq = mockGroq({
    outcome: "answer",
    answer: "Wearing the headscarf is generally treated as a religious obligation, while personal circumstances can require qualified guidance.",
    sourceIds: ["invented-source-must-be-ignored"],
    caveat: null,
    followUpQuestion: null
  });
  const service = createFaithAnswerService({ groqClient: groq, retriever: createFaithRetriever() });
  const result = await service.answer({
    question: "Is wearing a red shirt haram?",
    language: "tr",
    perspective: "general_sunni",
    appContext: {
      dateKey: "2026-08-25",
      times: { Dhuhr: "13:08" }
    }
  }, { beforeProviderCall: () => { providerQuotaCalls += 1; } });

  assert.equal(result.outcome, "answer");
  assert.equal(result.meta.answerMode, "general_ai");
  assert.deepEqual(result.citations, []);
  assert.match(result.caveat, /yapay zeka/i);
  assert.equal(groq.calls.length, 1);
  assert.equal(providerQuotaCalls, 1);
  assert.match(groq.calls[0].messages[0].content, /sourceIds must always be an empty array/);
  assert.doesNotMatch(JSON.stringify(groq.calls[0].messages), /13:08|2026-08-25/);
});

test("Hanafi questions without reviewed evidence fail closed without calling Groq", async () => {
  const groq = mockGroq({
    outcome: "answer",
    answer: "An unsupported Hanafi ruling.",
    sourceIds: [],
    caveat: null,
    followUpQuestion: null
  });
  const retriever = {
    status: () => ({ ready: true, passageCount: 0 }),
    retrieve: () => ({
      classification: { kind: "allowed", topicId: "prayer", topics: [{ id: "prayer" }] },
      passages: []
    })
  };
  const service = createFaithAnswerService({ groqClient: groq, retriever });

  const result = await service.answer({
    question: "Hanefi mezhebinde bu namaz hükmü nedir?",
    language: "tr",
    perspective: "hanafi"
  });

  assert.equal(result.outcome, "insufficient_sources");
  assert.equal(result.meta.answerMode, "boundary");
  assert.equal(groq.calls.length, 0);
});

test("Hanafi sourced failures do not fall back to general AI", async () => {
  const groq = mockGroq({
    outcome: "insufficient_sources",
    answer: "",
    sourceIds: [],
    caveat: null,
    followUpQuestion: null
  });
  const service = createFaithAnswerService({ groqClient: groq, retriever: createFaithRetriever() });

  const result = await service.answer({
    question: "Hanefi bir yolcu namazları cem edebilir mi?",
    language: "tr",
    perspective: "hanafi"
  });

  assert.equal(result.outcome, "insufficient_sources");
  assert.equal(groq.calls.length, 1);
});

test("Fajr and imsak relation is source-backed and never calls Groq in every app language", async () => {
  const groq = mockGroq({});
  const service = createFaithAnswerService({ groqClient: groq, retriever: createFaithRetriever() });
  const cases = [
    { language: "en", question: "As a Hanafi, should I pray Fajr before imsak?", marker: /begins at true dawn/i },
    { language: "nl", question: "Moet ik als Hanafi Fajr vóór imsak bidden?", marker: /begint bij de ware dageraad/i },
    { language: "tr", question: "Hanefi mezhebine göre Sabah namazı imsak'tan önce mi kılınmalı?", marker: /imsak vaktinin girmesiyle başlar/i }
  ];

  for (const row of cases) {
    const result = await service.answer({
      question: row.question,
      language: row.language,
      perspective: "hanafi"
    });
    assert.equal(result.outcome, "answer");
    assert.equal(result.meta.answerMode, "sourced");
    assert.equal(result.meta.providerRequestId, null);
    assert.equal(result.citations[0]?.id, "diyanet-fajr-starts-at-imsak");
    assert.match(result.answer, row.marker);
  }

  assert.equal(groq.calls.length, 0);
});

test("general AI can ask a clarifying question without citations", async () => {
  const groq = mockGroq({
    outcome: "clarification_needed",
    answer: "Sorunuzu biraz daha ayrıntılı belirtin.",
    sourceIds: [],
    caveat: null,
    followUpQuestion: "Tesettür hakkında hangi konuyu öğrenmek istiyorsunuz?"
  });
  const service = createFaithAnswerService({ groqClient: groq, retriever: createFaithRetriever() });
  const result = await service.answer({
    question: "Tesettür",
    language: "tr",
    perspective: "general_sunni"
  });

  assert.equal(result.outcome, "clarification_needed");
  assert.equal(result.meta.answerMode, "clarification");
  assert.deepEqual(result.citations, []);
  assert.match(result.followUpQuestion, /hangi konuyu/i);
});

test("current prayer time can be answered from supplied app data without Groq", async () => {
  const groq = mockGroq({});
  const service = createFaithAnswerService({ groqClient: groq, retriever: createFaithRetriever() });
  const result = await service.answer({
    question: "Bugün öğlen namazı vakti?",
    language: "tr",
    perspective: "general_sunni",
    appContext: {
      dateKey: "2026-08-25",
      times: { Fajr: "04:31", Sunrise: "06:10", Dhuhr: "13:08", Asr: "16:54", Maghrib: "20:05", Isha: "21:37" }
    }
  });

  assert.equal(result.outcome, "answer");
  assert.equal(result.meta.answerMode, "app_data");
  assert.match(result.answer, /Öğle 13:08/);
  assert.equal(groq.calls.length, 0);
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

test("the 99 names use the server-owned Diyanet list without calling the provider", async () => {
  const groq = mockGroq({
    outcome: "answer",
    answer: "Allah'ın güzel isimleri kısa ve tamamlanmış bir liste halinde verilir.",
    sourceIds: [],
    caveat: null,
    followUpQuestion: null
  });
  const service = createFaithAnswerService({ groqClient: groq, retriever: createFaithRetriever() });

  const result = await service.answer({
    question: "Allah'ın 99 ismini sayabilir misin?",
    language: "tr",
    perspective: "hanafi"
  });

  assert.equal(result.outcome, "answer");
  assert.equal(result.meta.answerMode, "sourced");
  assert.equal(result.citations[0].sourceId, "diyanet-high-board");
  assert.equal(groq.calls.length, 0);
  const names = result.answer.split("\n").filter((line) => /^\d+\. /.test(line));
  assert.equal(names.length, 99);
  assert.equal(new Set(names.map((line) => line.replace(/^\d+\. /, ""))).size, 99);
  assert.match(result.answer, /6\. Es-Selâm/);
  assert.match(result.answer, /99\. Es-Sabûr/);
});
