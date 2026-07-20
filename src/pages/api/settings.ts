import type { APIRoute } from "astro";
import { isTokenAuthMethod, type AppSettings, type TokenAuthMethod } from "../../config/settings";
import { ApiError, apiRoute, isHttpUrl, json, optionalText, readJson } from "../../lib/http";
import { getKv } from "../../lib/kv";
import { publicAppSettings, readAppSettings, writeAppSettings } from "../../lib/settings";

type SettingsPayload = {
  site?: {
    title?: unknown;
    description?: unknown;
    url?: unknown;
    siteName?: unknown;
    ogImage?: unknown;
    locale?: unknown;
    alternateLocale?: unknown;
    twitterCard?: unknown;
  };
  oidc?: {
    issuerUrl?: unknown;
    clientId?: unknown;
    tokenAuthMethod?: unknown;
    scopes?: unknown;
    allowedEmails?: unknown;
    allowedDomains?: unknown;
    sessionTtlSeconds?: unknown;
  };
};

function optionalHttpUrl(value: unknown, field: string) {
  const url = optionalText(value, field, 2_000);
  if (url && !isHttpUrl(url)) throw new ApiError(`${field} must be an HTTP(S) URL`, 422, "validation_error");
  return url;
}

function optionalHttpsUrl(value: unknown, field: string) {
  const url = optionalHttpUrl(value, field);
  if (url && new URL(url).protocol !== "https:") throw new ApiError(`${field} must use HTTPS`, 422, "validation_error");
  return url;
}

function optionalImageReference(value: unknown) {
  const image = optionalText(value, "ogImage", 2_000);
  if (!image) return image;
  if (image.startsWith("/")) return image;
  if (!isHttpUrl(image)) throw new ApiError("ogImage must be a root-relative or HTTP(S) URL", 422, "validation_error");
  return image;
}

function optionalPositiveInteger(value: unknown, field: string, min: number, max: number) {
  if (value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ApiError(`${field} is out of range`, 422, "validation_error");
  }
  return parsed;
}

function validatePayload(body: SettingsPayload) {
  const tokenAuthValue = body.oidc?.tokenAuthMethod;
  if (tokenAuthValue !== undefined && tokenAuthValue !== "" && !isTokenAuthMethod(tokenAuthValue)) {
    throw new ApiError("tokenAuthMethod is not supported", 422, "validation_error");
  }
  if (body.site?.twitterCard !== undefined && !["summary", "summary_large_image"].includes(String(body.site.twitterCard))) {
    throw new ApiError("twitterCard is not supported", 422, "validation_error");
  }

  const twitterCard: AppSettings["site"]["twitterCard"] | undefined =
    body.site?.twitterCard === "summary_large_image" ? "summary_large_image" : body.site?.twitterCard === "summary" ? "summary" : undefined;
  const tokenAuthMethod: TokenAuthMethod | "" | undefined = tokenAuthValue === "" ? "" : isTokenAuthMethod(tokenAuthValue) ? tokenAuthValue : undefined;

  return {
    site: body.site
      ? {
          title: optionalText(body.site.title, "title", 120),
          description: optionalText(body.site.description, "description", 300),
          url: optionalHttpUrl(body.site.url, "url"),
          siteName: optionalText(body.site.siteName, "siteName", 120),
          ogImage: optionalImageReference(body.site.ogImage),
          locale: optionalText(body.site.locale, "locale", 20),
          alternateLocale: optionalText(body.site.alternateLocale, "alternateLocale", 20),
          twitterCard
        }
      : undefined,
    oidc: body.oidc
      ? {
          issuerUrl: optionalHttpsUrl(body.oidc.issuerUrl, "issuerUrl"),
          clientId: optionalText(body.oidc.clientId, "clientId", 500),
          tokenAuthMethod,
          scopes: optionalText(body.oidc.scopes, "scopes", 500),
          allowedEmails: optionalText(body.oidc.allowedEmails, "allowedEmails", 2_000),
          allowedDomains: optionalText(body.oidc.allowedDomains, "allowedDomains", 2_000),
          sessionTtlSeconds: optionalPositiveInteger(body.oidc.sessionTtlSeconds, "sessionTtlSeconds", 300, 30 * 24 * 60 * 60)
        }
      : undefined
  };
}

export const GET: APIRoute = apiRoute(async ({ locals }) => {
  const settings = await readAppSettings(getKv(locals));
  return json({ settings: publicAppSettings(settings) });
});

export const PATCH: APIRoute = apiRoute(async ({ locals, request }) => {
  const body = await readJson<SettingsPayload>(request);
  const settings = await writeAppSettings(getKv(locals), validatePayload(body));
  return json({ settings: publicAppSettings(settings) });
});
