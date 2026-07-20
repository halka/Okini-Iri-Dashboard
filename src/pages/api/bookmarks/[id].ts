import type { APIRoute } from "astro";
import { deleteBookmark, getBookmark, updateBookmark } from "../../../lib/repositories/bookmarks";
import { getDb } from "../../../lib/d1";
import {
  ApiError,
  apiRoute,
  isSupportedBookmarkUrl,
  json,
  optionalBoolean,
  optionalNullableId,
  optionalStringArray,
  optionalText,
  readJson,
  requiredIdentifier
} from "../../../lib/http";

type Payload = {
  title?: string;
  url?: string;
  faviconUrl?: string;
  folderId?: string | null;
  description?: string;
  notes?: string;
  favorite?: boolean;
  structuredPreviewEnabled?: boolean;
  tagIds?: string[];
};

export const GET: APIRoute = apiRoute(async ({ locals, params }) => {
  const bookmark = await getBookmark(getDb(locals), requiredIdentifier(params.id));
  return bookmark ? json({ bookmark }) : json({ error: "not found" }, 404);
});

export const PATCH: APIRoute = apiRoute(async ({ locals, params, request }) => {
  const body = await readJson<Payload>(request);
  const title = optionalText(body.title, "title", 500);
  if (title !== undefined && !title) throw new ApiError("title cannot be empty", 422, "validation_error");
  const url = optionalText(body.url, "url", 65_536);
  if (url !== undefined && !isSupportedBookmarkUrl(url)) {
    throw new ApiError("A supported URL is required", 422, "validation_error");
  }
  const updated = await updateBookmark(getDb(locals), requiredIdentifier(params.id), {
    title,
    url,
    folderId: optionalNullableId(body.folderId, "folderId"),
    faviconUrl: optionalText(body.faviconUrl, "faviconUrl", 4_096),
    description: optionalText(body.description, "description", 5_000),
    notes: optionalText(body.notes, "notes", 20_000),
    favorite: optionalBoolean(body.favorite, "favorite"),
    structuredPreviewEnabled: optionalBoolean(body.structuredPreviewEnabled, "structuredPreviewEnabled"),
    tagIds: optionalStringArray(body.tagIds, "tagIds")
  });
  return updated ? json({ ok: true }) : json({ error: "not found" }, 404);
});

export const DELETE: APIRoute = apiRoute(async ({ locals, params }) => {
  const deleted = await deleteBookmark(getDb(locals), requiredIdentifier(params.id));
  return deleted ? json({ ok: true }) : json({ error: "not found" }, 404);
});
