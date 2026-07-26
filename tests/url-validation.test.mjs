import assert from "node:assert/strict";
import test from "node:test";
import { isSupportedBookmarkUrl } from "../src/lib/bookmark-url.ts";
import { publicHttpUrl, UnsafeRemoteUrlError } from "../src/lib/remote-fetch.ts";

test("bookmark URLs may contain HTTP(S) basic-auth credentials", () => {
  assert.equal(isSupportedBookmarkUrl("https://user:password@example.com/private"), true);
  assert.equal(isSupportedBookmarkUrl("http://user@example.com/private"), true);
});

test("server-side remote fetches continue to reject credential-bearing URLs", () => {
  assert.throws(
    () => publicHttpUrl("https://user:password@example.com/private"),
    (error) => error instanceof UnsafeRemoteUrlError
  );
});
