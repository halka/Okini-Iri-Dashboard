import assert from "node:assert/strict";
import test from "node:test";
import { parseChromeBookmarksHtml } from "../src/lib/bookmark-html.ts";

test("legacy VPN_REQUIRED attributes become a regular tag", () => {
  const parsed = parseChromeBookmarksHtml(`
    <!DOCTYPE NETSCAPE-Bookmark-file-1>
    <DL><p>
      <DT><A HREF="https://example.com" VPN_REQUIRED="1">Example</A>
    </DL><p>
  `);

  assert.deepEqual(parsed.bookmarks?.[0]?.tagNames, ["VPN Required"]);
});
