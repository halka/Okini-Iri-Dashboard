import { env } from "cloudflare:workers";

export type OidcTokenAuthMethod = "client_secret_basic" | "client_secret_post" | "none";

export type OidcConfig = {
  issuer: URL;
  clientId: string;
  clientSecret?: string;
  tokenAuthMethod: OidcTokenAuthMethod;
  scopes: string;
  allowedEmails: ReadonlySet<string>;
  allowedDomains: ReadonlySet<string>;
  sessionTtlSeconds: number;
};

export class AuthConfigurationError extends Error {}

const defaultSessionTtlSeconds = 8 * 60 * 60;

function optionalEnv(name: keyof Env) {
  const value = env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function commaSeparated(value: string | undefined) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
}

function sessionTtl(value: string | undefined) {
  if (!value) return defaultSessionTtlSeconds;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 300 || parsed > 30 * 24 * 60 * 60) {
    throw new AuthConfigurationError("AUTH_SESSION_TTL_SECONDS must be between 300 and 2592000");
  }
  return parsed;
}

export function readOidcConfig(): OidcConfig | null {
  const issuerValue = optionalEnv("OIDC_ISSUER_URL");
  const clientId = optionalEnv("OIDC_CLIENT_ID");

  if (!issuerValue && !clientId) return null;
  if (!issuerValue || !clientId) {
    throw new AuthConfigurationError("OIDC_ISSUER_URL and OIDC_CLIENT_ID must be configured together");
  }

  let issuer: URL;
  try {
    issuer = new URL(issuerValue);
  } catch {
    throw new AuthConfigurationError("OIDC_ISSUER_URL must be a valid URL");
  }
  if (issuer.protocol !== "https:") {
    throw new AuthConfigurationError("OIDC_ISSUER_URL must use HTTPS");
  }

  const clientSecret = optionalEnv("OIDC_CLIENT_SECRET");
  const configuredMethod = optionalEnv("OIDC_TOKEN_AUTH_METHOD");
  const tokenAuthMethod = (configuredMethod ?? (clientSecret ? "client_secret_basic" : "none")) as OidcTokenAuthMethod;
  if (!["client_secret_basic", "client_secret_post", "none"].includes(tokenAuthMethod)) {
    throw new AuthConfigurationError("OIDC_TOKEN_AUTH_METHOD is not supported");
  }
  if (tokenAuthMethod !== "none" && !clientSecret) {
    throw new AuthConfigurationError("OIDC_CLIENT_SECRET is required for the configured token authentication method");
  }

  const scopeSet = new Set((optionalEnv("OIDC_SCOPES") ?? "openid profile email").split(/\s+/).filter(Boolean));
  scopeSet.add("openid");

  return {
    issuer,
    clientId,
    clientSecret,
    tokenAuthMethod,
    scopes: [...scopeSet].join(" "),
    allowedEmails: commaSeparated(optionalEnv("OIDC_ALLOWED_EMAILS")),
    allowedDomains: new Set([...commaSeparated(optionalEnv("OIDC_ALLOWED_DOMAINS"))].map((domain) => domain.replace(/^@/, ""))),
    sessionTtlSeconds: sessionTtl(optionalEnv("AUTH_SESSION_TTL_SECONDS"))
  };
}

export function isLoopbackRequest(request: Request) {
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
