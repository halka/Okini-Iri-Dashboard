import type { APIRoute } from "astro";
import { importChromeBookmarks } from "../../lib/repositories/import";
import { getDb } from "../../lib/d1";
import { parseChromeBookmarksHtml } from "../../lib/bookmark-html";
import { ApiError, apiRoute, json, optionalBoolean, optionalText, readJson } from "../../lib/http";
import { normalizeUtf8Text } from "../../lib/text-encoding";

type Payload = { force?: boolean; html?: string; source?: string };

export const POST: APIRoute = apiRoute(async ({ locals, request }) => {
  const body = await readJson<Payload>(request, 11 * 1024 * 1024);
  const force = optionalBoolean(body.force, "force") ?? false;
  if (typeof body.html !== "string" || !body.html.trim()) {
    throw new ApiError("Chrome bookmark HTML is required", 422, "validation_error");
  }
  const uploadedHtml = normalizeUtf8Text(body.html).trim();
  if (new TextEncoder().encode(uploadedHtml).byteLength > 10 * 1024 * 1024) {
    throw new ApiError("Bookmark HTML is too large", 413, "payload_too_large");
  }
  if (!/<!doctype\s+netscape-bookmark-file-1\s*>/i.test(uploadedHtml)) {
    throw new ApiError("A Chrome bookmark HTML export is required", 422, "invalid_bookmark_html");
  }
  const source = optionalText(body.source, "source", 255) || "uploaded-bookmarks.html";
  const parsedBookmarks = parseChromeBookmarksHtml(uploadedHtml, source);
  if (!parsedBookmarks.bookmarks?.length && !parsedBookmarks.folders?.length) {
    throw new ApiError("The Chrome bookmark HTML export is empty", 422, "invalid_bookmark_html");
  }
  const result = await importChromeBookmarks(getDb(locals), parsedBookmarks, force, {
    blockedOrigins: new Set([new URL(request.url).origin])
  });
  return json(result);
});
