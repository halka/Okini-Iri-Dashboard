import type { ImportedBookmarksFile } from "../domain/bookmarks";

export function parseChromeBookmarksHtml(html: string, source = "uploaded-bookmarks.html"): ImportedBookmarksFile {
  const stack: Array<{ id: string | null; name: string }> = [];
  const folders: NonNullable<ImportedBookmarksFile["folders"]> = [];
  const bookmarks: NonNullable<ImportedBookmarksFile["bookmarks"]> = [];
  let folderCounter = 0;
  let bookmarkCounter = 0;
  let cursor = 0;

  while (cursor < html.length) {
    const nextClose = findNext(html, /<\/DL>\s*<p>/gi, cursor);
    const nextFolder = findNext(html, /<DT>\s*<H3\b/gi, cursor);
    const nextBookmark = findNext(html, /<DT>\s*<A\b/gi, cursor);
    const candidates = [
      { type: "close", index: nextClose },
      { type: "folder", index: nextFolder },
      { type: "bookmark", index: nextBookmark }
    ].filter((candidate) => candidate.index >= 0);

    if (!candidates.length) break;
    candidates.sort((a, b) => a.index - b.index);
    const next = candidates[0];
    cursor = next.index;

    if (next.type === "close") {
      stack.pop();
      cursor += html.slice(cursor).match(/^<\/DL>\s*<p>/i)?.[0]?.length ?? "</DL><p>".length;
      continue;
    }

    const tagStart = next.type === "folder" ? html.slice(cursor).search(/<H3\b/i) + cursor : html.slice(cursor).search(/<A\b/i) + cursor;
    const tagEnd = findTagEnd(html, tagStart);
    const tag = html.slice(cursor, tagEnd + 1);

    if (next.type === "folder") {
      const contentEnd = html.slice(tagEnd).search(/<\/H3>/i) + tagEnd;
      const name = decodeHtml(html.slice(tagEnd + 1, contentEnd));
      const attrs = tag.replace(/^[\s\S]*<H3\b/i, "").replace(/>$/, "");
      const id = `folder_${String(++folderCounter).padStart(4, "0")}_${slugPart(name) || "item"}`;
      if (isChromeRootFolder(name, attrs)) {
        stack.push({ id: null, name });
        cursor = contentEnd + html.slice(contentEnd).match(/^<\/H3>/i)![0].length;
        continue;
      }

      const parentId = stack.at(-1)?.id ?? null;
      folders.push({
        id,
        name,
        parentId,
        sortOrder: folders.filter((folder) => folder.parentId === parentId).length,
        addDate: Number(attr(attrs, "ADD_DATE")) || null,
        lastModified: Number(attr(attrs, "LAST_MODIFIED")) || null
      });
      stack.push({ id, name });
      cursor = contentEnd + html.slice(contentEnd).match(/^<\/H3>/i)![0].length;
      continue;
    }

    const contentEnd = html.slice(tagEnd).search(/<\/A>/i) + tagEnd;
    const attrs = tag.replace(/^[\s\S]*<A\b/i, "").replace(/>$/, "");
    const folderId = stack.at(-1)?.id ?? null;
    bookmarks.push({
      id: `bookmark_${String(++bookmarkCounter).padStart(5, "0")}`,
      title: decodeHtml(html.slice(tagEnd + 1, contentEnd)) || "Untitled",
      url: attr(attrs, "HREF"),
      folderId,
      sortOrder: bookmarks.filter((bookmark) => bookmark.folderId === folderId).length,
      addDate: Number(attr(attrs, "ADD_DATE")) || null
    });
    cursor = contentEnd + html.slice(contentEnd).match(/^<\/A>/i)![0].length;
  }

  return { source, folders, bookmarks };
}

function findNext(value: string, pattern: RegExp, start: number) {
  pattern.lastIndex = start;
  return pattern.exec(value)?.index ?? -1;
}

function findTagEnd(value: string, start: number) {
  let quote = "";
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") return index;
  }
  throw new Error("Bookmark HTML contains an unclosed tag");
}

function attr(attrs: string, name: string) {
  const match = attrs.match(new RegExp(`${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, "i"));
  return match ? decodeHtml(match[1].replace(/^["']|["']$/g, "")) : "";
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

function slugPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

function isChromeRootFolder(name: string, attrs: string) {
  return name === "ブックマーク バー" || /PERSONAL_TOOLBAR_FOLDER\s*=\s*["']?true["']?/i.test(attrs);
}
