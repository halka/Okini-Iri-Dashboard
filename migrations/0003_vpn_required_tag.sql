-- Convert the legacy per-bookmark VPN flag into a regular tag.
INSERT INTO tags (id, name, primary_color, created_at)
SELECT 'tag_vpn_required', 'VPN Required', '#F172A3', CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM tags WHERE lower(trim(name)) = 'vpn required'
);

INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id)
SELECT
  bookmarks.id,
  (
    SELECT tags.id
    FROM tags
    WHERE lower(trim(tags.name)) = 'vpn required'
    ORDER BY CASE WHEN tags.name = 'VPN Required' THEN 0 ELSE 1 END
    LIMIT 1
  )
FROM bookmarks
WHERE bookmarks.vpn_required = 1;
