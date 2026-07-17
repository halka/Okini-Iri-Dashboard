import { env } from "cloudflare:workers";

export function getKv(_locals: App.Locals): KVNamespace {
  const kv = env.PREFERENCES;
  if (!kv) {
    throw new Error("KV binding PREFERENCES is not available. Run with Wrangler or configure Cloudflare KV.");
  }
  return kv;
}
