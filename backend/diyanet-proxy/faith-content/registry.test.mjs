import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = new URL("./", import.meta.url);

async function readJson(name) {
  return JSON.parse(await readFile(new URL(name, directory), "utf8"));
}

test("V1 faith policy has stable languages, perspectives and outcomes", async () => {
  const policy = await readJson("v1-policy.json");

  assert.equal(policy.policyId, "faith-assistant-v1");
  assert.deepEqual(policy.supportedLanguages, ["en", "nl", "tr"]);
  assert.deepEqual(policy.supportedPerspectives, ["general_sunni", "hanafi"]);
  assert.equal(policy.rules.defaultDeny, true);
  assert.equal(policy.rules.noSourceMeansNoAnswer, true);
  assert.equal(policy.rules.generalSourceMayNotBeRelabelledAsHanafi, true);
  assert.equal(policy.rules.personalisedFatwasAllowed, false);

  const outcomes = new Set(policy.responseOutcomes);
  for (const outcome of ["answer", "clarification_needed", "insufficient_sources", "out_of_scope", "qualified_referral"]) {
    assert.ok(outcomes.has(outcome), `missing response outcome: ${outcome}`);
  }
});

test("source registry is deny-by-default and has unique, valid entries", async () => {
  const registry = await readJson("source-registry.json");

  assert.equal(registry.defaultPolicy, "deny");
  assert.ok(Array.isArray(registry.sources) && registry.sources.length > 0);

  const ids = new Set();
  for (const source of registry.sources) {
    assert.ok(!ids.has(source.id), `duplicate source id: ${source.id}`);
    ids.add(source.id);

    assert.ok(registry.allowedReviewStates.includes(source.reviewState), `invalid review state: ${source.id}`);
    assert.match(source.url, /^https:\/\//, `source URL must use HTTPS: ${source.id}`);
    assert.ok(Array.isArray(source.allowedUses), `allowedUses must be an array: ${source.id}`);
    assert.ok(Array.isArray(source.forbiddenUses), `forbiddenUses must be an array: ${source.id}`);
    assert.ok(Array.isArray(source.citationRequirements) && source.citationRequirements.length > 0, `citation requirements missing: ${source.id}`);
    assert.ok(source.rights?.status, `rights status missing: ${source.id}`);

    if (source.runtimeEnabled) {
      assert.equal(source.reviewState, "approved", `runtime source must be approved: ${source.id}`);
      assert.ok(source.allowedUses.length > 0, `runtime source needs an allowed use: ${source.id}`);
    } else {
      assert.equal(source.allowedUses.length, 0, `disabled source cannot expose allowed uses: ${source.id}`);
    }
  }
});

test("only explicit evidence can support the Hanafi perspective", async () => {
  const registry = await readJson("source-registry.json");
  const hanafiSources = registry.sources.filter((source) => source.perspectives.some((value) => value.includes("hanafi")));

  assert.ok(hanafiSources.length > 0, "at least one source must define the Hanafi evidence path");
  for (const source of hanafiSources) {
    const explicitlyHanafi = source.perspectives.includes("hanafi");
    const explicitlyQualified = source.perspectives.includes("hanafi_when_explicit");
    assert.ok(explicitlyHanafi || explicitlyQualified, `ambiguous Hanafi source: ${source.id}`);
  }
});
