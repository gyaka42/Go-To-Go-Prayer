import assert from "node:assert/strict";
import test from "node:test";
import {
  createGroqClient,
  GroqClientError,
  groqPublicStatus,
  resolveGroqConfig
} from "./groq-client.mjs";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    outcome: { type: "string", enum: ["insufficient_sources"] }
  },
  required: ["outcome"],
  additionalProperties: false
};

test("Groq public status never exposes the API key", () => {
  const config = resolveGroqConfig({ GROQ_API_KEY: "secret-key" });
  const status = groqPublicStatus(config);

  assert.equal(status.configured, true);
  assert.equal(status.model, "openai/gpt-oss-120b");
  assert.equal("apiKey" in status, false);
  assert.equal(JSON.stringify(status).includes("secret-key"), false);
});

test("Groq client sends a bounded strict-schema request without tools", async () => {
  let capturedUrl;
  let capturedOptions;
  const fetchImpl = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return new Response(
      JSON.stringify({
        model: "openai/gpt-oss-120b",
        choices: [{ message: { content: JSON.stringify({ outcome: "insufficient_sources" }) } }],
        usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 }
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": "request-123",
          "x-ratelimit-remaining-requests": "999"
        }
      }
    );
  };
  const client = createGroqClient({
    config: resolveGroqConfig({ GROQ_API_KEY: "secret-key" }),
    fetchImpl
  });

  const result = await client.createStructuredCompletion({
    messages: [
      { role: "system", content: "Use approved evidence only." },
      { role: "user", content: "Test question" }
    ],
    schemaName: "faith_answer",
    schema: RESPONSE_SCHEMA
  });

  const body = JSON.parse(capturedOptions.body);
  assert.equal(capturedUrl, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(capturedOptions.headers.Authorization, "Bearer secret-key");
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.tool_choice, "none");
  assert.equal(body.store, false);
  assert.equal(body.stream, false);
  assert.deepEqual(result.data, { outcome: "insufficient_sources" });
  assert.equal(result.meta.requestId, "request-123");
  assert.equal(result.meta.usage.totalTokens, 25);
});

test("Groq client maps rate limits without returning upstream content", async () => {
  const client = createGroqClient({
    config: resolveGroqConfig({ GROQ_API_KEY: "secret-key" }),
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: { message: "sensitive upstream detail" } }), {
        status: 429,
        headers: { "retry-after": "3" }
      })
  });

  await assert.rejects(
    () =>
      client.createStructuredCompletion({
        messages: [{ role: "user", content: "Test question" }],
        schemaName: "faith_answer",
        schema: RESPONSE_SCHEMA
      }),
    (error) => {
      assert.ok(error instanceof GroqClientError);
      assert.equal(error.code, "groq_rate_limited");
      assert.equal(error.status, 429);
      assert.equal(error.retryAfterSeconds, 3);
      assert.equal(error.message.includes("sensitive upstream detail"), false);
      return true;
    }
  );
});
