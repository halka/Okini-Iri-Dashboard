import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const source = process.argv[2];
if (!source) {
  console.error("Usage: npm run import:bookmarks -- /path/to/bookmarks.html");
  process.exit(1);
}
const output = resolve("src/data/imported-bookmarks.json");
const html = readFileSync(source, "utf8");

const stack = [];
const folders = [];
const bookmarks = [];
let folderCounter = 0;
let bookmarkCounter = 0;

function decodeHtml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function attr(attrs, name) {
  const match = attrs.match(new RegExp(`${name}="([^"]*)"`, "i"));
  return match ? decodeHtml(match[1]) : "";
}

function slugPart(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

let cursor = 0;
while (cursor < html.length) {
  const nextClose = html.indexOf("</DL><p>", cursor);
  const nextFolder = html.indexOf("<DT><H3", cursor);
  const nextBookmark = html.indexOf("<DT><A", cursor);
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
    cursor += "</DL><p>".length;
    continue;
  }

  const tagStart = next.type === "folder" ? html.indexOf("<H3", cursor) : html.indexOf("<A", cursor);
  const tagEnd = findTagEnd(html, tagStart);
  const tag = html.slice(cursor, tagEnd + 1);

  if (next.type === "folder") {
    const contentEnd = html.indexOf("</H3>", tagEnd);
    const name = decodeHtml(html.slice(tagEnd + 1, contentEnd));
    const attrs = tag.replace(/^[\s\S]*<H3\b/i, "").replace(/>$/, "");
    const id = `folder_${String(++folderCounter).padStart(4, "0")}_${slugPart(name) || "item"}`;
    if (isChromeRootFolder(name, attrs)) {
      stack.push({ id: null, name });
      cursor = contentEnd + "</H3>".length;
      continue;
    }
    const parentId = stack.at(-1)?.id ?? null;
    const sortOrder = folders.filter((folder) => folder.parentId === parentId).length;
    folders.push({
      id,
      name,
      parentId,
      sortOrder,
      addDate: Number(attr(attrs, "ADD_DATE")) || null,
      lastModified: Number(attr(attrs, "LAST_MODIFIED")) || null
    });
    stack.push({ id, name });
    cursor = contentEnd + "</H3>".length;
    continue;
  }

  if (next.type === "bookmark") {
    const contentEnd = html.indexOf("</A>", tagEnd);
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
    cursor = contentEnd + "</A>".length;
  }
}

writeFileSync(
  output,
  `${JSON.stringify({ source: basename(source), folders, bookmarks }, null, 2)}\n`
);

console.log(`Imported ${folders.length} folders and ${bookmarks.length} bookmarks to ${output}`);

function findTagEnd(value, start) {
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
  throw new Error(`Tag beginning at ${start} was not closed`);
}

function isChromeRootFolder(name, attrs) {
  return name === "ブックマーク バー" || /PERSONAL_TOOLBAR_FOLDER="true"/i.test(attrs);
}
