import type { APIRoute } from "astro";
import { normalizeUtf8Text } from "./text-encoding";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "bad_request",
    readonly headers?: HeadersInit
  ) {
    super(message);
  }
}

export async function readJson<T>(request: Request, maxBytes = 256 * 1024): Promise<T> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new ApiError("Content-Type must be application/json", 415, "unsupported_media_type");
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number.isSafeInteger(Number(contentLength)) && Number(contentLength) > maxBytes) {
    throw new ApiError("Request body is too large", 413, "payload_too_large");
  }

  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Request body is missing");
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      byteLength += result.value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        throw new ApiError("Request body is too large", 413, "payload_too_large");
      }
      chunks.push(result.value);
    }

    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("JSON body must be an object");
    }
    return value as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("Invalid JSON body", 400, "invalid_json");
  }
}

export function json(data: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = new Headers(extraHeaders);
  headers.set("cache-control", "no-store");
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(data), {
    status,
    headers
  });
}

export function apiRoute(handler: APIRoute): APIRoute {
  return async (context) => {
    try {
      return await handler(context);
    } catch (error) {
      if (error instanceof ApiError) {
        return json({ error: error.message, code: error.code }, error.status, error.headers);
      }

      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("UNIQUE constraint failed")) {
        return json({ error: "A record with this value already exists", code: "conflict" }, 409);
      }
      if (message.includes("FOREIGN KEY constraint failed")) {
        return json({ error: "The referenced record does not exist", code: "invalid_reference" }, 422);
      }

      console.error(error);
      return json({ error: "Internal server error", code: "internal_error" }, 500);
    }
  };
}

export function isSupportedBookmarkUrl(url: string) {
  if (!url.trim() || url.length > 65_536 || /[\u0000-\u001f\u007f]/.test(url)) return false;
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "javascript:", "data:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function isHttpUrl(url: string) {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

export function requiredText(value: unknown, field: string, maxLength = 2_000) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(`${field} is required`, 422, "validation_error");
  }
  const text = normalizeUtf8Text(value).trim();
  if (text.length > maxLength) {
    throw new ApiError(`${field} is too long`, 422, "validation_error");
  }
  return text;
}

export function optionalText(value: unknown, field: string, maxLength = 10_000) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ApiError(`${field} must be a string`, 422, "validation_error");
  }
  const text = normalizeUtf8Text(value).trim();
  if (text.length > maxLength) {
    throw new ApiError(`${field} is too long`, 422, "validation_error");
  }
  return text;
}

export function optionalBoolean(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new ApiError(`${field} must be a boolean`, 422, "validation_error");
  }
  return value;
}

export function optionalHexColor(value: unknown, field: string) {
  const text = optionalText(value, field, 7);
  if (text === undefined) return undefined;
  if (!/^#[0-9a-fA-F]{6}$/.test(text)) {
    throw new ApiError(`${field} must be a hex color`, 422, "validation_error");
  }
  return text.toLowerCase();
}

export function optionalStringArray(value: unknown, field: string, maxItems = 100) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => typeof item !== "string" || item.length > 200)) {
    throw new ApiError(`${field} must be an array of strings`, 422, "validation_error");
  }
  const values = [...new Set(value.map((item) => normalizeUtf8Text(item).trim()).filter(Boolean))];
  if (values.some((item) => !isIdentifier(item))) {
    throw new ApiError(`${field} must contain valid identifiers`, 422, "validation_error");
  }
  return values;
}

export function optionalNullableId(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 200 || !isIdentifier(value)) {
    throw new ApiError(`${field} must be a valid identifier`, 422, "validation_error");
  }
  return value;
}

export function requiredIdentifier(value: string | undefined, field = "id") {
  if (!value || !isIdentifier(value)) {
    throw new ApiError(`${field} must be a valid identifier`, 422, "validation_error");
  }
  return value;
}

export function queryIdentifier(value: string | null, field: string) {
  const identifier = queryText(value, field, 200);
  if (identifier && !isIdentifier(identifier)) {
    throw new ApiError(`${field} must be a valid identifier`, 422, "validation_error");
  }
  return identifier;
}

export function queryText(value: string | null, field: string, maxLength = 2_000) {
  if (value === null) return undefined;
  if (/[\u0000-\u001f\u007f]/.test(value) || value.length > maxLength) {
    throw new ApiError(`${field} is invalid`, 422, "validation_error");
  }
  return normalizeUtf8Text(value).trim() || undefined;
}

function isIdentifier(value: string) {
  return /^[A-Za-z0-9_-]+$/.test(value);
}
