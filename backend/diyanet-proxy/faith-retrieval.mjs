import { readFileSync } from "node:fs";

const contentDirectory = new URL("./faith-content/", import.meta.url);
const STOP_WORDS = new Set([
  "a", "about", "am", "an", "and", "are", "can", "do", "does", "for", "how", "i", "in", "is", "it", "me", "my", "of", "on", "or", "the", "to", "what", "when", "who", "with",
  "als", "ben", "de", "een", "en", "het", "hoe", "ik", "in", "is", "kan", "mag", "met", "mijn", "of", "om", "te", "van", "voor", "wat", "wanneer", "wie",
  "ben", "bir", "bu", "da", "de", "icin", "ile", "mi", "miyim", "miyim", "mu", "mum", "nasil", "ne", "ve", "veya"
]);

export function loadFaithKnowledge() {
  const policy = readJson("v1-policy.json");
  const registry = readJson("source-registry.json");
  const routing = readJson("topic-routing.json");
  const corpus = readJson("approved-passages.json");
  validateKnowledge({ policy, registry, routing, corpus });
  return { policy, registry, routing, corpus };
}

export function createFaithRetriever(options = {}) {
  const knowledge = options.knowledge || loadFaithKnowledge();
  const maxPassages = Number.isFinite(options.maxPassages) ? Math.max(1, Math.min(6, options.maxPassages)) : 4;

  return {
    status() {
      return {
        ready: true,
        policyId: knowledge.policy.policyId,
        corpusId: knowledge.corpus.corpusId,
        passageCount: knowledge.corpus.passages.length
      };
    },

    classify(question) {
      return classifyFaithQuestion(question, knowledge);
    },

    retrieve(input) {
      const classification = classifyFaithQuestion(input.question, knowledge);
      if (classification.kind !== "allowed") {
        return { classification, passages: [] };
      }

      const perspective = String(input.perspective || "general_sunni");
      const normalizedQuestion = normalizeForFaithSearch(input.question);
      const questionTokens = meaningfulTokens(normalizedQuestion);
      const topicIds = new Set(classification.topics.map((topic) => topic.id));

      const ranked = knowledge.corpus.passages
        .filter((passage) => passage.perspectives.includes(perspective))
        .filter((passage) => passage.topics.some((topic) => topicIds.has(topic)))
        .map((passage) => scorePassage(passage, classification, normalizedQuestion, questionTokens))
        .filter((entry) => entry.relevanceSignals > 0)
        .sort((a, b) => b.score - a.score || a.passage.id.localeCompare(b.passage.id))
        .slice(0, maxPassages)
        .map((entry) => entry.passage);

      const hasRequiredPerspective =
        perspective !== "hanafi" || ranked.some((passage) => passage.perspectives.includes("hanafi"));

      return {
        classification,
        passages: hasRequiredPerspective ? ranked : []
      };
    }
  };
}

export function classifyFaithQuestion(question, knowledge = loadFaithKnowledge()) {
  const normalizedQuestion = normalizeForFaithSearch(question);

  const referral = bestRouteMatch(normalizedQuestion, knowledge.routing.referralRoutes);
  if (referral) {
    return { kind: "qualified_referral", routeId: referral.route.id, matchedTerms: referral.matchedTerms };
  }

  const deterministic = bestRouteMatch(normalizedQuestion, knowledge.routing.deterministicRoutes);
  if (deterministic) {
    return { kind: "deterministic_tool", routeId: deterministic.route.id, matchedTerms: deterministic.matchedTerms };
  }

  const topics = allRouteMatches(normalizedQuestion, knowledge.routing.topicRoutes).slice(0, 3);
  if (topics.length === 0) {
    return { kind: "out_of_scope", routeId: null, matchedTerms: [] };
  }

  return {
    kind: "allowed",
    topicId: topics[0].route.id,
    topics: topics.map((match) => ({
      id: match.route.id,
      score: match.score,
      matchedTerms: match.matchedTerms
    }))
  };
}

export function normalizeForFaithSearch(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ł/g, "l")
    .replace(/đ/g, "d")
    .replace(/ð/g, "d")
    .replace(/þ/g, "th")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readJson(name) {
  return JSON.parse(readFileSync(new URL(name, contentDirectory), "utf8"));
}

