import type { ChromeBookmarksImport } from "../../domain/bookmarks";
import { isSupportedBookmarkUrl } from "../http";
import { fetchUrlMetadata } from "../metadata";
import type { RemoteFetchOptions } from "../remote-fetch";
import { resetAllData } from "./reset";
import { isReservedTagName } from "./tags";

type ImportMode = {
  append?: boolean;
  force?: boolean;
};

export type ImportProgress = {
  completed: number;
  total: number;
};

type NormalizedBookmark = {
  id: string;
  title: string;
  url: string;
  tagNames: string[];
  description: string;
  faviconUrl: string;
  sortOrder: number;
  addDate: number | null;
  vpnRequired: boolean;
};

const IMPORT_CONCURRENCY = 6;
const defaultImportTagColor = "#4f8cff";

export async function importChromeBookmarks(
  db: D1Database,
  input: ChromeBookmarksImport,
  mode: ImportMode = {},
  remoteFetchOptions: RemoteFetchOptions = {},
  onProgress?: (progress: ImportProgress) => void
) {
  const current = await db.prepare("SELECT COUNT(*) AS count FROM bookmarks").first<{ count: number }>();
  const append = Boolean(mode.append);
  const force = Boolean(mode.force);
  if (!force && !append && (current?.count ?? 0) > 0) {
    return { skipped: true, tags: 0, bookmarks: 0 };
  }

  const normalized = normalizeImportedBookmarks(input);
  onProgress?.({ completed: 0, total: normalized.bookmarks.length });
  const enrichedBookmarks = await mapConcurrent(
    normalized.bookmarks,
    IMPORT_CONCURRENCY,
    (bookmark) => enrichBookmark(bookmark, remoteFetchOptions),
    (completed) => onProgress?.({ completed, total: normalized.bookmarks.length })
  );

  if (force) await resetAllData(db);

  await upsertTags(db, normalized.tagNames);
  const tagIds = await tagIdsByName(db);

  const bookmarkStatements = enrichedBookmarks.map((bookmark) =>
    db
      .prepare(
        `INSERT INTO bookmarks
          (id, title, url, favicon_url, folder_id, description, vpn_required, sort_order, add_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      )
      .bind(
        bookmark.id,
        bookmark.title,
        bookmark.url,
        bookmark.faviconUrl,
        bookmark.description,
        Number(bookmark.vpnRequired),
        bookmark.sortOrder,
        bookmark.addDate
      )
  );
  for (let index = 0; index < bookmarkStatements.length; index += 50) {
    await db.batch(bookmarkStatements.slice(index, index + 50));
  }

  const tagStatements = enrichedBookmarks.flatMap((bookmark) =>
    bookmark.tagNames
      .map((name) => tagIds.get(tagKey(name)))
      .filter((tagId): tagId is string => Boolean(tagId))
      .map((tagId) => db.prepare("INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)").bind(bookmark.id, tagId))
  );
  for (let index = 0; index < tagStatements.length; index += 50) {
    await db.batch(tagStatements.slice(index, index + 50));
  }

  return {
    skipped: false,
    tags: normalized.tagNames.length,
    folders: normalized.tagNames.length,
    bookmarks: enrichedBookmarks.length
  };
}

function normalizeImportedBookmarks(input: ChromeBookmarksImport) {
  const importedFolders = input.folders ?? [];
  const importedBookmarkItems = (input.bookmarks ?? []).filter(
    (bookmark) => bookmark.url?.trim() && isSupportedBookmarkUrl(bookmark.url)
  );
  const folderNames = new Map<string, string>();
  const folderPaths = new Map<string, string[]>();

  for (const folder of importedFolders) {
    const name = folder.name?.trim();
    if (!name || name === "ブックマーク バー") continue;
    const id = folder.id || name;
    folderNames.set(id, name);
  }

  function pathFor(folderId: string | null | undefined): string[] {
    if (!folderId) return [];
    const cached = folderPaths.get(folderId);
    if (cached) return cached;
    const folder = importedFolders.find((item) => (item.id || item.name) === folderId);
    const name = folderNames.get(folderId) ?? folder?.name?.trim() ?? "";
    const parentPath = folder?.parentId ? pathFor(folder.parentId) : [];
    const path = name && name !== "ブックマーク バー" ? [...parentPath, name] : parentPath;
    folderPaths.set(folderId, path);
    return path;
  }

  const bookmarks = importedBookmarkItems.map((bookmark, index): NormalizedBookmark => {
    const fallbackFolderName = (bookmark.folderName ?? bookmark.folder ?? "").trim();
    const tagNames = uniqueNames([...(bookmark.folderId ? pathFor(bookmark.folderId) : []), fallbackFolderName]).filter(
      (name) => !isReservedTagName(name)
    );
    return {
      id: crypto.randomUUID(),
      title: (bookmark.title ?? bookmark.name ?? "").trim(),
      url: bookmark.url.trim(),
      tagNames,
      description: bookmark.description?.trim() ?? "",
      faviconUrl: bookmark.faviconUrl?.trim() ?? "",
      sortOrder: bookmark.sortOrder ?? index,
      addDate: bookmark.addDate ?? null,
      vpnRequired: Boolean(bookmark.vpnRequired)
    };
  });
  const tagNames = uniqueNames(bookmarks.flatMap((bookmark) => bookmark.tagNames));

  return { tagNames, bookmarks };
}

async function enrichBookmark(bookmark: NormalizedBookmark, remoteFetchOptions: RemoteFetchOptions): Promise<NormalizedBookmark> {
  if (!/^https?:\/\//i.test(bookmark.url)) {
    return { ...bookmark, title: bookmark.title || safeImportedTitle(bookmark.url), faviconUrl: "" };
  }

  try {
    const metadata = await fetchUrlMetadata(bookmark.url, remoteFetchOptions);
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

async function upsertTags(db: D1Database, tagNames: string[]) {
  const statements = tagNames.filter((name) => !isReservedTagName(name)).map((name) =>
    db
      .prepare("INSERT OR IGNORE INTO tags (id, name, primary_color, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)")
      .bind(crypto.randomUUID(), name, defaultImportTagColor)
  );
  for (let index = 0; index < statements.length; index += 50) {
    await db.batch(statements.slice(index, index + 50));
  }
}

async function tagIdsByName(db: D1Database) {
  const result = await db.prepare("SELECT id, name FROM tags WHERE lower(name) NOT IN ('untagged')").all<{ id: string; name: string }>();
  return new Map(result.results.map((tag) => [tagKey(tag.name), tag.id]));
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
  onComplete?: (completed: number) => void
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
      completed += 1;
      onComplete?.(completed);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function uniqueNames(values: string[]) {
  const names = new Map<string, string>();
  for (const value of values) {
    const name = value.trim();
    if (name) names.set(tagKey(name), name);
  }
  return [...names.values()];
}

function tagKey(value: string) {
  return value.normalize("NFKC").trim().toLowerCase();
}

function safeImportedTitle(url: string) {
  try {
    return new URL(url).hostname || url.split(":", 1)[0] || url;
  } catch {
    return url;
  }
}
