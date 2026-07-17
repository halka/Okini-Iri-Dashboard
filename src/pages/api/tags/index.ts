import type { APIRoute } from "astro";
import { createTag, listTags } from "../../../lib/repositories/tags";
import { getDb } from "../../../lib/d1";
import { apiRoute, json, readJson, requiredText } from "../../../lib/http";

type Payload = { name?: string };

export const GET: APIRoute = apiRoute(async ({ locals }) => {
  const tags = await listTags(getDb(locals));
  return json({ tags });
});

export const POST: APIRoute = apiRoute(async ({ locals, request }) => {
  const body = await readJson<Payload>(request);
  const result = await createTag(getDb(locals), { name: requiredText(body.name, "name", 100) });
  return json(result, 201);
});
