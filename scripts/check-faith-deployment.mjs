import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const DEFAULT_BASE_URL = "https://go-to-go-prayer-production.up.railway.app";
const REQUEST_TIMEOUT_MS = 30000;
const baseUrl = normalizeBaseUrl(process.env.FAITH_SMOKE_BASE_URL || DEFAULT_BASE_URL);
const expectReady = parseBoolean(process.env.FAITH_SMOKE_EXPECT_READY, true);
const runLiveProviderChecks = parseBoolean(process.env.FAITH_SMOKE_LIVE, false);
const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const localCases = [
  {
    id: "en-local-tool",
    question: "What time is Fajr now?",
    language: "en",
    perspective: "general_sunni",
    outcome: "out_of_scope",
    topicId: "current_prayer_times"
  },
  {
    id: "nl-local-tool",
    question: "Welke kant is de Qibla-richting?",
    language: "nl",
    perspective: "general_sunni",
    outcome: "out_of_scope",
    topicId: "qibla_bearing"
  },
  {
    id: "tr-local-boundary",
    question: "Durumum için bağlayıcı kişisel fetva ver.",
    language: "tr",
    perspective: "general_sunni",
    outcome: "qualified_referral",
    topicId: "personalised_fatwa"
  }
];

const liveCases = [
  {
    id: "en-live-source",
    question: "How is tayammum performed when water is unavailable for wudu?",
    language: "en",
    perspective: "general_sunni",
    topicId: "ritual_purity"
  },
  {
    id: "nl-live-source",
    question: "Hoe kan ik dua doen en wat is de etiquette van een smeekbede?",
    language: "nl",
    perspective: "general_sunni",
    topicId: "dua_dhikr"
  },
  {
    id: "tr-live-source",
    question: "Hanefi bir yolcu namazları cem edebilir mi?",
    language: "tr",
    perspective: "hanafi",
    topicId: "travel_prayer"
  }
];

try {
  console.log(`[faith-smoke] target ${baseUrl}`);
  const health = await requestJson("/faith/health");
  assert.equal(health.status, 200, endpointFailure("GET /faith/health", health));
  assert.equal(health.payload?.ok, true, "Faith health response must report ok=true.");
  assert.equal(health.payload?.service, "faith-assistant", "Unexpected Faith health service name.");
  assert.equal(health.payload?.policyId, "faith-assistant-v1", "Unexpected Faith policy ID.");
  assert.equal(health.payload?.ready, expectReady, `Expected ready=${expectReady}.`);

  if (!expectReady) {
    console.log("[faith-smoke] endpoint is deployed and correctly reports not ready");
    console.log("[faith-smoke] ask checks skipped because FAITH_SMOKE_EXPECT_READY=false");
    process.exit(0);
  }

  assert.equal(health.payload?.enabled, true, "Faith Assistant feature flag is not enabled.");
  assert.equal(health.payload?.providerStatus?.configured, true, "Groq is not configured.");
  assert.equal(
    health.payload?.abuseProtection?.configured,
    true,
    "Faith Assistant abuse protection is not configured."
  );
  assert.ok(
    Number.isInteger(health.payload?.knowledgePassageCount) && health.payload.knowledgePassageCount > 0,
    "No approved Faith passages are loaded."
  );
  console.log(
    `[faith-smoke] health ready; ${health.payload.knowledgePassageCount} approved passages loaded`
  );

  for (const testCase of localCases) {
    const response = await ask(testCase, "local");
    assert.equal(response.status, 200, endpointFailure(testCase.id, response));
    assert.equal(response.payload?.outcome, testCase.outcome, `${testCase.id}: unexpected outcome.`);
    assert.equal(response.payload?.perspective, testCase.perspective, `${testCase.id}: perspective mismatch.`);
    assert.equal(response.payload?.meta?.topicId, testCase.topicId, `${testCase.id}: route mismatch.`);
    assert.equal(response.payload?.meta?.providerRequestId, null, `${testCase.id}: unexpectedly called Groq.`);
    assert.deepEqual(response.payload?.citations, [], `${testCase.id}: local response returned citations.`);
    assertValidRateLimit(response.payload?.rateLimit, testCase.id);
    console.log(`[faith-smoke] ${testCase.id} passed locally without provider quota`);
  }

  if (!runLiveProviderChecks) {
    console.log("[faith-smoke] safe checks passed; Groq quota was not used");
    console.log("[faith-smoke] set FAITH_SMOKE_LIVE=true to run three EN/NL/TR provider checks");
    process.exit(0);
  }

  const approvedPassages = await loadApprovedPassages();
  for (const testCase of liveCases) {
    const response = await ask(testCase, "live");
    assert.equal(response.status, 200, endpointFailure(testCase.id, response));
    assert.ok(
      response.payload?.outcome === "answer" || response.payload?.outcome === "clarification_needed",
      `${testCase.id}: expected a sourced answer or clarification, received ${response.payload?.outcome}.`
    );
    assert.equal(response.payload?.perspective, testCase.perspective, `${testCase.id}: perspective mismatch.`);
    assert.equal(response.payload?.meta?.topicId, testCase.topicId, `${testCase.id}: topic mismatch.`);
    assert.ok(String(response.payload?.answer || "").trim().length > 0, `${testCase.id}: empty answer.`);
    assertValidCitations(response.payload?.citations, approvedPassages, testCase.id);
    assertValidRateLimit(response.payload?.rateLimit, testCase.id);
    const requestId = response.payload?.meta?.providerRequestId;
    console.log(`[faith-smoke] ${testCase.id} passed with approved citations${requestId ? ` (${requestId})` : ""}`);
  }

  console.log("[faith-smoke] live EN/NL/TR checks passed");
} catch (error) {
  console.error(`[faith-smoke] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

async function ask(testCase, mode) {
  return requestJson("/faith/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: testCase.question,
      language: testCase.language,
      perspective: testCase.perspective,
      installationId: `faith-smoke-${mode}-${testCase.language}-${runId}`
    })
  });
}

async function requestJson(pathname, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}${pathname}`, { ...options, signal: controller.signal });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { unparsedBody: text.slice(0, 300) };
    }
    return { status: response.status, payload };
  } finally {
    clearTimeout(timeout);
  }
}