function validateKnowledge({ policy, registry, routing, corpus }) {
  if (policy.policyId !== routing.policyId) {
    throw new Error("Faith routing policy does not match the V1 policy.");
  }

  const allowedTopics = new Set(policy.allowedTopics.map((topic) => topic.id));
  const supportedPerspectives = new Set(policy.supportedPerspectives);
  const sources = new Map(registry.sources.map((source) => [source.id, source]));
  const passageIds = new Set();

  for (const route of routing.topicRoutes) {
    if (!allowedTopics.has(route.id)) {
      throw new Error(`Faith route uses an unknown topic: ${route.id}`);
    }
    if (!Array.isArray(route.terms) || route.terms.length === 0) {
      throw new Error(`Faith route has no terms: ${route.id}`);
    }
  }

  for (const passage of corpus.passages) {
    if (passageIds.has(passage.id)) {
      throw new Error(`Duplicate faith passage: ${passage.id}`);
    }
    passageIds.add(passage.id);

    const source = sources.get(passage.sourceId);
    if (!source || source.reviewState !== "approved" || source.runtimeEnabled !== true) {
      throw new Error(`Faith passage uses a source that is not runtime-approved: ${passage.id}`);
    }
    if (!passage.topics.every((topic) => allowedTopics.has(topic))) {
      throw new Error(`Faith passage uses an unknown topic: ${passage.id}`);
    }
    if (!passage.perspectives.every((perspective) => supportedPerspectives.has(perspective))) {
      throw new Error(`Faith passage uses an unsupported perspective: ${passage.id}`);
    }
    if (!Array.isArray(passage.searchTerms) || passage.searchTerms.length === 0 || !passage.summary?.trim()) {
      throw new Error(`Faith passage is missing retrieval content: ${passage.id}`);
    }

    const sourceHost = new URL(source.url).hostname;
    const passageHost = new URL(passage.sourceUrl).hostname;
    if (passageHost !== sourceHost && !passageHost.endsWith(`.${sourceHost}`)) {
      throw new Error(`Faith passage URL does not belong to its source: ${passage.id}`);
    }
  }
}

function bestRouteMatch(normalizedQuestion, routes) {
  return allRouteMatches(normalizedQuestion, routes)[0] || null;
}

function allRouteMatches(normalizedQuestion, routes) {
  return routes
    .map((route) => {
      const normalizedTerms = [...new Set(route.terms.map((term) => normalizeForFaithSearch(term)))];
      const matchedTerms = normalizedTerms.filter((term) => termMatches(normalizedQuestion, term));
      const score = matchedTerms.reduce((total, term) => total + 4 + meaningfulTokens(term).size * 2, 0);
      return { route, matchedTerms, score };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || (b.route.priority || 0) - (a.route.priority || 0));
}

function scorePassage(passage, classification, normalizedQuestion, questionTokens) {
  const primaryTopic = classification.topicId;
  let score = passage.topics.includes(primaryTopic) ? 20 : 8;
  let relevanceSignals = 0;

  for (const term of passage.searchTerms) {
    const normalizedTerm = normalizeForFaithSearch(term);
    if (termMatches(normalizedQuestion, normalizedTerm)) {
      score += 8 + meaningfulTokens(normalizedTerm).size * 2;
      relevanceSignals += 2;
    }
  }

  const searchable = meaningfulTokens(
    normalizeForFaithSearch(`${passage.sourceTitle} ${passage.summary} ${passage.searchTerms.join(" ")}`)
  );
  let tokenOverlap = 0;
  for (const token of questionTokens) {
    if (searchable.has(token)) tokenOverlap += 1;
  }
  if (tokenOverlap >= 3) {
    score += tokenOverlap * 2;
    relevanceSignals += 1;
  }

  return { passage, score, relevanceSignals };
}

function termMatches(normalizedQuestion, normalizedTerm) {
  if (!normalizedTerm) return false;
  if (` ${normalizedQuestion} `.includes(` ${normalizedTerm} `)) return true;

  const questionTokens = normalizedQuestion.split(" ").filter(Boolean);
  const termTokens = normalizedTerm.split(" ").filter(Boolean);
  return termTokens.every((termToken) =>
    questionTokens.some(
      (questionToken) => questionToken === termToken || (termToken.length >= 5 && questionToken.startsWith(termToken))
    )
  );
}

function meaningfulTokens(value) {
  return new Set(
    String(value || "")
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
  );
}
