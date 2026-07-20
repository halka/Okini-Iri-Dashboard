import type { APIRoute } from "astro";
import { appConfig } from "../../config/app";
import { ApiError, apiRoute, isHttpUrl, json, readJson, requiredText } from "../../lib/http";
import { readResponseText } from "../../lib/text-encoding";

type Payload = {
  url?: string;
};

const MAX_PREVIEW_BYTES = 1024 * 1024;

export const POST: APIRoute = apiRoute(async ({ request }) => {
  const body = await readJson<Payload>(request);
  const value = requiredText(body.url, "url", 65_536);
  if (!isHttpUrl(value)) throw new ApiError("An HTTP or HTTPS URL is required", 422, "validation_error");
  const url = new URL(value);

  const response = await fetch(url.toString(), {
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
    headers: {
      accept: "application/json, application/xml, text/xml, text/plain;q=0.8, */*;q=0.4",
      "user-agent": appConfig.previewUserAgent
    }
  });

  if (!response.ok) {
    throw new ApiError(`fetch failed: ${response.status}`, 422, "preview_fetch_failed");
  }

  const contentType = response.headers.get("content-type") ?? "";
  const { text, truncated } = await readResponseText(response, MAX_PREVIEW_BYTES);

  return json({
    preview: {
      url: response.url || url.toString(),
      contentType,
      text,
      truncated
    }
  });
});
