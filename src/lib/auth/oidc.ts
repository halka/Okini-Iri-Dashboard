import * as oauth from "oauth4webapi";
import type { AuthUser, OidcTransaction } from "../../domain/auth";
import type { OidcConfig } from "./config";

const discoveryCache = new Map<string, Promise<oauth.AuthorizationServer>>();

export class AuthAccessDeniedError extends Error {}

function stringClaim(source: oauth.IDToken | oauth.UserInfoResponse, key: string) {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function discoverProvider(config: OidcConfig) {
  const cacheKey = config.issuer.href;
  const cached = discoveryCache.get(cacheKey);
  if (cached) return cached;

  const discovery = (async () => {
    const response = await oauth.discoveryRequest(config.issuer, { algorithm: "oidc" });
    const server = await oauth.processDiscoveryResponse(config.issuer, response);
    if (!server.authorization_endpoint || !server.token_endpoint) {
      throw new Error("OIDC provider does not expose required endpoints");
    }
    return server;
  })();
  discoveryCache.set(cacheKey, discovery);

  try {
    return await discovery;
  } catch (error) {
    discoveryCache.delete(cacheKey);
    throw error;
  }
}

function client(config: OidcConfig): oauth.Client {
  return { client_id: config.clientId };
}

function clientAuthentication(config: OidcConfig) {
  if (config.tokenAuthMethod === "client_secret_post") return oauth.ClientSecretPost(config.clientSecret!);
  if (config.tokenAuthMethod === "client_secret_basic") return oauth.ClientSecretBasic(config.clientSecret!);
  return oauth.None();
}

export async function createAuthorizationRequest(config: OidcConfig, callbackUrl: string, returnTo: string) {
  const server = await discoverProvider(config);
  const transaction: OidcTransaction = {
    state: oauth.generateRandomState(),
    nonce: oauth.generateRandomNonce(),
    codeVerifier: oauth.generateRandomCodeVerifier(),
    returnTo,
    createdAt: Date.now()
  };
  const codeChallenge = await oauth.calculatePKCECodeChallenge(transaction.codeVerifier);
  const authorizationUrl = new URL(server.authorization_endpoint!);
  authorizationUrl.searchParams.set("client_id", config.clientId);
  authorizationUrl.searchParams.set("redirect_uri", callbackUrl);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", config.scopes);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("state", transaction.state);
  authorizationUrl.searchParams.set("nonce", transaction.nonce);
  return { authorizationUrl, transaction };
}

export async function exchangeAuthorizationCode(config: OidcConfig, callbackUrl: string, callbackRequestUrl: URL, transaction: OidcTransaction) {
  const server = await discoverProvider(config);
  const oidcClient = client(config);
  const callbackParameters = oauth.validateAuthResponse(server, oidcClient, callbackRequestUrl, transaction.state);
  const tokenResponse = await oauth.authorizationCodeGrantRequest(
    server,
    oidcClient,
    clientAuthentication(config),
    callbackParameters,
    callbackUrl,
    transaction.codeVerifier
  );
  const tokens = await oauth.processAuthorizationCodeResponse(server, oidcClient, tokenResponse, {
    expectedNonce: transaction.nonce,
    requireIdToken: true
  });
  await oauth.validateApplicationLevelSignature(server, tokenResponse);

  const claims = oauth.getValidatedIdTokenClaims(tokens);
  if (!claims) throw new Error("OIDC provider did not return an ID token");

  let profile: oauth.IDToken | oauth.UserInfoResponse = claims;
  if (server.userinfo_endpoint) {
    const userInfoResponse = await oauth.userInfoRequest(server, oidcClient, tokens.access_token);
    profile = await oauth.processUserInfoResponse(server, oidcClient, claims.sub, userInfoResponse);
  }

  const email = stringClaim(profile, "email") ?? stringClaim(claims, "email") ?? null;
  const emailVerified = profile.email_verified ?? claims.email_verified;
  if (email && emailVerified === false) throw new AuthAccessDeniedError("The OIDC email address is not verified");
  assertAllowedIdentity(config, email);

  const preferredUsername = stringClaim(profile, "preferred_username") ?? stringClaim(claims, "preferred_username") ?? null;
  const name = stringClaim(profile, "name") ?? stringClaim(claims, "name") ?? preferredUsername ?? email ?? claims.sub;
  const user: AuthUser = {
    subject: claims.sub,
    issuer: claims.iss,
    name,
    email,
    preferredUsername,
    local: false
  };
  return { user, idToken: tokens.id_token };
}

function assertAllowedIdentity(config: OidcConfig, email: string | null) {
  if (config.allowedEmails.size === 0 && config.allowedDomains.size === 0) return;
  if (!email) throw new AuthAccessDeniedError("An email claim is required by the configured allowlist");

  const normalizedEmail = email.trim().toLowerCase();
  const at = normalizedEmail.lastIndexOf("@");
  if (at <= 0 || at === normalizedEmail.length - 1 || normalizedEmail.indexOf("@") !== at) {
    throw new AuthAccessDeniedError("The OIDC email claim is invalid");
  }
  const domain = normalizedEmail.slice(at + 1);
  if (!config.allowedEmails.has(normalizedEmail) && !config.allowedDomains.has(domain)) {
    throw new AuthAccessDeniedError("The OIDC identity is not allowed");
  }
}

export function localDevelopmentUser(): AuthUser {
  return {
    subject: "local-development",
    issuer: "urn:local-development",
    name: "Local development",
    email: null,
    preferredUsername: null,
    local: true
  };
}

export function optionalAuthenticationUser(): AuthUser {
  return {
    subject: "optional-authentication-disabled",
    issuer: "urn:optional-authentication",
    name: "Authentication disabled",
    email: null,
    preferredUsername: null,
    local: false
  };
}
