import type { APIRoute } from "astro";
import { reorderBookmarks } from "../../../lib/repositories/bookmarks";
import { recordAuditLogSafely } from "../../../lib/repositories/audit";
import { getDb } from "../../../lib/d1";
import { ApiError, apiRoute, json, optionalStringArray, readJson } from "../../../lib/http";

type Payload = { ids?: string[] };

export const PATCH: APIRoute = apiRoute(async ({ locals, request }) => {
  const body = await readJson<Payload>(request);
  const ids = optionalStringArray(body.ids, "ids", 500);
  if (!ids?.length) throw new ApiError("At least one bookmark is required", 422, "validation_error");
  const db = getDb(locals);
  const updated = await reorderBookmarks(db, ids);
  await recordAuditLogSafely(db, locals.user, {
    action: "bookmarks.reordered",
    entityType: "bookmark",
    summary: `${updated} bookmarks`,
    details: { bookmarkIds: ids }
  });
  return json({ updated });
});
