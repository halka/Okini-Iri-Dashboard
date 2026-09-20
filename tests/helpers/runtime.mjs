import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";

register("./source-loader.mjs", import.meta.url);

export function memoryKv(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    async get(key) { return structuredClone(values.get(key) ?? null); },
    async put(key, value) { values.set(key, JSON.parse(value)); }
  };
}

// Execute real SQLite queries, with the production D1 bound-parameter limit.
export function memoryD1() {
  const sqlite = new DatabaseSync(":memory:");
  const migrations = new URL("../../migrations/", import.meta.url);
  for (const file of readdirSync(migrations).filter(file => file.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  const db = {
    sqlite,
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let values = [];
      return {
        bind(...input) {
          if (input.length > 100) throw new Error("D1 bound parameter limit exceeded");
          values = input;
          return this;
        },
        async first() { return statement.get(...values) ?? null; },
        async all() { return { results: statement.all(...values) }; },
        async run() { return { meta: statement.run(...values) }; }
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    }
  };
  return db;
}
