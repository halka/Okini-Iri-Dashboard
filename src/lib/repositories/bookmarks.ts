import type { Bookmark, BookmarkFilters, BookmarkInput, BookmarkPatch } from "../../domain/bookmarks";
import { mapBookmark, type D1Row } from "./mappers";

const bookmarkSelect = `
  SELECT b.id, b.title, b.url, b.folder_id, f.name AS folder_name, b.description, b.notes,
    b.favicon_url, b.favorite, b.structured_preview_enabled, b.sort_order, b.add_date, b.created_at, b.updated_at,
    COALESCE(
      json_group_array(
        CASE WHEN t.id IS NULL THEN NULL ELSE json_object('id', t.id, 'name', t.name, 'primaryColor', t.primary_color) END
      ),
      '[]'
    ) AS tags_json
  FROM bookmarks b
  LEFT JOIN folders f ON f.id = b.folder_id
  LEFT JOIN bookmark_tags bt ON bt.bookmark_id = b.id
  LEFT JOIN tags t ON t.id = bt.tag_id AND lower(t.name) NOT IN ('untagged')
`;

export async function listBookmarks(db: D1Database, filters: BookmarkFilters = {}): Promise<Bookmark[]> {
  const where: string[] = [];
  const binds: unknown[] = [];

  if (filters.query) {
    where.push(`(
      b.title LIKE ? OR b.url LIKE ? OR b.description LIKE ? OR b.notes LIKE ? OR EXISTS (
        SELECT 1
        FROM bookmark_tags search_bt
        INNER JOIN tags search_t ON search_t.id = search_bt.tag_id
        WHERE search_bt.bookmark_id = b.id AND lower(search_t.name) NOT IN ('untagged') AND search_t.name LIKE ?
      )
    )`);
    const like = `%${filters.query}%`;
    binds.push(like, like, like, like, like);
  }

  if (filters.tagId) {
    where.push(`EXISTS (
      SELECT 1
      FROM bookmark_tags filter_bt
      INNER JOIN tags filter_t ON filter_t.id = filter_bt.tag_id
      WHERE filter_bt.bookmark_id = b.id AND filter_t.id = ? AND lower(filter_t.name) NOT IN ('untagged')
    )`);
    binds.push(filters.tagId);
  }

  if (filters.favorite) where.push("b.favorite = 1");

  const result = await db
    .prepare(`${bookmarkSelect}
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY b.id
      ORDER BY f.sort_order, b.sort_order, b.created_at
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

export async function listBookmarksForExport(db: D1Database): Promise<Bookmark[]> {
  const result = await db
    .prepare(`${bookmarkSelect}
      GROUP BY b.id
      ORDER BY b.sort_order, b.created_at, b.updated_at`)
    .all<D1Row>();

  return result.results.map(mapBookmark);
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

export async function reorderBookmarks(db: D1Database, ids: string[]) {
  const statements = ids.map((id, sortOrder) =>
    db
      .prepare("UPDATE bookmarks SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(sortOrder, id)
  );
  if (statements.length) await db.batch(statements);
  return ids.length;
}

export async function bulkUpdateBookmarkTags(
  db: D1Database,
  bookmarkIds: string[],
  addTagIds: string[] = [],
  removeTagIds: string[] = []
) {
  const bookmarkPlaceholders = bookmarkIds.map(() => "?").join(", ");
  const tagIds = [...new Set([...addTagIds, ...removeTagIds])];
  const tagPlaceholders = tagIds.map(() => "?").join(", ");
  const validBookmarkRows = await db
    .prepare(`SELECT id FROM bookmarks WHERE id IN (${bookmarkPlaceholders})`)
    .bind(...bookmarkIds)
    .all<{ id: string }>();
  const validBookmarkIds = validBookmarkRows.results.map((row) => row.id);
  if (!validBookmarkIds.length || !tagIds.length) return { bookmarks: validBookmarkIds.length, tags: 0 };

  const validTagRows = await db
    .prepare(`SELECT id FROM tags WHERE id IN (${tagPlaceholders}) AND lower(name) NOT IN ('untagged')`)
    .bind(...tagIds)
    .all<{ id: string }>();
  const validTagIds = new Set(validTagRows.results.map((row) => row.id));
  const statements: D1PreparedStatement[] = [];
  const validAddTagIds = addTagIds.filter((id) => validTagIds.has(id));
  const validRemoveTagIds = removeTagIds.filter((id) => validTagIds.has(id));

  for (const bookmarkId of validBookmarkIds) {
    for (const tagId of validAddTagIds) {
      statements.push(
        db.prepare("INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)").bind(bookmarkId, tagId)
      );
    }
    if (validRemoveTagIds.length) {
      statements.push(
        db
          .prepare(`DELETE FROM bookmark_tags WHERE bookmark_id = ? AND tag_id IN (${validRemoveTagIds.map(() => "?").join(", ")})`)
          .bind(bookmarkId, ...validRemoveTagIds)
      );
    }
  }
  if (statements.length) await db.batch(statements);
  return { bookmarks: validBookmarkIds.length, tags: validTagIds.size };
}

function addUpdate(sets: string[], binds: unknown[], column: string, value: unknown) {
  sets.push(`${column} = ?`);
  binds.push(value);
}

async function setBookmarkTags(db: D1Database, bookmarkId: string, tagIds: string[]) {
  const statements = [db.prepare("DELETE FROM bookmark_tags WHERE bookmark_id = ?").bind(bookmarkId)];
  const validTags = await db.prepare("SELECT id FROM tags WHERE lower(name) NOT IN ('untagged')").all<{ id: string }>();
  const validTagIds = new Set(validTags.results.map((tag) => tag.id));
  for (const tagId of new Set(tagIds.filter((id) => id && validTagIds.has(id)))) {
    statements.push(
      db.prepare("INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)").bind(bookmarkId, tagId)
    );
  }
  await db.batch(statements);
}
