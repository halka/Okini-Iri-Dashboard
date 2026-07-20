import { env } from "cloudflare:workers";
import { appConfig } from "../config/app";
import {
  defaultAppSettings,
  defaultOidcSettings,
  defaultSiteSettings,
  isTokenAuthMethod,
  type AppSettings,
  type OidcSettings,
  type SiteSettings
} from "../config/settings";

const settingsKey = "settings:global";
type AppSettingsInput = {
  site?: Partial<SiteSettings>;
  oidc?: Partial<OidcSettings>;
};

function envString(name: keyof Env) {
  const value = env[name];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function text(value: unknown, fallback: string, maxLength: number) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : trimmed.slice(0, maxLength);
}

function positiveInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "string" ? Number(value) : value;
  return Number.isInteger(parsed) && Number(parsed) >= min && Number(parsed) <= max ? Number(parsed) : fallback;
}

function mergeEnvOidc(input: Partial<OidcSettings>): OidcSettings {
  const envTokenAuthMethod = envString("OIDC_TOKEN_AUTH_METHOD");
  return {
    issuerUrl: envString("OIDC_ISSUER_URL") || text(input.issuerUrl, defaultOidcSettings.issuerUrl, 2_000),
    clientId: envString("OIDC_CLIENT_ID") || text(input.clientId, defaultOidcSettings.clientId, 500),
    tokenAuthMethod: isTokenAuthMethod(envTokenAuthMethod)
      ? envTokenAuthMethod
      : isTokenAuthMethod(input.tokenAuthMethod)
        ? input.tokenAuthMethod
        : defaultOidcSettings.tokenAuthMethod,
    scopes: envString("OIDC_SCOPES") || text(input.scopes, defaultOidcSettings.scopes, 500),
    allowedEmails: envString("OIDC_ALLOWED_EMAILS") || text(input.allowedEmails, defaultOidcSettings.allowedEmails, 2_000),
    allowedDomains: envString("OIDC_ALLOWED_DOMAINS") || text(input.allowedDomains, defaultOidcSettings.allowedDomains, 2_000),
    sessionTtlSeconds: positiveInteger(envString("AUTH_SESSION_TTL_SECONDS") || input.sessionTtlSeconds, defaultOidcSettings.sessionTtlSeconds, 300, 30 * 24 * 60 * 60)
  };
}

export function normalizeSiteSettings(input: Partial<SiteSettings> = {}): SiteSettings {
  return {
    title: text(input.title, defaultSiteSettings.title, 120),
    description: text(input.description, defaultSiteSettings.description, 300),
    url: text(input.url, defaultSiteSettings.url, 2_000),
    siteName: text(input.siteName, defaultSiteSettings.siteName, 120),
    ogImage: text(input.ogImage, defaultSiteSettings.ogImage, 2_000),
    locale: text(input.locale, defaultSiteSettings.locale, 20),
    alternateLocale: text(input.alternateLocale, defaultSiteSettings.alternateLocale, 20),
    twitterCard: input.twitterCard === "summary_large_image" ? "summary_large_image" : "summary"
  };
}

export function normalizeOidcSettings(input: Partial<OidcSettings> = {}): OidcSettings {
  return mergeEnvOidc(input);
}

export function normalizeAppSettings(input: AppSettingsInput = {}): AppSettings {
  return {
    site: normalizeSiteSettings(input.site),
    oidc: normalizeOidcSettings(input.oidc)
  };
}

export async function readAppSettings(kv: KVNamespace): Promise<AppSettings> {
  const stored = await kv.get<Partial<AppSettings>>(settingsKey, "json");
  return normalizeAppSettings(stored ?? defaultAppSettings);
}

export async function writeAppSettings(kv: KVNamespace, input: AppSettingsInput): Promise<AppSettings> {
  const current = await readAppSettings(kv);
  const settings = normalizeAppSettings({
    site: { ...current.site, ...input.site },
    oidc: { ...current.oidc, ...input.oidc }
  });
  await kv.put(settingsKey, JSON.stringify(settings));
  return settings;
}

export function publicAppSettings(settings: AppSettings) {
  return {
    site: settings.site,
    oidc: {
      ...settings.oidc,
      clientSecretConfigured: Boolean(envString("OIDC_CLIENT_SECRET")),
      envOverrides: {
        issuerUrl: Boolean(envString("OIDC_ISSUER_URL")),
        clientId: Boolean(envString("OIDC_CLIENT_ID")),
        tokenAuthMethod: Boolean(envString("OIDC_TOKEN_AUTH_METHOD")),
        scopes: Boolean(envString("OIDC_SCOPES")),
        allowedEmails: Boolean(envString("OIDC_ALLOWED_EMAILS")),
        allowedDomains: Boolean(envString("OIDC_ALLOWED_DOMAINS")),
        sessionTtlSeconds: Boolean(envString("AUTH_SESSION_TTL_SECONDS"))
      }
    }
  };
}

export function absoluteSiteUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : appConfig.siteUrl;
  } catch {
    return appConfig.siteUrl;
  }
}
