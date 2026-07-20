import type { APIRoute } from "astro";
import { AuthConfigurationError, readOidcConfig } from "../../lib/auth/config";
import { authErrorUrl, redirectResponse } from "../../lib/auth/http";
import { AuthAccessDeniedError, exchangeAuthorizationCode } from "../../lib/auth/oidc";
import {
  authIdTokenKey,
  authTransactionKey,
  authUserKey,
  oidcTransactionTtlSeconds,
  readOidcTransaction,
  requireSession
} from "../../lib/auth/session";

export const GET: APIRoute = async ({ session, url }) => {
  const authSession = requireSession(session);
  const transaction = await readOidcTransaction(authSession);
  authSession.delete(authTransactionKey);

  if (!transaction || Date.now() - transaction.createdAt > oidcTransactionTtlSeconds * 1000) {
    return redirectResponse(authErrorUrl(url.origin, "session_expired"));
  }

  try {
    const config = readOidcConfig();
    if (!config) return redirectResponse(authErrorUrl(url.origin, "configuration"));

    const callbackUrl = new URL("/auth/callback", url).href;
    const { user, idToken } = await exchangeAuthorizationCode(config, callbackUrl, url, transaction);
    await authSession.regenerate();
    authSession.set(authUserKey, user, { ttl: config.sessionTtlSeconds });
    if (idToken) authSession.set(authIdTokenKey, idToken, { ttl: config.sessionTtlSeconds });
    return redirectResponse(new URL(transaction.returnTo, url));
  } catch (error) {
    console.error("OIDC callback validation failed", error);
    const code = error instanceof AuthConfigurationError ? "configuration" : error instanceof AuthAccessDeniedError ? "access_denied" : "callback_invalid";
    return redirectResponse(authErrorUrl(url.origin, code));
  }
};
