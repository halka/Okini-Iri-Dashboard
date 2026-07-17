import type { Bookmark } from "../../domain/bookmarks";

export function safeHost(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname || parsed.protocol.replace(":", "");
  } catch {
    return "link";
  }
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

export function faviconHtml(bookmark: Bookmark) {
  return `<div class="favicon${bookmark.faviconUrl ? "" : " favicon-empty"}">${faviconMarkup(bookmark.faviconUrl, bookmark.title)}</div>`;
}

export function faviconMarkup(faviconUrl: string, title: string) {
  const fallback = `<span${faviconUrl ? " hidden" : ""}>${escapeHtml(firstInitial(title))}</span>`;
  return faviconUrl ? `<img src="${escapeAttribute(faviconUrl)}" alt="" loading="lazy" />${fallback}` : fallback;
}

export function setupFaviconFallbacks(images: Iterable<HTMLImageElement>) {
  for (const image of images) {
    const showFallback = () => {
      image.hidden = true;
      image.nextElementSibling?.removeAttribute("hidden");
    };
    image.addEventListener("error", showFallback, { once: true });
    if (image.complete && image.naturalWidth === 0) showFallback();
  }
}

function firstInitial(value: string) {
  return Array.from(value.trim())[0]?.toUpperCase() || "?";
}
