import type { Tag } from "../../domain/bookmarks";
import { mapTag, type D1Row } from "./mappers";

export async function listTags(db: D1Database): Promise<Tag[]> {
  const result = await db.prepare("SELECT id, name FROM tags ORDER BY name COLLATE NOCASE").all<D1Row>();
  return result.results.map(mapTag);
}

export async function createTag(db: D1Database, input: { name: string }) {
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO tags (id, name, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)").bind(id, input.name.trim()).run();
  return { id };
}

export async function updateTag(db: D1Database, id: string, input: { name?: string }) {
  const current = await db.prepare("SELECT id FROM tags WHERE id = ?").bind(id).first();
  if (!current) return false;
  if (input.name !== undefined) {
    await db.prepare("UPDATE tags SET name = ? WHERE id = ?").bind(input.name.trim(), id).run();
  }
  return true;
}

export async function deleteTag(db: D1Database, id: string) {
  const result = await db.prepare("DELETE FROM tags WHERE id = ?").bind(id).run();
  return result.meta.changes > 0;
}
