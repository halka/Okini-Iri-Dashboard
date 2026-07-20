import { appConfig } from "./app";

export const tokenAuthMethods = ["client_secret_basic", "client_secret_post", "none"] as const;
export type TokenAuthMethod = (typeof tokenAuthMethods)[number];

export type SiteSettings = {
  title: string;
  description: string;
  url: string;
  siteName: string;
  ogImage: string;
  locale: string;
  alternateLocale: string;
  twitterCard: "summary" | "summary_large_image";
};

export type OidcSettings = {
  issuerUrl: string;
  clientId: string;
  tokenAuthMethod: TokenAuthMethod | "";
  scopes: string;
  allowedEmails: string;
  allowedDomains: string;
  sessionTtlSeconds: number;
};

export type AppSettings = {
  site: SiteSettings;
  oidc: OidcSettings;
};

export const defaultSiteSettings: SiteSettings = {
  title: appConfig.displayName,
  description: "Chrome bookmarks powered by Astro, Cloudflare Workers, and D1.",
  url: appConfig.siteUrl,
  siteName: appConfig.displayName,
  ogImage: "/favicon.svg",
  locale: "ja_JP",
  alternateLocale: "en_US",
  twitterCard: "summary"
};

export const defaultOidcSettings: OidcSettings = {
  issuerUrl: "",
  clientId: "",
  tokenAuthMethod: "",
  scopes: "openid profile email",
  allowedEmails: "",
  allowedDomains: "",
  sessionTtlSeconds: 8 * 60 * 60
};

export const defaultAppSettings: AppSettings = {
  site: defaultSiteSettings,
  oidc: defaultOidcSettings
};

export function isTokenAuthMethod(value: unknown): value is TokenAuthMethod {
  return typeof value === "string" && (tokenAuthMethods as readonly string[]).includes(value);
}
