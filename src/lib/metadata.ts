import { appConfig } from "../config/app";
import { fetchPublicUrl, publicHttpUrl, type RemoteFetchOptions } from "./remote-fetch";
import { readResponseText } from "./text-encoding";

export type UrlMetadata = {
  url: string;
  title: string;
  description: string;
  faviconUrl: string;
};

type ManifestImage = {
  src?: unknown;
  sizes?: unknown;
  type?: unknown;
  purpose?: unknown;
};

const iconProbeBatchSize = 4;
const auxiliaryDocumentLimit = 256 * 1024;

export async function fetchUrlMetadata(inputUrl: string, options: RemoteFetchOptions = {}): Promise<UrlMetadata> {
  const url = publicHttpUrl(inputUrl, options);
  const inputFallback = {
    url: url.href,
    title: url.hostname,
    description: "",
    faviconUrl: ""
  };

  const response = await fetchPublicUrl(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(12_000),
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": appConfig.userAgent
    }
  }, options);
  const finalUrl = normalizeResponseUrl(response.url, url, options);
  const fallback = {
    ...inputFallback,
    url: finalUrl.href,
    title: finalUrl.hostname
  };
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const canContainHtml = !contentType || contentType.includes("html") || contentType.includes("text/plain");
  if (!response.ok || !canContainHtml) {
    return { ...fallback, faviconUrl: await firstExistingIcon(defaultIconCandidates(finalUrl), options) };
  }

  const html = (await readResponseText(response, 512 * 1024)).text.slice(0, 180_000);
  const title = decodeHtml(findTitle(html) || findMeta(html, "og:title") || fallback.title);
  const description = decodeHtml(
    findMeta(html, "description") || findMeta(html, "og:description") || findMeta(html, "twitter:description") || ""
  );
  const faviconUrl = await findFaviconUrl(html, finalUrl, options);

  return {
    url: finalUrl.href,
    title,
    description,
    faviconUrl
  };
}

async function urlExists(value: string, options: RemoteFetchOptions) {
  try {
    const response = await fetchPublicUrl(value, {
      method: "GET",
      signal: AbortSignal.timeout(6_000),
      headers: {
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "user-agent": appConfig.userAgent
      }
    }, options);
    if (!response.ok) return false;
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("image") || contentType.includes("icon") || contentType.includes("svg")) return true;
    return hasImageSignature(await readResponsePrefix(response, 4_096));
  } catch {
    return false;
  }
}

async function findFaviconUrl(html: string, finalUrl: URL, options: RemoteFetchOptions) {
  const documentBaseUrl = resolveHttpUrl(decodeHtml(findBaseHref(html)), finalUrl.href, options) || finalUrl.href;
  const directCandidates = [
    ...findIcons(html).map((icon) => resolveHttpUrl(decodeHtml(icon), documentBaseUrl, options)),
    ...findMetaIcons(html).map((icon) => resolveHttpUrl(decodeHtml(icon), documentBaseUrl, options))
  ];
  const directIcon = await firstExistingIcon(directCandidates, options);
  if (directIcon) return directIcon;

  const manifestCandidates = await findManifestIcons(html, documentBaseUrl, options);
  const manifestIcon = await firstExistingIcon(manifestCandidates, options);
  if (manifestIcon) return manifestIcon;

  const defaultIcon = await firstExistingIcon(defaultIconCandidates(finalUrl), options);
  if (defaultIcon) return defaultIcon;

  const browserConfigCandidates = await findBrowserConfigIcons(html, documentBaseUrl, finalUrl, options);
  return firstExistingIcon(browserConfigCandidates, options);
}

async function findManifestIcons(html: string, documentBaseUrl: string, options: RemoteFetchOptions) {
  const manifestUrls = findLinksByRel(html, "manifest")
    .map((value) => resolveHttpUrl(decodeHtml(value), documentBaseUrl, options))
    .filter(Boolean);
  const candidates: string[] = [];

  for (const value of Array.from(new Set(manifestUrls)).slice(0, 3)) {
    try {
      const requestedUrl = publicHttpUrl(value, options);
      const response = await fetchPublicUrl(requestedUrl, {
        signal: AbortSignal.timeout(6_000),
        headers: {
          accept: "application/manifest+json,application/json;q=0.9,*/*;q=0.1",
          "user-agent": appConfig.userAgent
        }
      }, options);
      if (!response.ok) continue;
      const manifestUrl = normalizeResponseUrl(response.url, requestedUrl, options);
      const manifest = JSON.parse(stripBom((await readResponseText(response, auxiliaryDocumentLimit)).text)) as unknown;
      candidates.push(...manifestIconSources(manifest, manifestUrl.href, options));
    } catch {
      continue;
    }
  }

  return candidates;
}

