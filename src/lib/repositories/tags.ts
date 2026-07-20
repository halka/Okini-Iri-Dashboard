import type { Tag } from "../../domain/bookmarks";
import { mapTag, type D1Row } from "./mappers";

export async function listTags(db: D1Database): Promise<Tag[]> {
  const result = await db.prepare("SELECT id, name, primary_color FROM tags ORDER BY name COLLATE NOCASE").all<D1Row>();
  return result.results.map(mapTag);
}

export async function createTag(db: D1Database, input: { name: string; primaryColor: string }) {
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO tags (id, name, primary_color, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)")
    .bind(id, input.name.trim(), input.primaryColor)
    .run();
  return { id };
}

export async function updateTag(db: D1Database, id: string, input: { name?: string; primaryColor?: string }) {
  const current = await db.prepare("SELECT id FROM tags WHERE id = ?").bind(id).first();
  if (!current) return false;
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (input.name !== undefined) {
    sets.push("name = ?");
    binds.push(input.name.trim());
  }
  if (input.primaryColor !== undefined) {
    sets.push("primary_color = ?");
    binds.push(input.primaryColor);
  }
  if (sets.length) {
    binds.push(id);
    await db.prepare(`UPDATE tags SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();
  }
  return true;
}

export async function deleteTag(db: D1Database, id: string) {
  const result = await db.prepare("DELETE FROM tags WHERE id = ?").bind(id).run();
  return result.meta.changes > 0;
}
