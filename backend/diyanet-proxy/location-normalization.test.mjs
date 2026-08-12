import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLocationSearchTerms,
  nameMatchScore,
  normalizedCountryHints,
  normalizeText
} from "./location-normalization.mjs";

test("folds Turkish characters without losing letters", () => {
  assert.equal(normalizeText("Bayraklı"), normalizeText("Bayrakli"));
  assert.equal(normalizeText("BEYŞEHİR"), normalizeText("Beysehir"));
  assert.equal(normalizeText("İzmir"), normalizeText("Izmir"));
});

test("folds common Latin compatibility characters", () => {
  const pairs = [
    ["São Paulo", "Sao Paulo"],
    ["Łódź", "Lodz"],
    ["München", "Munchen"],
    ["København", "Kobenhavn"],
    ["Straße", "Strasse"],
    ["Œiras", "Oeiras"]
  ];

  for (const [localized, ascii] of pairs) {
    assert.equal(normalizeText(localized), normalizeText(ascii), `${localized} should match ${ascii}`);
  }
});

test("keeps names from non-Latin scripts comparable", () => {
  assert.equal(normalizeText("Αθήνα"), normalizeText("ΑΘΗΝΑ"));
  assert.equal(normalizeText("القاهرة"), "القاهرة");
  assert.equal(normalizeText("Москва"), normalizeText("МОСКВА"));
});

test("builds original and folded upstream search terms", () => {
  assert.deepEqual(buildLocationSearchTerms("Bayraklı"), ["Bayraklı", "bayrakli"]);
  assert.deepEqual(buildLocationSearchTerms("São Paulo"), ["São Paulo", "sao paulo"]);
});

test("matches localized and ASCII city names", () => {
  assert.equal(nameMatchScore("BAYRAKLI", ["Bayraklı"]), 100);
  assert.equal(nameMatchScore("BEYŞEHİR", ["Beysehir"]), 100);
  assert.ok(nameMatchScore("Amsterdam Centrum", ["Amsterdam"]) >= 65);
});

test("derives localized country aliases from an ISO code", () => {
  const turkeyHints = normalizedCountryHints("TR", "Turkey");
  assert.ok(turkeyHints.includes("turkiye"));
  assert.ok(turkeyHints.includes("turkey"));

  const inferredTurkeyHints = normalizedCountryHints("", "Turkey");
  assert.ok(inferredTurkeyHints.includes("turkiye"));

  const netherlandsHints = normalizedCountryHints("NL", "Nederland");
  assert.ok(netherlandsHints.includes("netherlands"));
  assert.ok(netherlandsHints.includes("nederland"));
});
