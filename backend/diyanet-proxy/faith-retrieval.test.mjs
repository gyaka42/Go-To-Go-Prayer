import assert from "node:assert/strict";
import test from "node:test";
import { createFaithRetriever, loadFaithKnowledge, normalizeForFaithSearch } from "./faith-retrieval.mjs";

test("faith knowledge loads only approved sources and reviewed passages", () => {
  const knowledge = loadFaithKnowledge();
  const retriever = createFaithRetriever({ knowledge });

  assert.equal(retriever.status().ready, true);
  assert.equal(retriever.status().passageCount, 69);
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
    question: "Does nail polish invalidate wudu?",
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

test("practical prayer retrieval supports compound questions in every app language", () => {
  const retriever = createFaithRetriever();
  const rows = [
    "My mind wandered during prayer and I forgot which surah to recite.",
    "Tijdens het gebed raakte ik afgeleid en vergat ik welke soera ik moest lezen.",
    "Namaz kılarken bir anda dünyevi şeyler aklıma geldi ve okuyacağım sureyi unuttum, ne yapmam lazım?"
  ];

  for (const question of rows) {
    const result = retriever.retrieve({ question, perspective: "general_sunni" });
    const passageIds = new Set(result.passages.map((passage) => passage.id));
    assert.equal(result.classification.kind, "allowed");
    assert.ok(passageIds.has("diyanet-prayer-worldly-thoughts"), question);
    assert.ok(passageIds.has("diyanet-forgot-supplementary-surah"), question);
  }
});

test("common Islamic essentials retrieve evidence in both answer perspectives", () => {
  const retriever = createFaithRetriever();
  const rows = [
    ["Akşam namazı nasıl kılınır?", "diyanet-maghrib-prayer-method"],
    ["İslamın şartı kaç?", "diyanet-islam-meaning-and-five-pillars"],
    ["Öğlen namazı kaç rekat?", "diyanet-five-daily-prayers-and-rakats"]
  ];

  for (const perspective of ["general_sunni", "hanafi"]) {
    for (const [question, expectedPassageId] of rows) {
      const result = retriever.retrieve({ question, perspective });
      assert.equal(result.classification.kind, "allowed", `${perspective}: ${question}`);
      assert.ok(
        result.passages.some((passage) => passage.id === expectedPassageId),
        `${perspective}: ${question}`
      );
    }
  }
});

test("broad Islamic knowledge questions retrieve reviewed evidence in every app language", () => {
  const retriever = createFaithRetriever();
  const rows = [
    ["How many verses are in the Quran?", "diyanet-quran-ayah-count"],
    ["Hoeveel ayat staan er in de Koran?", "diyanet-quran-ayah-count"],
    ["Kuranda kac ayet var?", "diyanet-quran-ayah-count"],
    ["Must the Quran be read with tajweed?", "diyanet-tajwid-recitation-basics"],
    ["Moet je de Koran met tajwid lezen?", "diyanet-tajwid-recitation-basics"],
    ["Tevcidli okumak farz mi?", "diyanet-tajwid-recitation-basics"],
    ["Which kandil nights are observed?", "diyanet-blessed-nights-kandils"],
    ["Welke kandilnachten zijn er?", "diyanet-blessed-nights-kandils"],
    ["Hangi kandiller var?", "diyanet-blessed-nights-kandils"],
    ["What are the 32 fards?", "diyanet-thirty-two-fards-framework"],
    ["Wat zijn de 32 farz?", "diyanet-thirty-two-fards-framework"],
    ["32 farzi soyler misin?", "diyanet-thirty-two-fards-framework"]
  ];

  for (const [question, expectedPassageId] of rows) {
    const result = retriever.retrieve({ question, perspective: "general_sunni" });
    assert.equal(result.classification.kind, "allowed", question);
    assert.ok(result.passages.some((passage) => passage.id === expectedPassageId), question);
  }
});

test("general Islamic detection broadens scope without inventing evidence", () => {
  const retriever = createFaithRetriever();
  const islamic = retriever.retrieve({
    question: "Is wearing a red shirt haram?",
    perspective: "general_sunni"
  });
  assert.equal(islamic.classification.kind, "allowed");
  assert.equal(islamic.classification.topicId, "islamic_general");
  assert.deepEqual(islamic.passages, []);

  for (const question of ["Başörtü farz mı?", "Mezarda ne olur?", "Is celebrating a religious night permissible?"]) {
    const result = retriever.retrieve({ question, perspective: "general_sunni" });
    assert.equal(result.classification.kind, "allowed", question);
  }

  const unrelated = retriever.retrieve({
    question: "How do I fix a JavaScript error?",
    perspective: "general_sunni"
  });
  assert.equal(unrelated.classification.kind, "out_of_scope");
  assert.deepEqual(unrelated.passages, []);
});

test("specific prayer forms do not fall back to the generic prayer method", () => {
  const retriever = createFaithRetriever();
  const rows = [
    ["Bayram namazı nasıl kılınır?", "diyanet-eid-prayer-method"],
    ["Cenaze namazı nasıl kılınır?", "diyanet-funeral-prayer-method"]
  ];

  for (const [question, expectedPassageId] of rows) {
    const result = retriever.retrieve({ question, perspective: "general_sunni" });
    const passageIds = result.passages.map((passage) => passage.id);
    assert.ok(passageIds.includes(expectedPassageId), question);
    assert.ok(!passageIds.includes("diyanet-basic-prayer-structure"), question);
  }
});

test("Hanafi retrieval remains restricted to explicitly tagged evidence", () => {
  const retriever = createFaithRetriever();
  const result = retriever.retrieve({
    question: "Hanefi olarak namazda güldüm. Namazım ve abdestim bozuldu mu?",
    perspective: "hanafi"
  });

  assert.ok(result.passages.some((passage) => passage.id === "diyanet-laughing-in-prayer"));
  assert.ok(result.passages.every((passage) => passage.perspectives.includes("hanafi")));

  const compound = retriever.retrieve({
    question: "Hanefi olarak namazda aklıma dünyevi şeyler geldi ve Fatiha sonrası sureyi unuttum. Ne yapmalıyım?",
    perspective: "hanafi"
  });
  assert.ok(compound.passages.some((passage) => passage.id === "diyanet-fatiha-only-prayer"));
  assert.ok(compound.passages.every((passage) => passage.perspectives.includes("hanafi")));
});

test("faith search normalization folds Turkish characters", () => {
  assert.equal(normalizeForFaithSearch("Öğle ile İkindi birleştirilir mi?"), "ogle ile ikindi birlestirilir mi");
});
