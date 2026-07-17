import { appConfig } from "../config/app";

export type UrlMetadata = {
  url: string;
  title: string;
  description: string;
  faviconUrl: string;
};

export async function fetchUrlMetadata(inputUrl: string): Promise<UrlMetadata> {
  const url = normalizeHttpUrl(inputUrl);
  const inputFallback = {
    url: url.href,
    title: url.hostname,
    description: "",
    faviconUrl: ""
  };

  const response = await fetch(url.href, {
    redirect: "follow",
    signal: AbortSignal.timeout(12_000),
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": appConfig.userAgent
    }
  });
  const finalUrl = normalizeResponseUrl(response.url, url);
  const fallback = {
    ...inputFallback,
    url: finalUrl.href,
    title: finalUrl.hostname
  };
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.toLowerCase().includes("html")) {
    return { ...fallback, faviconUrl: await firstExistingIcon(defaultIconCandidates(finalUrl)) };
  }

  const html = (await response.text()).slice(0, 180_000);
  const title = decodeHtml(findTitle(html) || findMeta(html, "og:title") || fallback.title);
  const description = decodeHtml(
    findMeta(html, "description") || findMeta(html, "og:description") || findMeta(html, "twitter:description") || ""
  );
  const faviconUrl = await firstExistingIcon([
    ...findIcons(html).map((icon) => resolveUrl(icon, finalUrl.href)),
    ...defaultIconCandidates(finalUrl)
  ]);

  return {
    url: finalUrl.href,
    title,
    description,
    faviconUrl
  };
}

async function urlExists(value: string) {
  try {
    const response = await fetch(value, {
      method: "GET",
      signal: AbortSignal.timeout(6_000),
      headers: {
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "user-agent": appConfig.userAgent
      }
    });
    if (!response.ok) return false;
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    return !contentType || contentType.includes("image") || contentType.includes("icon") || contentType.includes("svg");
  } catch {
    return false;
  }
}

function normalizeHttpUrl(value: string) {
  const trimmed = value.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withProtocol);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs can be fetched");
  }
  return parsed;
}

function normalizeResponseUrl(value: string, fallback: URL) {
  try {
    const parsed = new URL(value || fallback.href);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function findTitle(html: string) {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
}

function findMeta(html: string, name: string) {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const tagName = attr(tag, "name") || attr(tag, "property");
    if (tagName.toLowerCase() === name.toLowerCase()) {
      return attr(tag, "content").trim();
    }
  }
  return "";
}

function findIcons(html: string) {
  const links = html.match(/<link\b[^>]*>/gi) ?? [];
  const iconLinks = links.filter((tag) => attr(tag, "rel").toLowerCase().includes("icon"));
  const preferred = ["icon", "shortcut icon", "apple-touch-icon", "apple-touch-icon-precomposed", "mask-icon"];
  return iconLinks
    .sort((a, b) => iconPriority(a, preferred) - iconPriority(b, preferred))
    .map((tag) => attr(tag, "href"))
    .filter(Boolean);
}

function iconPriority(tag: string, preferred: string[]) {
  const rel = attr(tag, "rel").toLowerCase().split(/\s+/).join(" ");
  const index = preferred.indexOf(rel);
  return index === -1 ? preferred.length : index;
}

async function firstExistingIcon(candidates: string[]) {
  const uniqueCandidates = Array.from(new Set(candidates.filter(Boolean)));
  const results = await Promise.all(uniqueCandidates.map(urlExists));
  return uniqueCandidates.find((_, index) => results[index]) ?? "";
}

function defaultIconCandidates(url: URL) {
  return [`${url.origin}/favicon.ico`, `${url.origin}/favicon.svg`, `${url.origin}/apple-touch-icon.png`];
}

function attr(tag: string, name: string) {
  const pattern = new RegExp(`${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, "i");
  const match = tag.match(pattern);
  if (!match) return "";
  return match[1].replace(/^["']|["']$/g, "");
}

function resolveUrl(value: string, base: string) {
  try {
    return new URL(value, base).href;
  } catch {
    return "";
  }
}

function decodeHtml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();
}
