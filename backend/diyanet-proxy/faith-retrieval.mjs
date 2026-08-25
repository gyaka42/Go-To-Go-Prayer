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
  const maxPassages = Number.isFinite(options.maxPassages) ? Math.max(1, Math.min(6, options.maxPassages)) : 6;

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
      const searchAllApprovedTopics = topicIds.has("islamic_general");

      const ranked = knowledge.corpus.passages
        .filter((passage) => passage.perspectives.includes(perspective))
        .filter((passage) => searchAllApprovedTopics || passage.topics.some((topic) => topicIds.has(topic)))
        .map((passage) => scorePassage(passage, classification, normalizedQuestion, questionTokens))
        .filter((entry) => entry.exactTermMatches > 0 || entry.tokenOverlap >= 3)
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
  if (topics.length > 0) {
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

  const inferredTopics = inferTopicsFromPassages(normalizedQuestion, knowledge.corpus.passages);
  if (inferredTopics.length > 0) {
    return {
      kind: "allowed",
      topicId: inferredTopics[0].id,
      topics: inferredTopics
    };
  }

  const domainTerms = Array.isArray(knowledge.routing.islamicDomainTerms)
    ? knowledge.routing.islamicDomainTerms
    : [];
  const matchedDomainTerms = domainTerms
    .map((term) => normalizeForFaithSearch(term))
    .filter((term) => termMatches(normalizedQuestion, term));
  if (matchedDomainTerms.length > 0) {
    return {
      kind: "allowed",
      topicId: "islamic_general",
      topics: [{ id: "islamic_general", score: 1, matchedTerms: matchedDomainTerms.slice(0, 5) }]
    };
  }

  return {
    kind: "out_of_scope",
    routeId: null,
    matchedTerms: []
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
  if (routing.islamicDomainTerms && !Array.isArray(routing.islamicDomainTerms)) {
    throw new Error("Faith routing Islamic domain terms must be an array.");
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
    if (passage.exclusionTerms && (!Array.isArray(passage.exclusionTerms) || passage.exclusionTerms.length === 0)) {
      throw new Error(`Faith passage has invalid exclusion terms: ${passage.id}`);
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
      const matchedByMeaning = new Map();
      for (const term of normalizedTerms.filter((candidate) => termMatches(normalizedQuestion, candidate))) {
        const meaningful = [...meaningfulTokens(term)].sort().join(" ") || term;
        if (!matchedByMeaning.has(meaningful)) matchedByMeaning.set(meaningful, term);
      }
      const matchedTerms = [...matchedByMeaning.values()];
      const score = matchedTerms.reduce((total, term) => total + 4 + meaningfulTokens(term).size * 2, 0);
      return { route, matchedTerms, score };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => {
      const aPriority = a.route.priority || 0;
      const bPriority = b.route.priority || 0;
      if (aPriority >= 1000 || bPriority >= 1000) return bPriority - aPriority || b.score - a.score;
      return b.score - a.score || bPriority - aPriority;
    });
}

function scorePassage(passage, classification, normalizedQuestion, questionTokens) {
  const excluded = (passage.exclusionTerms || []).some((term) =>
    termMatches(normalizedQuestion, normalizeForFaithSearch(term))
  );
  if (excluded) return { passage, score: 0, relevanceSignals: 0 };

  const primaryTopic = classification.topicId;
  let score = primaryTopic && passage.topics.includes(primaryTopic) ? 20 : 8;
  let relevanceSignals = 0;
  const matchedSearchMeanings = new Set();

  for (const term of passage.searchTerms) {
    const normalizedTerm = normalizeForFaithSearch(term);
    if (termMatches(normalizedQuestion, normalizedTerm)) {
      const meaning = [...meaningfulTokens(normalizedTerm)].sort().join(" ") || normalizedTerm;
      if (matchedSearchMeanings.has(meaning)) continue;
      matchedSearchMeanings.add(meaning);
      score += 8 + meaningfulTokens(normalizedTerm).size * 2;
      relevanceSignals += 2;
    }
  }

  const searchable = [...meaningfulTokens(
    normalizeForFaithSearch(`${passage.sourceTitle} ${passage.summary} ${passage.searchTerms.join(" ")}`)
  )];
  let tokenOverlap = 0;
  for (const token of questionTokens) {
    if (searchable.some((candidate) => tokensMatch(token, candidate))) tokenOverlap += 1;
  }
  if (tokenOverlap >= 2) {
    score += tokenOverlap * 2;
    relevanceSignals += 1;
  }

  return {
    passage,
    score,
    relevanceSignals,
    exactTermMatches: matchedSearchMeanings.size,
    tokenOverlap
  };
}

function inferTopicsFromPassages(normalizedQuestion, passages) {
  const questionTokens = meaningfulTokens(normalizedQuestion);
  const ranked = passages
    .map((passage) => scorePassage(passage, { topicId: null }, normalizedQuestion, questionTokens))
    .filter((entry) => entry.exactTermMatches > 0 || entry.tokenOverlap >= 3)
    .sort((a, b) => b.score - a.score || a.passage.id.localeCompare(b.passage.id))
    .slice(0, 3);

  const inferred = [];
  for (const entry of ranked) {
    for (const topic of entry.passage.topics) {
      if (inferred.some((candidate) => candidate.id === topic)) continue;
      inferred.push({
        id: topic,
        score: entry.score,
        matchedTerms: [`passage:${entry.passage.id}`]
      });
      if (inferred.length === 3) return inferred;
    }
  }
  return inferred;
}

function termMatches(normalizedQuestion, normalizedTerm) {
  if (!normalizedTerm) return false;
  if (` ${normalizedQuestion} `.includes(` ${normalizedTerm} `)) return true;

  const questionTokens = [...meaningfulTokens(normalizedQuestion)];
  const meaningfulTermTokens = [...meaningfulTokens(normalizedTerm)];
  const termTokens = meaningfulTermTokens.length >= 2
    ? meaningfulTermTokens
    : normalizedTerm.split(" ").filter(Boolean);
  return termTokens.every((termToken) =>
    questionTokens.some((questionToken) => tokensMatch(questionToken, termToken))
  );
}

function tokensMatch(questionToken, termToken) {
  if (questionToken === termToken) return true;
  if (questionToken.length < 5 || termToken.length < 5) return false;
  if (questionToken.startsWith(termToken) || termToken.startsWith(questionToken)) return true;
  return isSingleEditOrTranspose(questionToken, termToken);
}

function isSingleEditOrTranspose(left, right) {
  const lengthDifference = Math.abs(left.length - right.length);
  if (lengthDifference > 1) return false;

  if (left.length === right.length) {
    const mismatches = [];
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) mismatches.push(index);
      if (mismatches.length > 2) return false;
    }
    if (mismatches.length === 1) return true;
    return mismatches.length === 2 &&
      mismatches[1] === mismatches[0] + 1 &&
      left[mismatches[0]] === right[mismatches[1]] &&
      left[mismatches[1]] === right[mismatches[0]];
  }

  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left];
  let shortIndex = 0;
  let longIndex = 0;
  let skipped = false;
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1;
      longIndex += 1;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    longIndex += 1;
  }
  return true;
}

function meaningfulTokens(value) {
  return new Set(
    String(value || "")
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
  );
}
