import type { APIRoute } from "astro";
import { importBookmarksFile, seedImportedBookmarks } from "../../lib/repositories/import";
import { getDb } from "../../lib/d1";
import { parseChromeBookmarksHtml } from "../../lib/bookmark-html";
import { ApiError, apiRoute, json, optionalBoolean, readJson } from "../../lib/http";

type Payload = { force?: boolean; html?: string; source?: string };

export const POST: APIRoute = apiRoute(async ({ locals, request }) => {
  const body = await readJson<Payload>(request);
  const force = optionalBoolean(body.force, "force") ?? false;
  const uploadedHtml = body.html?.trim();
  if (uploadedHtml && new TextEncoder().encode(uploadedHtml).byteLength > 10 * 1024 * 1024) {
    throw new ApiError("Bookmark HTML is too large", 413, "payload_too_large");
  }
  const result = uploadedHtml
    ? await importBookmarksFile(getDb(locals), parseChromeBookmarksHtml(uploadedHtml, body.source?.trim() || "uploaded-bookmarks.html"), force)
    : await seedImportedBookmarks(getDb(locals), force);
  return json(result);
});
