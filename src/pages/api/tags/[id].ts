import type { APIRoute } from "astro";
import { deleteTag, getTag, isReservedTagName, updateTag } from "../../../lib/repositories/tags";
import { recordAuditLogSafely } from "../../../lib/repositories/audit";
import { getDb } from "../../../lib/d1";
import { ApiError, apiRoute, json, optionalHexColor, optionalText, readJson, requiredIdentifier } from "../../../lib/http";

type Payload = { name?: string; primaryColor?: string };

export const PATCH: APIRoute = apiRoute(async ({ locals, params, request }) => {
  const id = requiredIdentifier(params.id);
  const body = await readJson<Payload>(request);
  const name = optionalText(body.name, "name", 100);
  if (name !== undefined && !name) throw new ApiError("name cannot be empty", 422, "validation_error");
  if (name !== undefined && isReservedTagName(name)) throw new ApiError("This tag name is reserved", 422, "validation_error");
  const db = getDb(locals);
  const updated = await updateTag(db, id, { name, primaryColor: optionalHexColor(body.primaryColor, "primaryColor") });
  if (updated) {
    await recordAuditLogSafely(db, locals.user, {
      action: "tag.updated",
      entityType: "tag",
      entityId: id,
      summary: name ?? id
    });
  }
  return updated ? json({ ok: true }) : json({ error: "not found" }, 404);
});

export const DELETE: APIRoute = apiRoute(async ({ locals, params }) => {
  const id = requiredIdentifier(params.id);
  const db = getDb(locals);
  const tag = await getTag(db, id);
  const deleted = await deleteTag(db, id);
  if (deleted) {
    await recordAuditLogSafely(db, locals.user, {
      action: "tag.deleted",
      entityType: "tag",
      entityId: id,
      summary: tag?.name ?? id
    });
  }
  return deleted ? json({ ok: true }) : json({ error: "not found" }, 404);
});
