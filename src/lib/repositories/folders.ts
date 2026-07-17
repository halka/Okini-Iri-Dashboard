import type { Folder } from "../../domain/bookmarks";
import { mapFolder, type D1Row } from "./mappers";

export async function listFolders(db: D1Database): Promise<Folder[]> {
  const result = await db
    .prepare(
      `WITH RECURSIVE folder_tree AS (
        SELECT f.*, printf('%08d', f.sort_order) || ':' || f.name AS tree_path
        FROM folders f
        WHERE f.parent_id IS NULL
        UNION ALL
        SELECT child.*, parent.tree_path || '/' || printf('%08d', child.sort_order) || ':' || child.name
        FROM folders child
        INNER JOIN folder_tree parent ON child.parent_id = parent.id
      )
      SELECT f.id, f.name, f.parent_id, f.sort_order, f.created_at, f.updated_at,
        (SELECT COUNT(*) FROM bookmarks b WHERE b.folder_id = f.id) AS bookmark_count,
        (SELECT COUNT(*) FROM folders child WHERE child.parent_id = f.id) AS child_count
      FROM folder_tree f
      ORDER BY f.tree_path`
    )
    .all<D1Row>();
  return result.results.map(mapFolder);
}

export async function createFolder(db: D1Database, input: { name: string; parentId?: string | null }) {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO folders (id, name, parent_id, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, (SELECT COUNT(*) FROM folders WHERE parent_id IS ?), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    )
    .bind(id, input.name.trim(), input.parentId ?? null, input.parentId ?? null)
    .run();
  return { id };
}

export async function updateFolder(db: D1Database, id: string, input: { name?: string; parentId?: string | null }) {
  const current = await db.prepare("SELECT id FROM folders WHERE id = ?").bind(id).first();
  if (!current) return { status: "not_found" as const };
  if (input.parentId && (input.parentId === id || (await isDescendant(db, id, input.parentId)))) {
    return { status: "cycle" as const };
  }

  const sets = ["updated_at = CURRENT_TIMESTAMP"];
  const binds: unknown[] = [];
  if (input.name !== undefined) {
    sets.push("name = ?");
    binds.push(input.name.trim());
  }
  if (input.parentId !== undefined) {
    sets.push("parent_id = ?");
    binds.push(input.parentId ?? null);
  }
  binds.push(id);
  await db.prepare(`UPDATE folders SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();
  return { status: "updated" as const };
}

async function isDescendant(db: D1Database, folderId: string, candidateParentId: string) {
  const row = await db
    .prepare(
      `WITH RECURSIVE descendants(id) AS (
        SELECT id FROM folders WHERE parent_id = ?
        UNION ALL
        SELECT child.id FROM folders child
        INNER JOIN descendants parent ON child.parent_id = parent.id
      )
      SELECT id FROM descendants WHERE id = ? LIMIT 1`
    )
    .bind(folderId, candidateParentId)
    .first();
  return Boolean(row);
}

export async function deleteFolder(db: D1Database, id: string) {
  const current = await db.prepare("SELECT id FROM folders WHERE id = ?").bind(id).first();
  if (!current) return { status: "not_found" as const };

  const folderTree = `
    WITH RECURSIVE folder_tree(id) AS (
      SELECT id FROM folders WHERE id = ?
      UNION ALL
      SELECT child.id FROM folders child
      INNER JOIN folder_tree parent ON child.parent_id = parent.id
    )
  `;
  const counts = await db
    .prepare(
      `${folderTree}
       SELECT
        (SELECT COUNT(*) FROM bookmarks WHERE folder_id IN (SELECT id FROM folder_tree)) AS bookmark_count,
        (SELECT COUNT(*) FROM folder_tree WHERE id != ?) AS child_count`
    )
    .bind(id, id)
    .first<{ bookmark_count: number; child_count: number }>();

  await db.batch([
    db
      .prepare(
        `${folderTree}
         DELETE FROM bookmark_tags
         WHERE bookmark_id IN (SELECT id FROM bookmarks WHERE folder_id IN (SELECT id FROM folder_tree))`
      )
      .bind(id),
    db.prepare(`${folderTree} DELETE FROM bookmarks WHERE folder_id IN (SELECT id FROM folder_tree)`).bind(id),
    db.prepare(`${folderTree} DELETE FROM folders WHERE id IN (SELECT id FROM folder_tree)`).bind(id)
  ]);

  return {
    status: "deleted" as const,
    bookmarkCount: counts?.bookmark_count ?? 0,
    childCount: counts?.child_count ?? 0
  };
}
