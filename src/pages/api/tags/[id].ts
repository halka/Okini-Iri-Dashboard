import type { APIRoute } from "astro";
import { deleteTag, updateTag } from "../../../lib/repositories/tags";
import { getDb } from "../../../lib/d1";
import { ApiError, apiRoute, json, optionalHexColor, optionalText, readJson, requiredIdentifier } from "../../../lib/http";

type Payload = { name?: string; primaryColor?: string };

export const PATCH: APIRoute = apiRoute(async ({ locals, params, request }) => {
  const body = await readJson<Payload>(request);
  const name = optionalText(body.name, "name", 100);
  if (name !== undefined && !name) throw new ApiError("name cannot be empty", 422, "validation_error");
  const updated = await updateTag(getDb(locals), requiredIdentifier(params.id), { name, primaryColor: optionalHexColor(body.primaryColor, "primaryColor") });
  return updated ? json({ ok: true }) : json({ error: "not found" }, 404);
});

export const DELETE: APIRoute = apiRoute(async ({ locals, params }) => {
  const deleted = await deleteTag(getDb(locals), requiredIdentifier(params.id));
  return deleted ? json({ ok: true }) : json({ error: "not found" }, 404);
});
