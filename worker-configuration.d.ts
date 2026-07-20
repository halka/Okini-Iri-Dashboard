interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  PREFERENCES: KVNamespace;
  SESSION: KVNamespace;
  OIDC_ISSUER_URL?: string;
  OIDC_CLIENT_ID?: string;
  OIDC_CLIENT_SECRET?: string;
  OIDC_TOKEN_AUTH_METHOD?: string;
  OIDC_SCOPES?: string;
  OIDC_ALLOWED_EMAILS?: string;
  OIDC_ALLOWED_DOMAINS?: string;
  AUTH_SESSION_TTL_SECONDS?: string;
}

type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {
    user?: import("./src/domain/auth").AuthUser;
  }

  interface SessionData {
    "auth:user": import("./src/domain/auth").AuthUser;
    "auth:transaction": import("./src/domain/auth").OidcTransaction;
    "auth:id-token": string;
  }
}

declare namespace Cloudflare {
  interface Env {
    ASSETS: Fetcher;
    DB: D1Database;
    PREFERENCES: KVNamespace;
    SESSION: KVNamespace;
    OIDC_ISSUER_URL?: string;
    OIDC_CLIENT_ID?: string;
    OIDC_CLIENT_SECRET?: string;
    OIDC_TOKEN_AUTH_METHOD?: string;
    OIDC_SCOPES?: string;
    OIDC_ALLOWED_EMAILS?: string;
    OIDC_ALLOWED_DOMAINS?: string;
    AUTH_SESSION_TTL_SECONDS?: string;
  }
}
