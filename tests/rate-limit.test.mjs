import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { consumeRateLimit } from "../src/lib/rate-limit.ts";

test("rate limit allows the configured number of requests", () => {
  const scope = `test-${randomUUID()}`;
  const request = new Request("https://example.test", { headers: { "cf-connecting-ip": "198.51.100.20" } });
  assert.equal(consumeRateLimit(request, scope, 2, 60_000).allowed, true);
  assert.equal(consumeRateLimit(request, scope, 2, 60_000).allowed, true);
  const blocked = consumeRateLimit(request, scope, 2, 60_000);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfter > 0);
});
