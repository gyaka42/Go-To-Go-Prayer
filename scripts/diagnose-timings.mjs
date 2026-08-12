const DEFAULT_PROXY_URL = "https://go-to-go-prayer-production.up.railway.app";
const PRAYERS = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"];

const proxyBaseUrl = (process.env.EXPO_PUBLIC_DIYANET_PROXY_URL || DEFAULT_PROXY_URL).replace(/\/+$/, "");

const cases = [
  {
    id: "beysehir-konya-aug-2026",
    label: "Beysehir, Konya",
    lat: 37.8721,
    lon: 31.8529,
    city: "Beysehir",
    state: "Konya",
    country: "Turkey",
    expectedCityId: 9660,
    dates: [
      {
        date: "10-08-2026",
        expected: {
          Fajr: "04:25",
          Sunrise: "05:57",
          Dhuhr: "13:04",
          Asr: "16:51",
          Maghrib: "20:00",
          Isha: "21:26"
        }
      },
      {
        date: "11-08-2026",
        expected: {
          Fajr: "04:26",
          Sunrise: "05:58",
          Dhuhr: "13:03",
          Asr: "16:50",
          Maghrib: "19:59",
          Isha: "21:24"
        }
      }
    ]
  },
  {
    id: "beysehir-neighborhood-hint",
    label: "Yenidogan neighborhood, Beysehir/Konya",
    lat: 37.8721,
    lon: 31.8529,
    city: "Yenidoğan",
    state: "Konya",
    country: "Türkiye",
    expectedCityId: 9660,
    dates: [
      {
        date: "10-08-2026",
        expected: {
          Fajr: "04:25",
          Sunrise: "05:57",
          Dhuhr: "13:04",
          Asr: "16:51",
          Maghrib: "20:00",
          Isha: "21:26"
        }
      },
      {
        date: "11-08-2026",
        expected: {
          Fajr: "04:26",
          Sunrise: "05:58",
          Dhuhr: "13:03",
          Asr: "16:50",
          Maghrib: "19:59",
          Isha: "21:24"
        }
      }
    ]
  },
  {
    id: "bayrakli-izmir-turkish-hint",
    label: "Bayrakli, Izmir (Turkish hint)",
    lat: 38.4627,
    lon: 27.1667,
    city: "Bayraklı",
    state: "İzmir",
    country: "Türkiye",
    expectedCityId: 9560,
    dates: [
      {
        date: "10-08-2026",
        expected: { Fajr: "04:40", Sunrise: "06:14", Dhuhr: "13:22", Asr: "17:10", Maghrib: "20:20", Isha: "21:47" }
      },
      {
        date: "11-08-2026",
        expected: { Fajr: "04:42", Sunrise: "06:15", Dhuhr: "13:22", Asr: "17:09", Maghrib: "20:19", Isha: "21:45" }
      }
    ]
  },
  {
    id: "bayrakli-izmir-sample",
    label: "Bayrakli, Izmir",
    lat: 38.4627,
    lon: 27.1667,
    city: "Bayrakli",
    state: "Izmir",
    country: "Turkey",
    expectedCityId: 9560,
    dates: [
      {
        date: "10-08-2026",
        expected: { Fajr: "04:40", Sunrise: "06:14", Dhuhr: "13:22", Asr: "17:10", Maghrib: "20:20", Isha: "21:47" }
      },
      {
        date: "11-08-2026",
        expected: { Fajr: "04:42", Sunrise: "06:15", Dhuhr: "13:22", Asr: "17:09", Maghrib: "20:19", Isha: "21:45" }
      }
    ]
  }
];

