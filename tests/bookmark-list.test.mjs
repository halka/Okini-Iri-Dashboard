import assert from "node:assert/strict";
import test from "node:test";
import { memoryD1 } from "./helpers/runtime.mjs";

const { env } = await import("cloudflare:workers");
const { GET } = await import("../src/pages/api/bookmarks/index.ts");
const { PATCH: reorder } = await import("../src/pages/api/bookmarks/reorder.ts");
const { requestBookmarks } = await import("../src/scripts/lib/api-client.ts");

test("dashboard can retrieve and reorder bookmarks beyond the first 500", async (t) => {
  const db = memoryD1();
  env.DB = db;
  try {
    const ids = Array.from({ length: 501 }, (_, i) => `bookmark-${String(i).padStart(4, "0")}`);
    for (const [i, id] of ids.entries()) db.sqlite.prepare("INSERT INTO bookmarks (id, title, url, sort_order) VALUES (?, ?, ?, ?)").run(id, id, "https://example.com", i);
    t.mock.method(globalThis, "fetch", async path => GET({ locals: {}, url: new URL(path, "https://app.example.com") }));
    assert.equal(typeof requestBookmarks, "function", "the dashboard needs to retrieve subsequent API pages");
    const bookmarks = await requestBookmarks();
    assert.deepEqual(bookmarks.map(bookmark => bookmark.id), ids);
    const response = await reorder({ locals: {}, request: new Request("https://app.example.com/api/bookmarks/reorder", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [...ids].reverse() })
    }) });
    assert.equal(response.status, 200);
    assert.deepEqual((await requestBookmarks()).map(bookmark => bookmark.id), [...ids].reverse());
  } finally { db.sqlite.close(); }
});
