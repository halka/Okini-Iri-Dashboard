import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import test from "node:test";

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
