import importedBookmarks from "../../data/imported-bookmarks.json";
import type { ImportedBookmarksFile } from "../../domain/bookmarks";
import { isSupportedBookmarkUrl } from "../http";
import { fetchUrlMetadata } from "../metadata";
import { resetAllData } from "./reset";

type NormalizedFolder = {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
};

type NormalizedBookmark = {
  id: string;
  title: string;
  url: string;
  folderId: string | null;
  description: string;
  faviconUrl: string;
  sortOrder: number;
  addDate: number | null;
};

const IMPORT_CONCURRENCY = 6;

export async function seedImportedBookmarks(db: D1Database, force = false) {
  return importBookmarksFile(db, importedBookmarks as ImportedBookmarksFile, force);
}

export async function importBookmarksFile(db: D1Database, input: ImportedBookmarksFile, force = false) {
  const current = await db.prepare("SELECT COUNT(*) AS count FROM bookmarks").first<{ count: number }>();
  if (!force && (current?.count ?? 0) > 0) {
    return { skipped: true, folders: 0, bookmarks: 0 };
  }

  const normalized = normalizeImportedBookmarks(input);
  const enrichedBookmarks = await mapConcurrent(normalized.bookmarks, IMPORT_CONCURRENCY, enrichBookmark);

  if (force) await resetAllData(db);

  const statements = [
    ...normalized.folders.map((folder) =>
      db
        .prepare(
          `INSERT OR REPLACE INTO folders (id, name, parent_id, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        )
        .bind(folder.id, folder.name, folder.parentId, folder.sortOrder)
    ),
    ...enrichedBookmarks.map((bookmark) =>
      db
        .prepare(
          `INSERT OR REPLACE INTO bookmarks
            (id, title, url, favicon_url, folder_id, description, sort_order, add_date, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        )
        .bind(
          bookmark.id,
          bookmark.title,
          bookmark.url,
          bookmark.faviconUrl,
          bookmark.folderId,
          bookmark.description,
          bookmark.sortOrder,
          bookmark.addDate
        )
    )
  ];

  for (let index = 0; index < statements.length; index += 50) {
    await db.batch(statements.slice(index, index + 50));
  }

  return {
    skipped: false,
    folders: normalized.folders.length,
    bookmarks: enrichedBookmarks.length
  };
}

function normalizeImportedBookmarks(input: ImportedBookmarksFile) {
  const importedFolders = input.folders ?? [];
  const importedBookmarkItems = (input.bookmarks ?? []).filter(
    (bookmark) => bookmark.url?.trim() && isSupportedBookmarkUrl(bookmark.url)
  );
  const folders: NormalizedFolder[] = [];
  const folderNameToId = new Map<string, string>();

  for (const [index, folder] of importedFolders.entries()) {
    const name = folder.name?.trim();
    if (!name || name === "ブックマーク バー") continue;
    const id = folder.id || `folder_${String(index + 1).padStart(4, "0")}_${slugPart(name) || "item"}`;
    folderNameToId.set(name, id);
    folders.push({
      id,
      name,
      parentId: folder.parentId ?? null,
      sortOrder: folder.sortOrder ?? folders.length
    });
  }

  for (const bookmark of importedBookmarkItems) {
    const folderName = (bookmark.folderName ?? bookmark.folder ?? "").trim();
    if (!folderName || folderNameToId.has(folderName)) continue;
    const id = `folder_${String(folders.length + 1).padStart(4, "0")}_${slugPart(folderName) || "item"}`;
    folderNameToId.set(folderName, id);
    folders.push({ id, name: folderName, parentId: null, sortOrder: folders.length });
  }

  const validFolderIds = new Set(folders.map((folder) => folder.id));
  const bookmarks = importedBookmarkItems.map((bookmark, index): NormalizedBookmark => {
    const folderName = (bookmark.folderName ?? bookmark.folder ?? "").trim();
    const requestedFolderId = bookmark.folderId ?? (folderName ? folderNameToId.get(folderName) ?? null : null);
    return {
      id: bookmark.id || `bookmark_${String(index + 1).padStart(5, "0")}`,
      title: (bookmark.title ?? bookmark.name ?? "").trim(),
      url: bookmark.url.trim(),
      folderId: requestedFolderId && validFolderIds.has(requestedFolderId) ? requestedFolderId : null,
      description: bookmark.description?.trim() ?? "",
      faviconUrl: bookmark.faviconUrl?.trim() ?? "",
      sortOrder: bookmark.sortOrder ?? index,
      addDate: bookmark.addDate ?? null
    };
  });

  return { folders, bookmarks };
}

async function enrichBookmark(bookmark: NormalizedBookmark): Promise<NormalizedBookmark> {
  if (!/^https?:\/\//i.test(bookmark.url)) {
    return { ...bookmark, title: bookmark.title || safeImportedTitle(bookmark.url), faviconUrl: "" };
  }

  try {
    const metadata = await fetchUrlMetadata(bookmark.url);
    return {
      ...bookmark,
      title: metadata.title || bookmark.title || safeImportedTitle(bookmark.url),
      url: metadata.url || bookmark.url,
      description: metadata.description || bookmark.description,
      faviconUrl: metadata.faviconUrl
    };
  } catch {
    return { ...bookmark, title: bookmark.title || safeImportedTitle(bookmark.url), faviconUrl: "" };
  }
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function safeImportedTitle(url: string) {
  try {
    return new URL(url).hostname || url.split(":", 1)[0] || url;
  } catch {
    return url;
  }
}

function slugPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}
