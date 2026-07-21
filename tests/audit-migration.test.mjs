import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("audit migration stores actor, action, target, and summary", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0004_audit_logs.sql", import.meta.url), "utf8"));
  db.prepare(
    `INSERT INTO audit_logs
      (id, actor_subject, actor_name, action, entity_type, entity_id, summary)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("log-1", "user-1", "Example User", "bookmark.created", "bookmark", "bookmark-1", "Example");

  const row = db.prepare("SELECT actor_name, action, entity_id, summary FROM audit_logs WHERE id = ?").get("log-1");
  assert.deepEqual({ ...row }, {
    actor_name: "Example User",
    action: "bookmark.created",
    entity_id: "bookmark-1",
    summary: "Example"
  });
  db.close();
});
