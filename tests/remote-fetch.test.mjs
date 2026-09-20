import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/runtime.mjs";

const { fetchPublicUrl } = await import("../src/lib/remote-fetch.ts");
const { fetchUrlMetadata } = await import("../src/lib/metadata.ts");

test("redirect responses release unread bodies before following Location", async (t) => {
  let released = false;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    if (++calls === 1) return new Response(new ReadableStream({ cancel() { released = true; } }), {
      status: 302, headers: { location: "/final" }
    });
    assert.ok(released);
    return new Response("done");
  });
  assert.equal(await (await fetchPublicUrl("https://example.com/start")).text(), "done");
});

test("metadata releases non-HTML pages and icon bodies after checking headers", async (t) => {
  let opened = 0;
  let released = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    opened++;
    return new Response(new ReadableStream({ cancel() { released++; } }), {
      headers: { "content-type": String(url).endsWith("/page") ? "application/json" : "image/png" }
    });
  });
  const metadata = await fetchUrlMetadata("https://example.com/page");
  assert.equal(metadata.faviconUrl, "https://example.com/favicon.ico");
  assert.equal(released, opened);
});
