import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/runtime.mjs";
const { parseChromeBookmarksHtml } = await import("../src/lib/bookmark-html.ts");

test("legacy VPN_REQUIRED attributes become a regular tag", () => {
  const parsed = parseChromeBookmarksHtml(`
    <!DOCTYPE NETSCAPE-Bookmark-file-1>
    <DL><p>
      <DT><A HREF="https://example.com" VPN_REQUIRED="1">Example</A>
    </DL><p>
  `);

  assert.deepEqual(parsed.bookmarks?.[0]?.tagNames, ["VPN Required"]);
});

test("HTML entities are decoded once so literal entity text and URLs survive import", () => {
  const parsed = parseChromeBookmarksHtml('<DL><p><DT><A HREF="https://example.com/?q=&amp;#65;&amp;x=&amp;lt;">&amp;lt; &amp;#65; &#x1f600;</A></DL><p>');
  assert.equal(parsed.bookmarks[0].url, "https://example.com/?q=&#65;&x=&lt;");
  assert.equal(parsed.bookmarks[0].title, "&lt; &#65; 😀");
});

test("folder endings do not require the optional paragraph tag", () => {
  const parsed = parseChromeBookmarksHtml('<DL><DT><H3>Inside</H3><DL><DT><A HREF="https://inside.example">Inside</A></DL><DT><A HREF="https://outside.example">Outside</A></DL>');
  assert.equal(parsed.bookmarks[0].folderId, parsed.folders[0].id);
  assert.equal(parsed.bookmarks[1].folderId, null);
});

test("invalid numeric entities do not abort an otherwise valid import", () => {
  const parsed = parseChromeBookmarksHtml('<DT><A HREF="https://example.com">&#99999999; &#0; &#xD800;</A>');
  assert.equal(parsed.bookmarks[0].title, "� � �");
});
