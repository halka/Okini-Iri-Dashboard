import type { APIRoute } from "astro";
import { createFolder, listFolders } from "../../../lib/repositories/folders";
import { getDb } from "../../../lib/d1";
import { apiRoute, json, optionalNullableId, readJson, requiredText } from "../../../lib/http";

type Payload = { name?: string; parentId?: string | null };

export const GET: APIRoute = apiRoute(async ({ locals }) => {
  const folders = await listFolders(getDb(locals));
  return json({ folders });
});

export const POST: APIRoute = apiRoute(async ({ locals, request }) => {
  const body = await readJson<Payload>(request);
  const result = await createFolder(getDb(locals), {
    name: requiredText(body.name, "name", 200),
    parentId: optionalNullableId(body.parentId, "parentId") ?? null
  });
  return json(result, 201);
});
