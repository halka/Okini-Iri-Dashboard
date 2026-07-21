import type { APIRoute } from "astro";
import { bulkUpdateBookmarkTags } from "../../../lib/repositories/bookmarks";
import { recordAuditLogSafely } from "../../../lib/repositories/audit";
import { getDb } from "../../../lib/d1";
import { ApiError, apiRoute, json, optionalStringArray, readJson } from "../../../lib/http";

type Payload = {
  bookmarkIds?: string[];
  addTagIds?: string[];
  removeTagIds?: string[];
};

export const PATCH: APIRoute = apiRoute(async ({ locals, request }) => {
  const body = await readJson<Payload>(request);
  const bookmarkIds = optionalStringArray(body.bookmarkIds, "bookmarkIds", 500);
  const addTagIds = optionalStringArray(body.addTagIds, "addTagIds", 100) ?? [];
  const removeTagIds = optionalStringArray(body.removeTagIds, "removeTagIds", 100) ?? [];
  if (!bookmarkIds?.length) throw new ApiError("At least one bookmark is required", 422, "validation_error");
  if (!addTagIds.length && !removeTagIds.length) throw new ApiError("At least one tag is required", 422, "validation_error");
  if (addTagIds.some((id) => removeTagIds.includes(id))) {
    throw new ApiError("A tag cannot be added and removed at the same time", 422, "validation_error");
  }
  const db = getDb(locals);
  const result = await bulkUpdateBookmarkTags(db, bookmarkIds, addTagIds, removeTagIds);
  await recordAuditLogSafely(db, locals.user, {
    action: "bookmarks.tags_updated",
    entityType: "bookmark",
    summary: `${result.bookmarks} bookmarks`,
    details: { bookmarkIds, addTagIds, removeTagIds }
  });
  return json(result);
});
