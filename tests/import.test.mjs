import assert from "node:assert/strict";
import test from "node:test";
import { memoryD1 } from "./helpers/runtime.mjs";

const { env } = await import("cloudflare:workers");
const { POST } = await import("../src/pages/api/import.ts");

test("preserve-existing mode skips the entire multi-file import", async () => {
  const db = memoryD1();
  env.DB = db;
  try {
    db.sqlite.prepare("INSERT INTO bookmarks (id, title, url) VALUES (?, ?, ?)").run("original", "Original", "https://example.com");
    const html = '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><A HREF="javascript:void(0)">Imported</A></DL><p>';
    const response = await POST({ locals: {}, request: new Request("https://app.example.com/api/import", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ append: false, force: false, files: [{ html }, { html }] })
    }) });
    const messages = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
    assert.equal(messages.at(-1).type, "complete");
    assert.equal(messages.at(-1).result.skipped, true);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM bookmarks").get().n, 1);
  } finally { db.sqlite.close(); }
});
