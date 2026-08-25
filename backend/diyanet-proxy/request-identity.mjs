export function extractClientIp(request) {
  const forwarded = headerValue(request, "x-forwarded-for")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (forwarded.length > 0) {
    return forwarded[forwarded.length - 1].slice(0, 128);
  }

  const railwayIp = headerValue(request, "x-real-ip").trim();
  if (railwayIp) return railwayIp.slice(0, 128);

  return String(request?.socket?.remoteAddress || "unknown").trim().slice(0, 128) || "unknown";
}

function headerValue(request, name) {
  const value = request?.headers?.[name];
  return Array.isArray(value) ? value.join(",") : String(value || "");
}
