import { spawnSync } from "node:child_process";

const steps = [
  ["npm", ["run", "build"]],
  ["npm", ["run", "db:migrate:local"]]
];

for (const [command, args] of steps) {
  const label = [command, ...args].join(" ");
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("\nLocal rebuild complete.");
