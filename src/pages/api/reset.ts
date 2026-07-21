import type { APIRoute } from "astro";
import { resetAllData } from "../../lib/repositories/reset";
import { recordAuditLogSafely } from "../../lib/repositories/audit";
import { getDb } from "../../lib/d1";
import { apiRoute, json } from "../../lib/http";

export const DELETE: APIRoute = apiRoute(async ({ locals }) => {
  const db = getDb(locals);
  const result = await resetAllData(db);
  await recordAuditLogSafely(db, locals.user, {
    action: "data.reset",
    entityType: "system",
    summary: `${result.bookmarks} bookmarks, ${result.tags} tags`,
    details: result
  });
  return json({ reset: true, ...result });
});