function timeToMinutes(value) {
  if (typeof value !== "string") {
    return null;
  }
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function normalizedDayDiff(current, next) {
  const direct = Math.abs(next - current);
  return Math.min(direct, Math.abs(next + 24 * 60 - current), Math.abs(current + 24 * 60 - next));
}

function formatTimes(times) {
  if (!times || typeof times !== "object") {
    return "(missing times)";
  }
  return PRAYERS.map((prayer) => `${prayer}=${times[prayer] || "--:--"}`).join(" ");
}

function buildTimingsUrl(testCase, date, opts = {}) {
  const url = new URL(`${proxyBaseUrl}/timings`);
  url.searchParams.set("lat", String(testCase.lat));
  url.searchParams.set("lon", String(testCase.lon));
  url.searchParams.set("date", date);
  if (testCase.city) {
    url.searchParams.set("city", testCase.city);
  }
  if (testCase.state) {
    url.searchParams.set("state", testCase.state);
  }
  if (testCase.country) {
    url.searchParams.set("country", testCase.country);
  }
  if (opts.cityId) {
    url.searchParams.set("cityId", String(opts.cityId));
  }
  return url;
}

function buildMonthlyUrl(testCase, year, month, opts = {}) {
  const url = new URL(`${proxyBaseUrl}/timings/monthly`);
  url.searchParams.set("lat", String(testCase.lat));
  url.searchParams.set("lon", String(testCase.lon));
  url.searchParams.set("year", String(year));
  url.searchParams.set("month", String(month));
  if (testCase.city) {
    url.searchParams.set("city", testCase.city);
  }
  if (testCase.state) {
    url.searchParams.set("state", testCase.state);
  }
  if (testCase.country) {
    url.searchParams.set("country", testCase.country);
  }
  if (opts.cityId) {
    url.searchParams.set("cityId", String(opts.cityId));
  }
  return url;
}

async function fetchJson(url) {
  const startedAt = Date.now();
  const response = await fetch(url);
  const elapsedMs = Date.now() - startedAt;
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} after ${elapsedMs}ms: ${JSON.stringify(payload)}`);
  }
  return { payload, elapsedMs };
}

function compareExpected(row, expected) {
  if (!expected) {
    return [];
  }
  const issues = [];
  for (const prayer of PRAYERS) {
    const actual = row.times?.[prayer];
    const wanted = expected[prayer];
    if (!wanted) {
      continue;
    }
    if (actual !== wanted) {
      issues.push(`${prayer} expected ${wanted}, got ${actual || "missing"}`);
    }
  }
  return issues;
}

function compareRows(current, next) {
  const issues = [];
  if (!current || !next) {
    return issues;
  }
  if (current.source !== next.source) {
    issues.push(`source mismatch: ${current.date}=${current.source || "unknown"} vs ${next.date}=${next.source || "unknown"}`);
  }
  if (current.cityId && next.cityId && current.cityId !== next.cityId) {
    issues.push(`cityId mismatch: ${current.date}=${current.cityId} vs ${next.date}=${next.cityId}`);
  }
  if (current.citySource !== next.citySource) {
    issues.push(
      `citySource mismatch: ${current.date}=${current.citySource || "none"} vs ${next.date}=${next.citySource || "none"}`
    );
  }
  for (const prayer of PRAYERS) {
    const a = timeToMinutes(current.times?.[prayer]);
    const b = timeToMinutes(next.times?.[prayer]);
    if (a === null || b === null) {
      continue;
    }
    const diff = normalizedDayDiff(a, b);
    if (diff > 20) {
      issues.push(`${prayer} jumps ${diff} minutes between ${current.date} and ${next.date}`);
    }
  }
  return issues;
}

function summarizePayload(date, payload, elapsedMs, mode) {
  return {
    date,
    mode,
    elapsedMs,
    source: typeof payload?.source === "string" ? payload.source : "unknown",
    cityId: Number.isFinite(Number(payload?.cityId)) ? Number(payload.cityId) : null,
    citySource: typeof payload?.citySource === "string" ? payload.citySource : null,
    cityDistanceKm: Number.isFinite(Number(payload?.cityDistanceKm)) ? Number(payload.cityDistanceKm) : null,
    resolvedCityName: typeof payload?.resolvedCityName === "string" ? payload.resolvedCityName : null,
    resolvedCountryName: typeof payload?.resolvedCountryName === "string" ? payload.resolvedCountryName : null,
    times: payload?.times && typeof payload.times === "object" ? payload.times : null
  };
}

function printRow(row) {
  const cityBits = [
    row.cityId ? `cityId=${row.cityId}` : "cityId=missing",
    row.citySource ? `citySource=${row.citySource}` : "citySource=missing",
    row.resolvedCityName ? `resolved=${row.resolvedCityName}` : null,
    row.cityDistanceKm != null ? `distance=${row.cityDistanceKm.toFixed(1)}km` : null
  ].filter(Boolean);
  console.log(`  ${row.date} [${row.mode}] source=${row.source} ${cityBits.join(" ")} (${row.elapsedMs}ms)`);
  console.log(`    ${formatTimes(row.times)}`);
}

async function runCase(testCase) {
  console.log(`\n=== ${testCase.label} (${testCase.id}) ===`);
  console.log(
    `coords=${testCase.lat},${testCase.lon} hint=${[testCase.city, testCase.state, testCase.country].filter(Boolean).join(", ")}`
  );
  if (testCase.expectedCityId) {
    console.log(`expected cityId=${testCase.expectedCityId}`);
  }

  const rows = [];
  for (const dateSpec of testCase.dates) {
    const mode = "hint";
    const url = buildTimingsUrl(testCase, dateSpec.date);
    const { payload, elapsedMs } = await fetchJson(url);
    const row = summarizePayload(dateSpec.date, payload, elapsedMs, mode);
    rows.push(row);
    printRow(row);

    if (testCase.expectedCityId && row.cityId !== testCase.expectedCityId) {
      console.log(`    WARN expected cityId ${testCase.expectedCityId}, got ${row.cityId || "missing"}`);
    }
    if (row.source.includes("coordinate-fallback") || row.citySource === "coordinate-fallback") {
      console.log("    WARN official city resolution failed; coordinate fallback is active");
    }

    const expectedIssues = compareExpected(row, dateSpec.expected);
    for (const issue of expectedIssues) {
      console.log(`    WARN expected mismatch: ${issue}`);
    }
  }

  if (testCase.expectedCityId) {
    const forcedRows = [];
    console.log("  forced-cityId probe:");
    for (const dateSpec of testCase.dates) {
      const url = buildTimingsUrl(testCase, dateSpec.date, { cityId: testCase.expectedCityId });
      const { payload, elapsedMs } = await fetchJson(url);
      const row = summarizePayload(dateSpec.date, payload, elapsedMs, "forced-cityId");
      forcedRows.push(row);
      printRow(row);
    }
    const forcedIssues = compareRows(forcedRows[0], forcedRows[1]);
    for (const issue of forcedIssues) {
      console.log(`    WARN forced-cityId consistency: ${issue}`);
    }
  }

  const consistencyIssues = compareRows(rows[0], rows[1]);
  for (const issue of consistencyIssues) {
    console.log(`  WARN consistency: ${issue}`);
  }

  const [, month, year] = testCase.dates[0].date.split("-").map(Number);
  const monthlyUrl = buildMonthlyUrl(testCase, year, month, testCase.expectedCityId ? { cityId: testCase.expectedCityId } : {});
  try {
    const { payload, elapsedMs } = await fetchJson(monthlyUrl);
    const days = payload?.days && typeof payload.days === "object" ? payload.days : {};
    const available = Object.keys(days).length;
    console.log(
      `  monthly probe source=${payload?.source || "unknown"} cityId=${payload?.cityId || "missing"} days=${available} (${elapsedMs}ms)`
    );
  } catch (error) {
    console.log(`  WARN monthly probe failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  console.log(`Diyanet proxy: ${proxyBaseUrl}`);
  const selected = process.argv.slice(2);
  const selectedCases = selected.length > 0 ? cases.filter((item) => selected.includes(item.id)) : cases;
  if (selectedCases.length === 0) {
    console.error(`No matching cases. Available: ${cases.map((item) => item.id).join(", ")}`);
    process.exit(1);
  }

  for (const testCase of selectedCases) {
    try {
      await runCase(testCase);
    } catch (error) {
      console.error(`\nFAIL ${testCase.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
