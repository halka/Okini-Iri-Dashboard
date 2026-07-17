import { UNCATEGORIZED_FOLDER_FILTER_ID, type Bookmark, type BookmarkFilters, type BookmarkInput, type BookmarkPatch } from "../../domain/bookmarks";
import { mapBookmark, type D1Row } from "./mappers";

const bookmarkSelect = `
  SELECT b.id, b.title, b.url, b.folder_id, f.name AS folder_name, b.description, b.notes,
    b.favicon_url, b.favorite, b.structured_preview_enabled, b.sort_order, b.add_date, b.created_at, b.updated_at,
    COALESCE(
      json_group_array(
        CASE WHEN t.id IS NULL THEN NULL ELSE json_object('id', t.id, 'name', t.name) END
      ),
      '[]'
    ) AS tags_json
  FROM bookmarks b
  LEFT JOIN folders f ON f.id = b.folder_id
  LEFT JOIN bookmark_tags bt ON bt.bookmark_id = b.id
  LEFT JOIN tags t ON t.id = bt.tag_id
`;

export async function listBookmarks(db: D1Database, filters: BookmarkFilters = {}): Promise<Bookmark[]> {
  const where: string[] = [];
  const binds: unknown[] = [];

  if (filters.query) {
    where.push("(b.title LIKE ? OR b.url LIKE ? OR b.description LIKE ? OR b.notes LIKE ?)");
    const like = `%${filters.query}%`;
    binds.push(like, like, like, like);
  } else if (filters.folderId === UNCATEGORIZED_FOLDER_FILTER_ID && !filters.favorite) {
    where.push("b.folder_id IS NULL");
  } else if (filters.folderId && !filters.favorite) {
    where.push("b.folder_id = ?");
    binds.push(filters.folderId);
  }

  if (filters.favorite) where.push("b.favorite = 1");

  const result = await db
    .prepare(`${bookmarkSelect}
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY b.id
      ORDER BY b.favorite DESC, f.sort_order, b.sort_order, b.updated_at DESC
      LIMIT 500`)
    .bind(...binds)
    .all<D1Row>();

  return result.results.map(mapBookmark);
}

export async function getBookmark(db: D1Database, id: string): Promise<Bookmark | null> {
  const row = await db
    .prepare(`${bookmarkSelect} WHERE b.id = ? GROUP BY b.id`)
    .bind(id)
    .first<D1Row>();
  return row ? mapBookmark(row) : null;
}

export async function createBookmark(db: D1Database, input: BookmarkInput) {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO bookmarks
        (id, title, url, favicon_url, folder_id, description, notes, favorite, structured_preview_enabled, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COUNT(*) FROM bookmarks WHERE folder_id IS ?), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    )
    .bind(
      id,
      input.title.trim(),
      input.url.trim(),
      input.faviconUrl?.trim() ?? "",
      input.folderId ?? null,
      input.description?.trim() ?? "",
      input.notes?.trim() ?? "",
      Number(Boolean(input.favorite)),
      Number(Boolean(input.structuredPreviewEnabled)),
      input.folderId ?? null
    )
    .run();
  await setBookmarkTags(db, id, input.tagIds ?? []);
  return { id };
}

export async function updateBookmark(db: D1Database, id: string, input: BookmarkPatch) {
  const current = await db.prepare("SELECT id FROM bookmarks WHERE id = ?").bind(id).first();
  if (!current) return false;

  const sets = ["updated_at = CURRENT_TIMESTAMP"];
  const binds: unknown[] = [];
  if (input.title !== undefined) addUpdate(sets, binds, "title", input.title.trim());
  if (input.url !== undefined) addUpdate(sets, binds, "url", input.url.trim());
  if (input.folderId !== undefined) addUpdate(sets, binds, "folder_id", input.folderId);
  if (input.faviconUrl !== undefined) addUpdate(sets, binds, "favicon_url", input.faviconUrl.trim());
  if (input.description !== undefined) addUpdate(sets, binds, "description", input.description.trim());
  if (input.notes !== undefined) addUpdate(sets, binds, "notes", input.notes.trim());
  if (typeof input.favorite === "boolean") addUpdate(sets, binds, "favorite", Number(input.favorite));
  if (typeof input.structuredPreviewEnabled === "boolean") {
    addUpdate(sets, binds, "structured_preview_enabled", Number(input.structuredPreviewEnabled));
  }

  binds.push(id);
  await db.prepare(`UPDATE bookmarks SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();
  if (input.tagIds) await setBookmarkTags(db, id, input.tagIds);
  return true;
}

export async function deleteBookmark(db: D1Database, id: string) {
  const result = await db.prepare("DELETE FROM bookmarks WHERE id = ?").bind(id).run();
  return result.meta.changes > 0;
}

function addUpdate(sets: string[], binds: unknown[], column: string, value: unknown) {
  sets.push(`${column} = ?`);
  binds.push(value);
}

async function setBookmarkTags(db: D1Database, bookmarkId: string, tagIds: string[]) {
  const statements = [db.prepare("DELETE FROM bookmark_tags WHERE bookmark_id = ?").bind(bookmarkId)];
  for (const tagId of new Set(tagIds.filter(Boolean))) {
    statements.push(
      db.prepare("INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)").bind(bookmarkId, tagId)
    );
  }
  await db.batch(statements);
}
