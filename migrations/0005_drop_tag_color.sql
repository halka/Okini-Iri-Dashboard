PRAGMA foreign_keys=off;

CREATE TABLE IF NOT EXISTS tags_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO tags_new (id, name, created_at)
SELECT id, name, created_at FROM tags;

CREATE TABLE IF NOT EXISTS bookmark_tags_new (
  bookmark_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (bookmark_id, tag_id),
  FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO bookmark_tags_new (bookmark_id, tag_id)
SELECT bookmark_id, tag_id FROM bookmark_tags;

DROP TABLE bookmark_tags;
DROP TABLE tags;

ALTER TABLE tags_new RENAME TO tags;
ALTER TABLE bookmark_tags_new RENAME TO bookmark_tags;

CREATE INDEX IF NOT EXISTS idx_bookmark_tags_tag ON bookmark_tags(tag_id);

PRAGMA foreign_keys=on;
