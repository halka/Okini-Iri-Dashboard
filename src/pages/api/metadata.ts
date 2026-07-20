import type { APIRoute } from "astro";
import { ApiError, apiRoute, isHttpUrl, json, readJson, requiredText } from "../../lib/http";
import { fetchUrlMetadata } from "../../lib/metadata";

type Payload = {
  url?: string;
};

export const POST: APIRoute = apiRoute(async ({ request }) => {
  const body = await readJson<Payload>(request);
  const value = requiredText(body.url, "url", 65_536);
  const url = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  if (!isHttpUrl(url)) throw new ApiError("An HTTP or HTTPS URL is required", 422, "validation_error");

  try {
    const metadata = await fetchUrlMetadata(url, { blockedOrigins: new Set([new URL(request.url).origin]) });
    return json({ metadata });
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : "metadata fetch failed", 422, "metadata_fetch_failed");
  }
});
