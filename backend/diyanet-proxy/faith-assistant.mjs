import { groqPublicStatus, resolveGroqConfig } from "./groq-client.mjs";

const POLICY_ID = "faith-assistant-v1";
const SUPPORTED_LANGUAGES = new Set(["en", "nl", "tr"]);
const SUPPORTED_PERSPECTIVES = new Set(["general_sunni", "hanafi"]);
const MIN_QUESTION_CHARS = 3;
const MAX_QUESTION_CHARS = 800;

export function resolveFaithRuntimeConfig(env = process.env, options = {}) {
  const groq = resolveGroqConfig(env);
  const knowledge = options.knowledge || {
    ready: true,
    status: "approved_passages_loaded",
    passageCount: null
  };
  return {
    enabled: parseBoolean(env.FAITH_ASSISTANT_ENABLED, false),
    policyId: POLICY_ID,
    knowledge,
    groq
  };
}

export function faithPublicStatus(config = resolveFaithRuntimeConfig()) {
  return {
    enabled: config.enabled,
    ready: config.enabled && config.groq.configured && config.knowledge.ready,
    policyId: config.policyId,
    knowledgeStatus: config.knowledge.status,
    knowledgePassageCount: config.knowledge.passageCount,
    provider: "groq",
    providerStatus: groqPublicStatus(config.groq)
  };
}

export function validateFaithAskInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid("invalid_body", "Request body must be a JSON object.");
  }

  const question = normalizeQuestion(value.question);
  if (question.length < MIN_QUESTION_CHARS || question.length > MAX_QUESTION_CHARS) {
    return invalid(
      "invalid_question",
      `question must contain between ${MIN_QUESTION_CHARS} and ${MAX_QUESTION_CHARS} characters.`
    );
  }

  const language = String(value.language || "").trim().toLowerCase();
  if (!SUPPORTED_LANGUAGES.has(language)) {
    return invalid("invalid_language", "language must be en, nl or tr.");
  }

  const perspective = String(value.perspective || "general_sunni").trim().toLowerCase();
  if (!SUPPORTED_PERSPECTIVES.has(perspective)) {
    return invalid("invalid_perspective", "perspective must be general_sunni or hanafi.");
  }

  return {
    ok: true,
    value: { question, language, perspective }
  };
}

export function faithUnavailableResponse(config = resolveFaithRuntimeConfig()) {
  if (!config.enabled) {
    return {
      status: 503,
      payload: {
        error: "Faith Assistant is disabled.",
        code: "faith_assistant_disabled",
        retryable: false
      }
    };
  }
  if (!config.groq.configured) {
    return {
      status: 503,
      payload: {
        error: "Faith Assistant provider is not configured.",
        code: "faith_provider_not_configured",
        retryable: false
      }
    };
  }
  if (!config.knowledge.ready) {
    return {
      status: 503,
      payload: {
        error: "Faith Assistant source retrieval is not ready.",
        code: "faith_sources_not_ready",
        retryable: false
      }
    };
  }
  return null;
}

function normalizeQuestion(value) {
  return String(value || "")
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseBoolean(value, fallback) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return fallback;
}

function invalid(code, error) {
  return {
    ok: false,
    code,
    error
  };
}
