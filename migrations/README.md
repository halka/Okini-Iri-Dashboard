# D1 Migrations

This directory is intentionally compacted for fresh deployments. Existing local or remote D1 databases that already applied older migrations should be recreated before applying this migration set.

## Current Schema

- `0001_initial.sql`: Creates the current folders, bookmarks, tags, and bookmark/tag join tables.

For future schema changes, add a new numbered migration after `0001_initial.sql`.
