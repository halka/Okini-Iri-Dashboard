import assert from "node:assert/strict";
import test from "node:test";
import { memoryKv } from "./helpers/runtime.mjs";

const { env } = await import("cloudflare:workers");
const { PATCH } = await import("../src/pages/api/settings.ts");
const { onRequest } = await import("../src/middleware.ts");
const { GET: login } = await import("../src/pages/auth/login.ts");

const oidc = {
  issuerUrl: "https://id.example.com/", clientId: "dashboard", tokenAuthMethod: "none",
  scopes: "openid email", allowedEmails: "owner@example.com", allowedDomains: "", sessionTtlSeconds: 600
};

test("partial settings PATCH preserves omitted site and OIDC values", async () => {
  env.PREFERENCES = memoryKv({ "settings:global": { site: { title: "My dashboard", description: "Saved" }, oidc } });
  const response = await PATCH({ locals: {}, request: new Request("https://app.example.com/api/settings", {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ site: { description: "Updated" }, oidc: { sessionTtlSeconds: 1200 } })
  }) });
  assert.equal(response.status, 200);
  const { settings } = await response.json();
  assert.equal(settings.site.title, "My dashboard");
  assert.equal(settings.site.description, "Updated");
  assert.deepEqual(Object.fromEntries(Object.keys(oidc).map(key => [key, settings.oidc[key]])), { ...oidc, sessionTtlSeconds: 1200 });
});

test("enabling OIDC rejects a session created while authentication was disabled", async () => {
  env.PREFERENCES = memoryKv();
  const stored = new Map();
  const session = {
    async get(key) { return stored.get(key); },
    set(key, value) { stored.set(key, value); },
    delete(key) { stored.delete(key); },
    async regenerate() {}
  };
  const url = new URL("https://app.example.com/auth/login");
  assert.equal((await login({ locals: {}, session, url })).status, 302);
  // Include a legacy session issued by previous application versions.
  stored.set("auth:user", { subject: "optional-authentication-disabled", issuer: "urn:optional-authentication", local: false });
  env.PREFERENCES = memoryKv({ "settings:global": { oidc } });
  const request = new Request("https://app.example.com/api/bookmarks");
  const response = await onRequest({ locals: {}, session, request, url: new URL(request.url) }, () => new Response("private data"));
  assert.equal(response.status, 401);
});

test("OIDC sessions remain accepted and uploaded favicon sources are allowed", async () => {
  env.PREFERENCES = memoryKv({ "settings:global": { oidc } });
  const request = new Request("https://app.example.com/");
  const session = { async get() { return { subject: "user", issuer: oidc.issuerUrl, local: false }; } };
  const response = await onRequest({ locals: {}, session, request, url: new URL(request.url) }, () => new Response("dashboard"));
  assert.equal(response.status, 200);
  const imageSources = response.headers.get("content-security-policy").match(/(?:^|;)\s*img-src\s+([^;]+)/)[1].split(/\s+/);
  assert.ok(imageSources.includes("data:"));
});
