import { env } from "cloudflare:workers";

export function getDb(_locals: App.Locals): D1Database {
  const db = env.DB;
  if (!db) {
    throw new Error("D1 binding DB is not available. Run with Wrangler or configure Cloudflare D1.");
  }
  return db;
}
