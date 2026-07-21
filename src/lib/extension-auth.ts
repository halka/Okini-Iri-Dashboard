import { env } from "cloudflare:workers";
import { ApiError } from "./http";

export async function requireExtensionToken(request: Request) {
  const expected = env.EXTENSION_API_TOKEN?.trim();
  if (!expected) {
    throw new ApiError("Browser extension access is not configured", 503, "extension_not_configured");
  }

  const authorization = request.headers.get("authorization") ?? "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!provided || !(await equalTokens(provided, expected))) {
    throw new ApiError("Invalid browser extension token", 401, "invalid_extension_token");
  }
}

async function equalTokens(left: string, right: string) {
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right))
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < Math.max(leftBytes.length, rightBytes.length); index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}
