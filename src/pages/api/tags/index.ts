import type { APIRoute } from "astro";
import { createTag, listTags } from "../../../lib/repositories/tags";
import { getDb } from "../../../lib/d1";
import { apiRoute, json, optionalHexColor, readJson, requiredText } from "../../../lib/http";

type Payload = { name?: string; primaryColor?: string };

export const GET: APIRoute = apiRoute(async ({ locals }) => {
  const tags = await listTags(getDb(locals));
  return json({ tags });
});

export const POST: APIRoute = apiRoute(async ({ locals, request }) => {
  const body = await readJson<Payload>(request);
  const result = await createTag(getDb(locals), {
    name: requiredText(body.name, "name", 100),
    primaryColor: optionalHexColor(body.primaryColor, "primaryColor") ?? "#4f8cff"
  });
  return json(result, 201);
});
