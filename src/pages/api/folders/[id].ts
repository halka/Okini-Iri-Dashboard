import type { APIRoute } from "astro";
import { deleteFolder, updateFolder } from "../../../lib/repositories/folders";
import { getDb } from "../../../lib/d1";
import { ApiError, apiRoute, json, optionalNullableId, optionalText, readJson } from "../../../lib/http";

type Payload = { name?: string; parentId?: string | null };

export const PATCH: APIRoute = apiRoute(async ({ locals, params, request }) => {
  const body = await readJson<Payload>(request);
  const name = optionalText(body.name, "name", 200);
  if (name !== undefined && !name) throw new ApiError("name cannot be empty", 422, "validation_error");
  const updated = await updateFolder(getDb(locals), params.id ?? "", {
    name,
    parentId: optionalNullableId(body.parentId, "parentId")
  });
  if (updated.status === "not_found") return json({ error: "not found" }, 404);
  if (updated.status === "cycle") {
    throw new ApiError("A folder cannot be moved inside itself", 422, "folder_cycle");
  }
  return json({ ok: true });
});

export const DELETE: APIRoute = apiRoute(async ({ locals, params }) => {
  const result = await deleteFolder(getDb(locals), params.id ?? "");
  if (result.status === "not_found") return json({ error: "not found" }, 404);
  return json({ ok: true, bookmarkCount: result.bookmarkCount, childCount: result.childCount });
});
