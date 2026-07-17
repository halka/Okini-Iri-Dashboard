interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  PREFERENCES: KVNamespace;
  SESSION: KVNamespace;
}

type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {}
}

declare namespace Cloudflare {
  interface Env {
    ASSETS: Fetcher;
    DB: D1Database;
    PREFERENCES: KVNamespace;
    SESSION: KVNamespace;
  }
}
