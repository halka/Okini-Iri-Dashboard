import type { APIRoute } from "astro";
import { getKv } from "../../lib/kv";
import { readPreferences, writePreferences } from "../../lib/preferences";
import { isColorMode, isLocale } from "../../config/preferences";
import { ApiError, apiRoute, json, readJson } from "../../lib/http";

type Payload = {
  locale?: unknown;
  colorMode?: unknown;
};

export const GET: APIRoute = apiRoute(async ({ locals }) => {
  const preferences = await readPreferences(getKv(locals));
  return json({ preferences });
});

export const PATCH: APIRoute = apiRoute(async ({ locals, request }) => {
  const body = await readJson<Payload>(request);
  if (body.locale !== undefined && !isLocale(body.locale)) {
    throw new ApiError("Unsupported locale", 422, "validation_error");
  }
  if (body.colorMode !== undefined && !isColorMode(body.colorMode)) {
    throw new ApiError("Unsupported color mode", 422, "validation_error");
  }
  const preferences = await writePreferences(getKv(locals), body);
  return json({ preferences });
});
