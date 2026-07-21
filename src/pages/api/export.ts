import type { APIRoute } from "astro";
import type { Bookmark } from "../../domain/bookmarks";
import { getDb } from "../../lib/d1";
import { listBookmarksForExport } from "../../lib/repositories/bookmarks";

export const GET: APIRoute = async ({ locals }) => {
  const bookmarks = await listBookmarksForExport(getDb(locals));
  const exportedAt = new Date().toISOString();
  // Browser bookmark importers expect this legacy Netscape exchange format.
  const html = [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    "<TITLE>Okini Iri Dashboard Bookmarks</TITLE>",
    "<H1>Okini Iri Dashboard Bookmarks</H1>",
    "<DL><p>",
    ...renderBookmarks(bookmarks),
    "</DL><p>",
    `<!-- Exported from Okini Iri Dashboard at ${escapeHtml(exportedAt)} -->`,
    ""
  ].join("\n");

  return new Response(html, {
    headers: {
      "cache-control": "no-store",
      "content-disposition": 'attachment; filename="okini-iri-bookmarks.html"',
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff"
    }
  });
};

function renderBookmarks(bookmarks: Bookmark[]) {
  const lines: string[] = [];
  const tagged = new Map<string, Bookmark[]>();

  for (const bookmark of bookmarks) {
    if (!bookmark.tags.length) {
      lines.push(renderBookmark(bookmark, 1));
      continue;
    }
    for (const tag of bookmark.tags) {
      const list = tagged.get(tag.name) ?? [];
      list.push(bookmark);
      tagged.set(tag.name, list);
    }
  }

  for (const [tagName, taggedBookmarks] of [...tagged.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  <DT><H3>${escapeHtml(tagName)}</H3>`);
    lines.push("  <DL><p>");
    lines.push(...taggedBookmarks.map((bookmark) => renderBookmark(bookmark, 2)));
    lines.push("  </DL><p>");
  }

  return lines;
}

function renderBookmark(bookmark: Bookmark, depth: number) {
  const indent = "  ".repeat(depth);
  const attrs = [
    `HREF="${escapeAttribute(bookmark.url)}"`,
    bookmark.addDate ? `ADD_DATE="${bookmark.addDate}"` : "",
    bookmark.faviconUrl ? `ICON="${escapeAttribute(bookmark.faviconUrl)}"` : ""
  ].filter(Boolean);
  return `${indent}<DT><A ${attrs.join(" ")}>${escapeHtml(bookmark.title)}</A>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/\n/g, "&#10;");
}
