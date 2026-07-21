import type { APIRoute } from "astro";
import { getDb } from "../../lib/d1";
import { ApiError, apiRoute, json, queryText } from "../../lib/http";
import { listAuditLogs } from "../../lib/repositories/audit";

export const GET: APIRoute = apiRoute(async ({ locals, url }) => {
  const limitValue = queryText(url.searchParams.get("limit"), "limit");
  const limit = limitValue ? Number(limitValue) : 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new ApiError("limit is invalid", 422, "validation_error");
  }
  return json({ auditLogs: await listAuditLogs(getDb(locals), limit) });
});
