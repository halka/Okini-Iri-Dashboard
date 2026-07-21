# D1 Migrations

Apply these migrations in order for fresh or existing D1 databases.

## Current Schema

- `0001_initial.sql`: Creates the folders, bookmarks, tags, and bookmark/tag join tables.
- `0002_bookmark_vpn_required.sql`: Adds the per-bookmark VPN-required flag.
- `0003_vpn_required_tag.sql`: Converts the legacy VPN-required flag into the regular `VPN Required` tag.
- `0004_audit_logs.sql`: Adds the bounded application audit log.

For future schema changes, add a new numbered migration after the latest file.
