import { createHmac } from "node:crypto";

const MIN_SECRET_LENGTH = 32;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export class FaithRateLimitError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "FaithRateLimitError";
    this.code = options.code || "faith_rate_limited";
    this.status = 429;
    this.retryAfterSeconds = options.retryAfterSeconds || 1;
    this.limit = options.limit ?? null;
    this.resetAt = options.resetAt || null;
  }
}

export function resolveFaithRateLimitConfig(env = process.env) {
  const secret = String(env.FAITH_RATE_LIMIT_SECRET || "").trim();
  return {
    secret,
    configured: secret.length >= MIN_SECRET_LENGTH,
    installMinuteLimit: boundedInteger(env.FAITH_INSTALL_MINUTE_LIMIT, 4, 1, 30),
    installDailyLimit: boundedInteger(env.FAITH_INSTALL_DAILY_LIMIT, 10, 1, 100),
    ipMinuteLimit: boundedInteger(env.FAITH_IP_MINUTE_LIMIT, 8, 1, 120),
    ipDailyLimit: boundedInteger(env.FAITH_IP_DAILY_LIMIT, 60, 1, 500),
    globalMinuteLimit: boundedInteger(env.FAITH_GLOBAL_MINUTE_LIMIT, 25, 1, 30),
    globalDailyLimit: boundedInteger(env.FAITH_GLOBAL_DAILY_LIMIT, 800, 1, 1000)
  };
}

export function faithRateLimitPublicStatus(config = resolveFaithRateLimitConfig()) {
  return {
    configured: config.configured,
    installDailyLimit: config.installDailyLimit,
    globalDailyLimit: config.globalDailyLimit
  };
}

export function createFaithRateLimiter(options = {}) {
  const config = options.config || resolveFaithRateLimitConfig();
  const now = options.now || Date.now;
  const buckets = new Map();
  let operationCount = 0;

  return {
    status() {
      return faithRateLimitPublicStatus(config);
    },

    beginRequest(input) {
      assertConfigured(config);
      const installationId = validateInstallationId(input?.installationId);
      const ipAddress = validateIpAddress(input?.ipAddress);
      const context = {
        installationKey: hashIdentifier(config.secret, "installation", installationId),
        ipKey: hashIdentifier(config.secret, "ip", ipAddress)
      };
      const timestamp = now();

      consumeAtomically(
        [
          constraint("install_minute", context.installationKey, config.installMinuteLimit, MINUTE_MS),
          constraint("ip_minute", context.ipKey, config.ipMinuteLimit, MINUTE_MS),
          constraint("global_minute", "global", config.globalMinuteLimit, MINUTE_MS)
        ],
        timestamp,
        buckets
      );
      maybeCleanup(timestamp, buckets, ++operationCount);
      return context;
    },

    consumeProviderQuota(context) {
      assertContext(context);
      const timestamp = now();
      consumeAtomically(
        [
          constraint("install_daily", context.installationKey, config.installDailyLimit, DAY_MS),
          constraint("ip_daily", context.ipKey, config.ipDailyLimit, DAY_MS),
          constraint("global_daily", "global", config.globalDailyLimit, DAY_MS)
        ],
        timestamp,
        buckets
      );
      maybeCleanup(timestamp, buckets, ++operationCount);
      return quotaSnapshot(context, timestamp, config, buckets);
    },

    consumeAdditionalProviderQuota(context) {
      assertContext(context);
      const timestamp = now();
      consumeAtomically(
        [
          constraint("global_minute", "global", config.globalMinuteLimit, MINUTE_MS),
          constraint("global_daily", "global", config.globalDailyLimit, DAY_MS)
        ],
        timestamp,
        buckets
      );
      maybeCleanup(timestamp, buckets, ++operationCount);
      return quotaSnapshot(context, timestamp, config, buckets);
    },

    snapshot(context) {
      assertContext(context);
      return quotaSnapshot(context, now(), config, buckets);
    }
  };
}

function consumeAtomically(constraints, timestamp, buckets) {
  const states = constraints.map((item) => currentState(item, timestamp, buckets));
  const exceeded = states.find((state) => state.count >= state.constraint.limit);
  if (exceeded) {
    const retryAfterSeconds = Math.max(1, Math.ceil((exceeded.resetAtMs - timestamp) / 1000));
    throw new FaithRateLimitError("Faith Assistant rate limit reached.", {
      code: `faith_${exceeded.constraint.name}_limit`,
      retryAfterSeconds,
      limit: exceeded.constraint.limit,
      resetAt: new Date(exceeded.resetAtMs).toISOString()
    });
  }

  for (const state of states) {
    buckets.set(state.bucketKey, {
      count: state.count + 1,
      expiresAtMs: state.resetAtMs
    });
  }
}

function currentState(item, timestamp, buckets) {
  const windowStart = Math.floor(timestamp / item.windowMs) * item.windowMs;
  const resetAtMs = windowStart + item.windowMs;
  const bucketKey = `${item.name}:${item.key}:${windowStart}`;
  const existing = buckets.get(bucketKey);
  return {
    constraint: item,
    bucketKey,
    resetAtMs,
    count: existing?.expiresAtMs > timestamp ? existing.count : 0
  };
}

function quotaSnapshot(context, timestamp, config, buckets) {
  const state = currentState(
    constraint("install_daily", context.installationKey, config.installDailyLimit, DAY_MS),
    timestamp,
    buckets
  );
  return {
    limit: config.installDailyLimit,
    remaining: Math.max(0, config.installDailyLimit - state.count),
    resetAt: new Date(state.resetAtMs).toISOString()
  };
}

function constraint(name, key, limit, windowMs) {
  return { name, key, limit, windowMs };
}

function hashIdentifier(secret, namespace, value) {
  return createHmac("sha256", secret).update(`${namespace}\0${value}`).digest("hex");
}

function validateInstallationId(value) {
  const normalized = String(value || "").trim();
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(normalized)) {
    throw new TypeError("installationId must be an anonymous identifier between 16 and 128 characters.");
  }
  return normalized;
}

function validateIpAddress(value) {
  const normalized = String(value || "unknown").trim().slice(0, 128);
  return normalized || "unknown";
}

function assertConfigured(config) {
  if (!config.configured) {
    throw new Error(`FAITH_RATE_LIMIT_SECRET must contain at least ${MIN_SECRET_LENGTH} characters.`);
  }
}

function assertContext(context) {
  if (!context?.installationKey || !context?.ipKey) {
    throw new TypeError("A valid Faith Assistant rate-limit context is required.");
  }
}

function maybeCleanup(timestamp, buckets, operationCount) {
  if (operationCount % 128 !== 0) return;
  for (const [key, value] of buckets.entries()) {
    if (!value?.expiresAtMs || value.expiresAtMs <= timestamp) {
      buckets.delete(key);
    }
  }
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(parsed)));
}
