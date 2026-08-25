import assert from "node:assert/strict";
import test from "node:test";
import {
  createFaithRateLimiter,
  FaithRateLimitError,
  faithRateLimitPublicStatus,
  resolveFaithRateLimitConfig
} from "./faith-rate-limit.mjs";
import { extractClientIp } from "./request-identity.mjs";

const SECRET = "test-secret-with-at-least-32-characters";

test("rate-limit public status and contexts never expose raw identifiers or secret", () => {
  const config = resolveFaithRateLimitConfig({ FAITH_RATE_LIMIT_SECRET: SECRET });
  const limiter = createFaithRateLimiter({ config, now: () => Date.UTC(2026, 7, 24, 12) });
  const context = limiter.beginRequest({
    installationId: "installation-1234567890",
    ipAddress: "203.0.113.10"
  });

  assert.equal(faithRateLimitPublicStatus(config).configured, true);
  assert.equal(JSON.stringify(faithRateLimitPublicStatus(config)).includes(SECRET), false);
  assert.equal(JSON.stringify(context).includes("installation-1234567890"), false);
  assert.equal(JSON.stringify(context).includes("203.0.113.10"), false);
  assert.match(context.installationKey, /^[a-f0-9]{64}$/);
});

test("provider quota enforces a daily per-installation limit", () => {
  let timestamp = Date.UTC(2026, 7, 24, 12);
  const config = resolveFaithRateLimitConfig({
    FAITH_RATE_LIMIT_SECRET: SECRET,
    FAITH_INSTALL_DAILY_LIMIT: "2",
    FAITH_INSTALL_MINUTE_LIMIT: "10"
  });
  const limiter = createFaithRateLimiter({ config, now: () => timestamp });
  const context = limiter.beginRequest({ installationId: "installation-1234567890", ipAddress: "203.0.113.10" });

  assert.equal(limiter.consumeProviderQuota(context).remaining, 1);
  assert.equal(limiter.consumeProviderQuota(context).remaining, 0);
  assert.throws(
    () => limiter.consumeProviderQuota(context),
    (error) => error instanceof FaithRateLimitError && error.code === "faith_install_daily_limit"
  );

  timestamp += 24 * 60 * 60 * 1000;
  assert.equal(limiter.consumeProviderQuota(context).remaining, 1);
});

test("burst limits count requests before provider usage", () => {
  const config = resolveFaithRateLimitConfig({
    FAITH_RATE_LIMIT_SECRET: SECRET,
    FAITH_INSTALL_MINUTE_LIMIT: "2",
    FAITH_IP_MINUTE_LIMIT: "10",
    FAITH_GLOBAL_MINUTE_LIMIT: "10"
  });
  const limiter = createFaithRateLimiter({ config, now: () => Date.UTC(2026, 7, 24, 12) });
  const input = { installationId: "installation-1234567890", ipAddress: "203.0.113.10" };

  limiter.beginRequest(input);
  limiter.beginRequest(input);
  assert.throws(
    () => limiter.beginRequest(input),
    (error) => error instanceof FaithRateLimitError && error.code === "faith_install_minute_limit"
  );
});

test("an internal fallback does not consume a second installation question", () => {
  const config = resolveFaithRateLimitConfig({
    FAITH_RATE_LIMIT_SECRET: SECRET,
    FAITH_INSTALL_DAILY_LIMIT: "2",
    FAITH_GLOBAL_DAILY_LIMIT: "2",
    FAITH_GLOBAL_MINUTE_LIMIT: "10"
  });
  const limiter = createFaithRateLimiter({ config, now: () => Date.UTC(2026, 7, 24, 12) });
  const context = limiter.beginRequest({ installationId: "installation-1234567890", ipAddress: "203.0.113.10" });

  assert.equal(limiter.consumeProviderQuota(context).remaining, 1);
  assert.equal(limiter.consumeAdditionalProviderQuota(context).remaining, 1);
  assert.throws(
    () => limiter.consumeAdditionalProviderQuota(context),
    (error) => error instanceof FaithRateLimitError && error.code === "faith_global_daily_limit"
  );
});

test("client IP uses the last proxy-appended forwarding value", () => {
  assert.equal(
    extractClientIp({ headers: { "x-forwarded-for": "198.51.100.99, 203.0.113.42" }, socket: {} }),
    "203.0.113.42"
  );
  assert.equal(extractClientIp({ headers: {}, socket: { remoteAddress: "::1" } }), "::1");
});
