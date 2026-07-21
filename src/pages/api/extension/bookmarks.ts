import type { APIRoute } from "astro";
import { createBookmark } from "../../../lib/repositories/bookmarks";
import { ensureTagIdsByName } from "../../../lib/repositories/tags";
import { getDb } from "../../../lib/d1";
import { requireExtensionToken } from "../../../lib/extension-auth";
import { ApiError, apiRoute, isHttpUrl, json, optionalBoolean, optionalText, readJson, requiredText } from "../../../lib/http";
import { consumeRateLimit } from "../../../lib/rate-limit";
import { recordAuditLogSafely } from "../../../lib/repositories/audit";

type Payload = {
  title?: string;
  url?: string;
  faviconUrl?: string;
  favorite?: boolean;
  tagNames?: unknown;
};

const corsHeaders = {
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-origin": "*"
};

export const OPTIONS: APIRoute = async () => new Response(null, { status: 204, headers: corsHeaders });

export const GET: APIRoute = apiRoute(async ({ request }) => {
  await requireExtensionToken(request);
  return json({ ok: true }, 200, corsHeaders);
});

export const POST: APIRoute = apiRoute(async ({ locals, request }) => {
  await requireExtensionToken(request);
  const limit = consumeRateLimit(request, "browser-extension", 60, 60_000);
  if (!limit.allowed) {
    throw new ApiError("Too many extension requests", 429, "rate_limited", {
      ...corsHeaders,
      "retry-after": String(limit.retryAfter)
    });
  }

  const body = await readJson<Payload>(request);
  const title = requiredText(body.title, "title", 500);
  const url = requiredText(body.url, "url", 65_536);
  if (!isHttpUrl(url)) throw new ApiError("An HTTP(S) URL is required", 422, "validation_error");
  if (body.tagNames !== undefined && !Array.isArray(body.tagNames)) {
    throw new ApiError("tagNames must be an array", 422, "validation_error");
  }
  const tagNames = [...new Set((body.tagNames ?? []).map((name) => requiredText(name, "tagName", 100)))].slice(0, 20);
  const db = getDb(locals);
  const tagIds = await ensureTagIdsByName(db, tagNames);
  const result = await createBookmark(db, {
    title,
    url,
    faviconUrl: optionalText(body.faviconUrl, "faviconUrl", 65_536),
    favorite: optionalBoolean(body.favorite, "favorite"),
    tagIds
  });
  await recordAuditLogSafely(
    db,
    {
      subject: "browser-extension",
      issuer: "urn:browser-extension",
      name: "Browser extension",
      email: null,
      preferredUsername: null,
      local: false
    },
    { action: "bookmark.created", entityType: "bookmark", entityId: result.id, summary: title }
  );
  return json(result, 201, corsHeaders);
});
