import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const config = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const placeholders = [...config.matchAll(/REPLACE_WITH_[A-Z0-9_]+/g)].map(([value]) => value);

if (placeholders.length) {
  console.error("Cloudflare resource IDs are not configured in wrangler.toml:");
  for (const placeholder of [...new Set(placeholders)]) console.error(`- ${placeholder}`);
  console.error("Create the D1/KV resources, replace these values, and run npm run deploy again.");
  process.exit(1);
}

const steps = [
  ["npm", ["run", "build"]],
  ["npm", ["run", "db:migrate:remote"]],
  ["npx", ["wrangler", "deploy", "--config", "dist/server/wrangler.json"]]
];

for (const [command, args] of steps) {
  console.log(`\n> ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("\nDeployment complete.");
