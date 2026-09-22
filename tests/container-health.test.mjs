import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import test from "node:test";

test("container stages use Alpine without a Debian donor", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  const stages = [...dockerfile.matchAll(/^FROM\s+(\S+)/gm)].map((match) => match[1]);
  assert.ok(stages.length >= 2);
  assert.match(stages[0], /alpine/);
  assert.ok(stages.slice(1).every((image) => image === "base"), `unexpected external stage found: ${stages.join(", ")}`);
  assert.match(dockerfile, /apk add --no-cache ca-certificates gcompat/);
  assert.doesNotMatch(dockerfile, /\b(?:debian|apt-get)\b/i);
});

test("container smoke script starts workerd with D1 and KV", async () => {
  const script = fileURLToPath(new URL("../scripts/container-smoke.mjs", import.meta.url));
  const child = spawn(process.execPath, [script], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const [code] = await once(child, "exit");
  assert.equal(code, 0, output);
  assert.match(output, /Container runtime smoke check passed/);
});

test("container health command works with protected APIs and rejects server errors", async () => {
  const compose = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
  const command = JSON.parse(compose.match(/^\s+test:\s*(\[.*\])$/m)[1]);
  assert.deepEqual(command.slice(0, 3), ["CMD", "node", "-e"]);
  let healthy = true;
  const server = createServer((request, response) => {
    response.statusCode = request.url === "/favicon.svg" ? (healthy ? 200 : 503) : 401;
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const script = command[3].replace("http://localhost:8787", `http://127.0.0.1:${server.address().port}`);
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", script], { windowsHide: true, stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", resolve);
  });
  try {
    assert.equal(await run(), 0);
    healthy = false;
    assert.equal(await run(), 1);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
