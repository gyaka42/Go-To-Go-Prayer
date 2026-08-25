import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import {
  faithPublicStatus,
  faithUnavailableResponse,
  resolveFaithRuntimeConfig,
  validateFaithAskInput
} from "./faith-assistant.mjs";
import { HttpBodyError, readJsonBody } from "./http-json.mjs";

const RATE_LIMIT_SECRET = "test-rate-limit-secret-with-32-characters";
const INSTALLATION_ID = "installation-1234567890";

test("Faith Assistant remains fail-closed until configuration and knowledge are ready", () => {
  const disabled = resolveFaithRuntimeConfig({ GROQ_API_KEY: "secret-key" });
  assert.equal(faithPublicStatus(disabled).ready, false);
  assert.equal(faithUnavailableResponse(disabled).payload.code, "faith_assistant_disabled");

  const enabled = resolveFaithRuntimeConfig({
    FAITH_ASSISTANT_ENABLED: "true",
    GROQ_API_KEY: "secret-key",
    FAITH_RATE_LIMIT_SECRET: RATE_LIMIT_SECRET
  });
  assert.equal(faithPublicStatus(enabled).ready, true);
  assert.equal(faithUnavailableResponse(enabled), null);

  const missingKnowledge = resolveFaithRuntimeConfig(
    {
      FAITH_ASSISTANT_ENABLED: "true",
      GROQ_API_KEY: "secret-key",
      FAITH_RATE_LIMIT_SECRET: RATE_LIMIT_SECRET
    },
    { knowledge: { ready: false, status: "load_failed", passageCount: 0 } }
  );
  assert.equal(faithUnavailableResponse(missingKnowledge).payload.code, "faith_sources_not_ready");

  const missingAbuseProtection = resolveFaithRuntimeConfig({
    FAITH_ASSISTANT_ENABLED: "true",
    GROQ_API_KEY: "secret-key"
  });
  assert.equal(
    faithUnavailableResponse(missingAbuseProtection).payload.code,
    "faith_abuse_protection_not_configured"
  );
});

test("Faith Assistant validates and normalizes the public request", () => {
  const result = validateFaithAskInput({
    question: "  Kan ik Dhuhr en Asr combineren?\n",
    language: "NL",
    perspective: "hanafi",
    installationId: INSTALLATION_ID
  });

  assert.deepEqual(result, {
    ok: true,
    value: {
      question: "Kan ik Dhuhr en Asr combineren?",
      language: "nl",
      perspective: "hanafi",
      installationId: INSTALLATION_ID
    }
  });
  assert.equal(validateFaithAskInput({ question: "Hi", language: "nl", installationId: INSTALLATION_ID }).code, "invalid_question");
  assert.equal(
    validateFaithAskInput({ question: "Valid question", language: "de", installationId: INSTALLATION_ID }).code,
    "invalid_language"
  );
  assert.equal(
    validateFaithAskInput({
      question: "Valid question",
      language: "en",
      perspective: "maliki",
      installationId: INSTALLATION_ID
    }).code,
    "invalid_perspective"
  );
  assert.equal(
    validateFaithAskInput({ question: "Valid question", language: "en", installationId: "short" }).code,
    "invalid_installation_id"
  );
  assert.equal(
    validateFaithAskInput({
      question: "x".repeat(801),
      language: "en",
      installationId: INSTALLATION_ID
    }).code,
    "invalid_question"
  );
  assert.equal(validateFaithAskInput([]).code, "invalid_body");

  const cleaned = validateFaithAskInput({
    question: "  Is\u0000 this\n valid?  ",
    language: "en",
    installationId: INSTALLATION_ID
  });
  assert.equal(cleaned.ok, true);
  assert.equal(cleaned.value.question, "Is this valid?");
  assert.equal(cleaned.value.perspective, "general_sunni");
});

test("JSON body reader enforces content type and byte limit", async () => {
  const request = Readable.from([JSON.stringify({ question: "Test" })]);
  request.headers = { "content-type": "application/json; charset=utf-8" };
  assert.deepEqual(await readJsonBody(request, { maxBytes: 128 }), { question: "Test" });

  const oversized = Readable.from(["x".repeat(20)]);
  oversized.headers = { "content-type": "application/json" };
  await assert.rejects(
    () => readJsonBody(oversized, { maxBytes: 10 }),
    (error) => error instanceof HttpBodyError && error.code === "body_too_large" && error.status === 413
  );
});

test("Faith Assistant accepts only minimal valid prayer-time context", () => {
  const result = validateFaithAskInput({
    question: "Bugün öğlen namazı vakti?",
    language: "tr",
    installationId: INSTALLATION_ID,
    appContext: {
      dateKey: "2026-08-25",
      locationLabel: "Beyşehir, Türkiye",
      times: { Dhuhr: "13:08", Isha: "not-a-time" }
    }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.appContext, {
    dateKey: "2026-08-25",
    times: { Dhuhr: "13:08" }
  });

  const invalidContext = validateFaithAskInput({
    question: "Bugün öğlen namazı vakti?",
    language: "tr",
    installationId: INSTALLATION_ID,
    appContext: { dateKey: "today", times: { Dhuhr: "13:08" } }
  });
  assert.equal(invalidContext.ok, true);
  assert.equal(invalidContext.value.appContext, undefined);
});
