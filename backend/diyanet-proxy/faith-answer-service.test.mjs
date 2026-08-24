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
  const groq = mockGroq({
    outcome: "answer",
    answer: "De algemene Hanafi-regel is dat ieder gebed binnen zijn eigen tijd wordt verricht. De geciteerde bron beschrijft uitzonderingen bij een belangrijke noodzaak.",
    sourceIds: ["diyanet-combining-prayers"],
    caveat: "De reden en je reisstatus kunnen verschil maken.",
    followUpQuestion: "Ben je op reis, en zo ja hoe ver en hoe lang?"
  });
  const service = createFaithAnswerService({ groqClient: groq, retriever: createFaithRetriever() });

  const result = await service.answer({
    question: "Ik ben Hanafi. Mag ik Dhuhr en Asr combineren tijdens een reis?",
    language: "nl",
    perspective: "hanafi"
  });

  assert.equal(result.outcome, "answer");
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0].id, "diyanet-combining-prayers");
  assert.match(result.citations[0].url, /^https:\/\/kurul\.diyanet\.gov\.tr\//);
  assert.equal(result.meta.providerRequestId, "groq-request-1");
  assert.equal(groq.calls.length, 1);
  assert.match(groq.calls[0].messages[0].content, /Model memory.*forbidden/);
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

test("out-of-scope, referral and unsupported evidence never call Groq", async () => {
  const groq = mockGroq({});
  const service = createFaithAnswerService({ groqClient: groq, retriever: createFaithRetriever() });

  const coding = await service.answer({
    question: "How do I fix a JavaScript error?",
    language: "en",
    perspective: "general_sunni"
  });
  const divorce = await service.answer({
    question: "Kun je mijn echtscheiding beoordelen?",
    language: "nl",
    perspective: "general_sunni"
  });
  const sleep = await service.answer({
    question: "Does sleeping invalidate wudu?",
    language: "en",
    perspective: "general_sunni"
  });

  assert.equal(coding.outcome, "out_of_scope");
  assert.equal(divorce.outcome, "qualified_referral");
  assert.equal(sleep.outcome, "insufficient_sources");
  assert.equal(groq.calls.length, 0);
});
