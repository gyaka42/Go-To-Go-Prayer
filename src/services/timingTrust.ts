export type TimingTrust = "live" | "recent-cache" | "stale-cache" | "needs-check" | "unknown";

const STALE_CACHE_AFTER_DAYS = 35;

export function evaluateTimingTrust(params: {
  source: "api" | "cache" | null;
  lastUpdated: string | null;
  hasWarnings: boolean;
  now?: Date;
}): TimingTrust {
  if (params.hasWarnings) {
    return "needs-check";
  }

  if (params.source === "api") {
    return "live";
  }

  if (params.source !== "cache") {
    return "unknown";
  }

  if (!params.lastUpdated) {
    return "stale-cache";
  }

  const updatedAt = new Date(params.lastUpdated).getTime();
  if (Number.isNaN(updatedAt)) {
    return "stale-cache";
  }

  const now = params.now?.getTime() ?? Date.now();
  const ageDays = Math.max(0, now - updatedAt) / (24 * 60 * 60 * 1000);
  return ageDays > STALE_CACHE_AFTER_DAYS ? "stale-cache" : "recent-cache";
}