async function loadApprovedPassages() {
  const fileUrl = new URL("../backend/diyanet-proxy/faith-content/approved-passages.json", import.meta.url);
  const registry = JSON.parse(await readFile(fileUrl, "utf8"));
  return new Map(registry.passages.map((passage) => [passage.id, passage]));
}

function assertValidCitations(citations, approvedPassages, caseId) {
  assert.ok(Array.isArray(citations) && citations.length > 0, `${caseId}: no citations returned.`);
  for (const citation of citations) {
    const approved = approvedPassages.get(citation?.id);
    assert.ok(approved, `${caseId}: unapproved citation ID ${citation?.id || "<missing>"}.`);
    assert.equal(citation.sourceId, approved.sourceId, `${caseId}: citation source mismatch.`);
    assert.equal(citation.url, approved.sourceUrl, `${caseId}: citation URL mismatch.`);
    assert.equal(new URL(citation.url).protocol, "https:", `${caseId}: citation must use HTTPS.`);
  }
}

function assertValidRateLimit(rateLimit, caseId) {
  assert.ok(rateLimit && typeof rateLimit === "object", `${caseId}: missing rate limit status.`);
  assert.ok(Number.isInteger(rateLimit.limit) && rateLimit.limit > 0, `${caseId}: invalid daily limit.`);
  assert.ok(
    Number.isInteger(rateLimit.remaining) && rateLimit.remaining >= 0 && rateLimit.remaining <= rateLimit.limit,
    `${caseId}: invalid remaining allowance.`
  );
  assert.ok(Number.isFinite(Date.parse(rateLimit.resetAt)), `${caseId}: invalid rate-limit reset time.`);
}

function endpointFailure(label, response) {
  const code = response.payload?.code || response.payload?.error || response.payload?.unparsedBody || "unknown response";
  if (response.status === 404) {
    return `${label} returned 404. Deploy the backend commit to Railway before running this check.`;
  }
  return `${label} returned HTTP ${response.status}: ${code}`;
}

function normalizeBaseUrl(value) {
  const url = new URL(String(value).trim().replace(/\/+$/, ""));
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("FAITH_SMOKE_BASE_URL must use HTTPS unless it targets localhost.");
  }
  return url.toString().replace(/\/+$/, "");
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error("Boolean smoke-test variables must be true or false.");
}
