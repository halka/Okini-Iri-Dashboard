import { appConfig } from "./app";

export const siteMeta = {
  title: appConfig.displayName,
  description: "Chrome bookmarks powered by Astro, Cloudflare Workers, and D1.",
  url: appConfig.siteUrl,
  siteName: appConfig.displayName,
  ogImage: "/favicon.svg",
  ogType: "website",
  locale: "ja_JP",
  alternateLocale: "en_US",
  twitterCard: "summary"
} as const;
