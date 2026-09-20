import assert from "node:assert/strict";
import test from "node:test";
import { memoryD1 } from "./helpers/runtime.mjs";

const { bulkUpdateBookmarkTags } = await import("../src/lib/repositories/bookmarks.ts");

test("bulk tags support 500 bookmarks and 100 removals within D1 query limits", async () => {
  const db = memoryD1();
  try {
    db.sqlite.exec("DELETE FROM tags");
    const ids = Array.from({ length: 500 }, (_, index) => `bookmark-${index}`);
    const tags = Array.from({ length: 101 }, (_, index) => `tag-${index}`);
    for (const id of [...ids, "outside"]) db.sqlite.prepare("INSERT INTO bookmarks (id, title, url) VALUES (?, ?, ?)").run(id, id, "https://example.com");
    for (const id of tags) db.sqlite.prepare("INSERT INTO tags (id, name) VALUES (?, ?)").run(id, id);
    db.sqlite.exec("INSERT INTO bookmark_tags SELECT bookmarks.id, tags.id FROM bookmarks CROSS JOIN tags");
    const removed = await bulkUpdateBookmarkTags(db, [...ids, "missing"], [], tags.slice(0, 100));
    assert.deepEqual(removed, { bookmarks: 500, tags: 100 });
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM bookmark_tags").get().n, 601);
    const added = await bulkUpdateBookmarkTags(db, ids, [tags[0], "missing-tag"], []);
    assert.deepEqual(added, { bookmarks: 500, tags: 1 });
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM bookmark_tags").get().n, 1101);
  } finally { db.sqlite.close(); }
});