function manifestIconSources(value: unknown, manifestUrl: string, options: RemoteFetchOptions) {
  if (!isRecord(value)) return [];
  const images = manifestImages(value.icons);
  if (isRecord(value.icons_localized)) {
    for (const localized of Object.values(value.icons_localized)) images.push(...manifestImages(localized));
  }

  return images
    .map((image, index) => ({ image, index }))
    .sort((a, b) => manifestIconPriority(a.image, a.index) - manifestIconPriority(b.image, b.index))
    .map(({ image }) => typeof image.src === "string" ? resolveHttpUrl(image.src, manifestUrl, options) : "")
    .filter(Boolean);
}

function manifestImages(value: unknown): ManifestImage[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function manifestIconPriority(image: ManifestImage, index: number) {
  const purpose = typeof image.purpose === "string" ? image.purpose.toLowerCase().split(/\s+/) : ["any"];
  const purposePriority = purpose.includes("any") ? 0 : purpose.includes("maskable") ? 1 : 2;
  const type = typeof image.type === "string" ? image.type.toLowerCase() : "";
  const sizes = typeof image.sizes === "string" ? image.sizes.toLowerCase() : "";
  const scalablePriority = type === "image/svg+xml" || sizes.split(/\s+/).includes("any") ? 0 : 1;
  const maxSize = Math.max(0, ...Array.from(sizes.matchAll(/(\d+)x(\d+)/gi), (match) => Math.min(Number(match[1]), Number(match[2]))));
  return purposePriority * 1_000_000 + scalablePriority * 100_000 - Math.min(maxSize, 99_999) + index / 10_000;
}

async function findBrowserConfigIcons(
  html: string,
  documentBaseUrl: string,
  finalUrl: URL,
  options: RemoteFetchOptions
) {
  const configured = findMeta(html, "msapplication-config");
  if (configured.trim().toLowerCase() === "none") return [];
  const browserConfigUrl = configured
    ? resolveHttpUrl(decodeHtml(configured), documentBaseUrl, options)
    : resolveHttpUrl("/browserconfig.xml", finalUrl.href, options);
  if (!browserConfigUrl) return [];

  try {
    const requestedUrl = publicHttpUrl(browserConfigUrl, options);
    const response = await fetchPublicUrl(requestedUrl, {
      signal: AbortSignal.timeout(6_000),
      headers: {
        accept: "application/xml,text/xml;q=0.9,*/*;q=0.1",
        "user-agent": appConfig.userAgent
      }
    }, options);
    if (!response.ok) return [];
    const configUrl = normalizeResponseUrl(response.url, requestedUrl, options);
    const xml = (await readResponseText(response, auxiliaryDocumentLimit)).text;
    return findBrowserConfigSources(xml)
      .map((value) => resolveHttpUrl(decodeHtml(value), configUrl.href, options))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeResponseUrl(value: string, fallback: URL, options: RemoteFetchOptions) {
  try {
    return publicHttpUrl(value || fallback.href, options);
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
  return links
    .map((tag, index) => ({ tag, index, priority: iconPriority(tag) }))
    .filter(({ priority }) => Number.isFinite(priority))
    .sort((a, b) => a.priority - b.priority || b.index - a.index)
    .map(({ tag }) => attr(tag, "href"))
    .filter(Boolean);
}

function iconPriority(tag: string) {
  const rel = new Set(iconRelTokens(tag));
  const relationPriority = rel.has("icon")
    ? 0
    : rel.has("apple-touch-icon")
      ? 10
      : rel.has("apple-touch-icon-precomposed")
        ? 20
        : rel.has("mask-icon")
          ? 30
          : rel.has("fluid-icon")
            ? 40
            : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(relationPriority)) return relationPriority;
  const mediaPriority = attr(tag, "media") ? 2 : 0;
  const type = attr(tag, "type").toLowerCase();
  const sizes = attr(tag, "sizes").toLowerCase().split(/\s+/);
  const scalablePriority = type === "image/svg+xml" || sizes.includes("any") ? 0 : 1;
  return relationPriority + mediaPriority + scalablePriority;
}

function iconRelTokens(tag: string) {
  return attr(tag, "rel").toLowerCase().trim().split(/\s+/).filter(Boolean);
}

function findBaseHref(html: string) {
  const baseTag = html.match(/<base\b[^>]*>/i)?.[0] ?? "";
  return attr(baseTag, "href");
}

function findLinksByRel(html: string, relation: string) {
  const links = html.match(/<link\b[^>]*>/gi) ?? [];
  return links
    .filter((tag) => iconRelTokens(tag).includes(relation))
    .map((tag) => attr(tag, "href"))
    .filter(Boolean);
}

function findMetaIcons(html: string) {
  const names = new Set([
    "msapplication-tileimage",
    "msapplication-square70x70logo",
    "msapplication-square150x150logo",
    "msapplication-wide310x150logo",
    "msapplication-square310x310logo"
  ]);
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  return tags
    .filter((tag) => names.has(attr(tag, "name").toLowerCase()))
    .map((tag) => attr(tag, "content"))
    .filter(Boolean);
}

function findBrowserConfigSources(xml: string) {
  const tags = xml.match(/<(?:square\d+x\d+logo|wide\d+x\d+logo|TileImage)\b[^>]*>/gi) ?? [];
  return tags.map((tag) => attr(tag, "src")).filter(Boolean);
}

async function firstExistingIcon(candidates: string[], options: RemoteFetchOptions) {
  const uniqueCandidates = Array.from(new Set(candidates.filter(Boolean)));
  for (let index = 0; index < uniqueCandidates.length; index += iconProbeBatchSize) {
    const batch = uniqueCandidates.slice(index, index + iconProbeBatchSize);
    const results = await Promise.all(batch.map((url) => urlExists(url, options)));
    const match = batch.find((_, candidateIndex) => results[candidateIndex]);
    if (match) return match;
  }
  return "";
}

function defaultIconCandidates(url: URL) {
  return [
    `${url.origin}/favicon.ico`,
    `${url.origin}/favicon.svg`,
    `${url.origin}/favicon.png`,
    `${url.origin}/apple-touch-icon.png`,
    `${url.origin}/apple-touch-icon-precomposed.png`
  ];
}

function attr(tag: string, name: string) {
  const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, "i");
  const match = tag.match(pattern);
  if (!match) return "";
  return match[1].replace(/^["']|["']$/g, "");
}

function resolveHttpUrl(value: string, base: string, options: RemoteFetchOptions) {
  try {
    return publicHttpUrl(new URL(value, base), options).href;
  } catch {
    return "";
  }
}

async function readResponsePrefix(response: Response, maxBytes: number) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const bytes = new Uint8Array(maxBytes);
  let length = 0;
  try {
    while (length < maxBytes) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = result.value.subarray(0, maxBytes - length);
      bytes.set(chunk, length);
      length += chunk.byteLength;
      if (chunk.byteLength < result.value.byteLength) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return bytes.subarray(0, length);
}

function hasImageSignature(bytes: Uint8Array) {
  if (bytes.length < 4) return false;
  const startsWith = (...signature: number[]) => signature.every((value, index) => bytes[index] === value);
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return true;
  if (startsWith(0xff, 0xd8, 0xff)) return true;
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return true;
  if (startsWith(0x00, 0x00, 0x01, 0x00) || startsWith(0x00, 0x00, 0x02, 0x00)) return true;
  if (startsWith(0x42, 0x4d)) return true;
  if (bytes.length >= 12 && startsWith(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return true;
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(4, 12)).match(/^ftyp(?:avif|avis)$/)) return true;
  return /<(?:\?xml[\s\S]*?)?svg(?:\s|>)/i.test(new TextDecoder().decode(bytes));
}

function stripBom(value: string) {
  return value.replace(/^\uFEFF/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
