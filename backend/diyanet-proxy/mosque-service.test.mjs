import assert from "node:assert/strict";
import test from "node:test";
import { buildMosqueQuery, createMosqueService, validateMosqueSearchParams } from "./mosque-service.mjs";

test("mosque search validates coordinates and a bounded radius", () => {
  assert.equal(validateMosqueSearchParams({ lat: 52.37, lon: 4.9, radiusKm: 5 }).ok, true);
  assert.equal(validateMosqueSearchParams({ lat: 91, lon: 4.9, radiusKm: 5 }).ok, false);
  assert.equal(validateMosqueSearchParams({ lat: 52.37, lon: 181, radiusKm: 5 }).ok, false);
  assert.equal(validateMosqueSearchParams({ lat: 52.37, lon: 4.9, radiusKm: 100 }).ok, false);
});

test("mosque query is limited to Muslim places of worship around the requested point", () => {
  const query = buildMosqueQuery(52.3676, 4.9041, 5);
  assert.match(query, /religion"="muslim/);
  assert.match(query, /around:5000,52\.3676,4\.9041/);
  assert.match(query, /out center/);
});

test("mosque service falls back to another endpoint and caches sanitized results", async () => {
  let calls = 0;
  const service = createMosqueService({
    endpoints: ["https://first.invalid", "https://second.example"],
    fetchImpl: async (url) => {
      calls += 1;
      if (url.includes("first")) return new Response("no", { status: 503 });
      return new Response(
        JSON.stringify({
          elements: [
            { type: "node", id: 7, lat: 52.36, lon: 4.9, tags: { name: "Test Mosque", invalid: 123 } }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
  });

  const first = await service.search({ lat: 52.3676, lon: 4.9041, radiusKm: 5 });
  const second = await service.search({ lat: 52.3676, lon: 4.9041, radiusKm: 5 });

  assert.equal(first.source, "network");
  assert.equal(first.elements[0].tags.name, "Test Mosque");
  assert.equal("invalid" in first.elements[0].tags, false);
  assert.equal(second.source, "cache");
  assert.equal(calls, 2);
});

test("mosque service returns recent stale cache when every provider is unavailable", async () => {
  let currentTime = 1_000;
  let online = true;
  const service = createMosqueService({
    endpoints: ["https://overpass.example"],
    cacheTtlMs: 100,
    staleTtlMs: 1_000,
    now: () => currentTime,
    fetchImpl: async () => {
      if (!online) throw new Error("offline");
      return new Response(JSON.stringify({ elements: [] }), { status: 200 });
    }
  });

  await service.search({ lat: 52.3676, lon: 4.9041, radiusKm: 5 });
  online = false;
  currentTime += 200;
  const fallback = await service.search({ lat: 52.3676, lon: 4.9041, radiusKm: 5, forceRefresh: true });

  assert.equal(fallback.source, "cache");
  assert.equal(fallback.stale, true);
});
