import assert from "node:assert/strict";
import { Miniflare } from "miniflare";

// Keep storage temporary: this checks the image, not the application's volume.
const worker = new Miniflare({
  modules: true,
  compatibilityDate: "2026-07-17",
  d1Databases: ["DB"],
  kvNamespaces: ["PREFERENCES"],
  script: `export default {
    async fetch(request, env) {
      const row = await env.DB.prepare("SELECT 42 AS value").first();
      await env.PREFERENCES.put("container-smoke", "ready");
      return Response.json({ value: row.value, status: await env.PREFERENCES.get("container-smoke") });
    }
  }`
});

try {
  const response = await worker.dispatchFetch("http://localhost/container-smoke");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { value: 42, status: "ready" });
  console.log("Container runtime smoke check passed: workerd, D1, and KV.");
} finally {
  await worker.dispose();
}
