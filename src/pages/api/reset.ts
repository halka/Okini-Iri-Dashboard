import type { APIRoute } from "astro";
import { resetAllData } from "../../lib/repositories/reset";
import { getDb } from "../../lib/d1";
import { apiRoute, json } from "../../lib/http";

export const DELETE: APIRoute = apiRoute(async ({ locals }) => {
  const result = await resetAllData(getDb(locals));
  return json({ reset: true, ...result });
});
