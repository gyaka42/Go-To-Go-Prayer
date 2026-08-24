export class HttpBodyError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "HttpBodyError";
    this.code = options.code || "invalid_body";
    this.status = options.status || 400;
  }
}

export async function readJsonBody(request, options = {}) {
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : 8192;
  const contentType = String(request.headers?.["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw new HttpBodyError("Content-Type must be application/json.", {
      code: "unsupported_media_type",
      status: 415
    });
  }

  const contentLength = Number(request.headers?.["content-length"] || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    request.resume?.();
    throw bodyTooLarge(maxBytes);
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      request.resume?.();
      throw bodyTooLarge(maxBytes);
    }
    chunks.push(buffer);
  }

  if (totalBytes === 0) {
    throw new HttpBodyError("Request body is empty.", {
      code: "empty_body",
      status: 400
    });
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpBodyError("Request body contains invalid JSON.", {
      code: "invalid_json",
      status: 400
    });
  }
}

function bodyTooLarge(maxBytes) {
  return new HttpBodyError(`Request body exceeds ${maxBytes} bytes.`, {
    code: "body_too_large",
    status: 413
  });
}
