export async function resetAllData(db: D1Database) {
  const [bookmarks, folders, tags] = await Promise.all([
    countRows(db, "bookmarks"),
    countRows(db, "folders"),
    countRows(db, "tags")
  ]);

  await db.batch([
    db.prepare("DELETE FROM bookmark_tags"),
    db.prepare("DELETE FROM bookmarks"),
    db.prepare("DELETE FROM folders"),
    db.prepare("DELETE FROM tags")
  ]);

  return { bookmarks, folders, tags };
}

async function countRows(db: D1Database, table: "bookmarks" | "folders" | "tags") {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>();
  return row?.count ?? 0;
}
