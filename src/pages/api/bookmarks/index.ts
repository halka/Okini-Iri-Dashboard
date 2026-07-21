import type { APIRoute } from "astro";
import { createBookmark, listBookmarks } from "../../../lib/repositories/bookmarks";
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
  queryIdentifier,
  queryText,
  readJson,
  requiredText
} from "../../../lib/http";

type Payload = {
  title?: string;
  url?: string;
  faviconUrl?: string;
  folderId?: string | null;
  description?: string;
  notes?: string;
  favorite?: boolean;
  vpnRequired?: boolean;
  structuredPreviewEnabled?: boolean;
  tagIds?: string[];
};

export const GET: APIRoute = apiRoute(async ({ locals, url }) => {
  const favoriteValue = queryText(url.searchParams.get("favorite"), "favorite");
  if (favoriteValue && favoriteValue !== "true" && favoriteValue !== "false") {
    throw new ApiError("favorite is invalid", 422, "validation_error");
  }
  const bookmarks = await listBookmarks(getDb(locals), {
    query: queryText(url.searchParams.get("q"), "q"),
    tagId: queryIdentifier(url.searchParams.get("tagId"), "tagId"),
    favorite: favoriteValue === "true"
  });
  return json({ bookmarks });
});

export const POST: APIRoute = apiRoute(async ({ locals, request }) => {
  const body = await readJson<Payload>(request);
  const title = requiredText(body.title, "title", 500);
  const url = requiredText(body.url, "url", 65_536);
  if (!isSupportedBookmarkUrl(url)) throw new ApiError("A supported URL is required", 422, "validation_error");
  const result = await createBookmark(getDb(locals), {
    title,
    url,
    faviconUrl: optionalText(body.faviconUrl, "faviconUrl", 65_536),
    folderId: optionalNullableId(body.folderId, "folderId") ?? null,
    description: optionalText(body.description, "description", 5_000),
    notes: optionalText(body.notes, "notes", 20_000),
    favorite: optionalBoolean(body.favorite, "favorite"),
    vpnRequired: optionalBoolean(body.vpnRequired, "vpnRequired"),
    structuredPreviewEnabled: optionalBoolean(body.structuredPreviewEnabled, "structuredPreviewEnabled"),
    tagIds: optionalStringArray(body.tagIds, "tagIds")
  });
  return json(result, 201);
});
