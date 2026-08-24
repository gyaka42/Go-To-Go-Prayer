import assert from "node:assert/strict";
import test from "node:test";
import { createFaithRetriever, loadFaithKnowledge, normalizeForFaithSearch } from "./faith-retrieval.mjs";

test("faith knowledge loads only approved sources and reviewed passages", () => {
  const knowledge = loadFaithKnowledge();
  const retriever = createFaithRetriever({ knowledge });

  assert.equal(retriever.status().ready, true);
  assert.equal(retriever.status().passageCount, 12);
  assert.ok(knowledge.corpus.passages.every((passage) => passage.summary && !passage.excerpt));
});

test("topic classifier handles Dutch, Turkish and deterministic app tools", () => {
  const retriever = createFaithRetriever();

  assert.equal(retriever.classify("Kan ik Dhuhr en Asr combineren?").topicId, "travel_prayer");
  assert.equal(retriever.classify("Hanefiyim, öğle ile ikindiyi birleştirebilir miyim?").topicId, "travel_prayer");
  assert.equal(retriever.classify("Hoe laat is Fajr vandaag?").kind, "deterministic_tool");
  assert.equal(retriever.classify("Kun je mijn echtscheiding beoordelen?").kind, "qualified_referral");
  assert.equal(retriever.classify("How do I fix a JavaScript error?").kind, "out_of_scope");
});

test("retrieval finds exact evidence and refuses weak topical matches", () => {
  const retriever = createFaithRetriever();

  const combine = retriever.retrieve({
    question: "Ik ben Hanafi. Mag ik Dhuhr en Asr combineren tijdens een reis?",
    perspective: "hanafi"
  });
  assert.equal(combine.classification.topicId, "travel_prayer");
  assert.ok(combine.passages.some((passage) => passage.id === "diyanet-combining-prayers"));
  assert.ok(combine.passages.every((passage) => passage.perspectives.includes("hanafi")));

  const unsupported = retriever.retrieve({
    question: "Does sleeping invalidate wudu?",
    perspective: "general_sunni"
  });
  assert.equal(unsupported.classification.topicId, "ritual_purity");
  assert.deepEqual(unsupported.passages, []);

  const dua = retriever.retrieve({
    question: "How should I make dua?",
    perspective: "general_sunni"
  });
  assert.ok(dua.passages.some((passage) => passage.id === "diyanet-dua-etiquette"));
});

test("faith search normalization folds Turkish characters", () => {
  assert.equal(normalizeForFaithSearch("Öğle ile İkindi birleştirilir mi?"), "ogle ile ikindi birlestirilir mi");
});
