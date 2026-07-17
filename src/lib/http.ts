import type { APIRoute } from "astro";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "bad_request"
  ) {
    super(message);
  }
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ApiError("Invalid JSON body", 400, "invalid_json");
  }
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff"
    }
  });
}

export function apiRoute(handler: APIRoute): APIRoute {
  return async (context) => {
    try {
      return await handler(context);
    } catch (error) {
      if (error instanceof ApiError) {
        return json({ error: error.message, code: error.code }, error.status);
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
    return ["http:", "https:", "javascript:", "data:"].includes(parsed.protocol);
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
  const text = value.trim();
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
  const text = value.trim();
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

export function optionalStringArray(value: unknown, field: string, maxItems = 100) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => typeof item !== "string")) {
    throw new ApiError(`${field} must be an array of strings`, 422, "validation_error");
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

export function optionalNullableId(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 200) {
    throw new ApiError(`${field} must be a valid identifier`, 422, "validation_error");
  }
  return value;
}
