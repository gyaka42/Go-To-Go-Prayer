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

test("Faith Assistant remains fail-closed until configuration and knowledge are ready", () => {
  const disabled = resolveFaithRuntimeConfig({ GROQ_API_KEY: "secret-key" });
  assert.equal(faithPublicStatus(disabled).ready, false);
  assert.equal(faithUnavailableResponse(disabled).payload.code, "faith_assistant_disabled");

  const enabled = resolveFaithRuntimeConfig({
    FAITH_ASSISTANT_ENABLED: "true",
    GROQ_API_KEY: "secret-key"
  });
  assert.equal(faithPublicStatus(enabled).ready, true);
  assert.equal(faithUnavailableResponse(enabled), null);

  const missingKnowledge = resolveFaithRuntimeConfig(
    { FAITH_ASSISTANT_ENABLED: "true", GROQ_API_KEY: "secret-key" },
    { knowledge: { ready: false, status: "load_failed", passageCount: 0 } }
  );
  assert.equal(faithUnavailableResponse(missingKnowledge).payload.code, "faith_sources_not_ready");
});

test("Faith Assistant validates and normalizes the public request", () => {
  const result = validateFaithAskInput({
    question: "  Kan ik Dhuhr en Asr combineren?\n",
    language: "NL",
    perspective: "hanafi"
  });

  assert.deepEqual(result, {
    ok: true,
    value: {
      question: "Kan ik Dhuhr en Asr combineren?",
      language: "nl",
      perspective: "hanafi"
    }
  });
  assert.equal(validateFaithAskInput({ question: "Hi", language: "nl" }).code, "invalid_question");
  assert.equal(validateFaithAskInput({ question: "Valid question", language: "de" }).code, "invalid_language");
  assert.equal(
    validateFaithAskInput({ question: "Valid question", language: "en", perspective: "maliki" }).code,
    "invalid_perspective"
  );
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
