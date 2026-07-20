import type { APIRoute } from "astro";
import { AuthConfigurationError, readOidcConfig } from "../../lib/auth/config";
import { authErrorUrl, redirectResponse, safeReturnTo } from "../../lib/auth/http";
import { createAuthorizationRequest, optionalAuthenticationUser } from "../../lib/auth/oidc";
import { authTransactionKey, authUserKey, oidcTransactionTtlSeconds, readAuthUser, requireSession } from "../../lib/auth/session";
import { getKv } from "../../lib/kv";

export const GET: APIRoute = async ({ locals, session, url }) => {
  const authSession = requireSession(session);
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));

  try {
    const existingUser = await readAuthUser(authSession);
    if (existingUser) return redirectResponse(new URL(returnTo, url));

    const config = await readOidcConfig(getKv(locals));
    if (!config) {
      await authSession.regenerate();
      authSession.set(authUserKey, optionalAuthenticationUser());
      return redirectResponse(new URL(returnTo, url));
    }

    const callbackUrl = new URL("/auth/callback", url).href;
    const { authorizationUrl, transaction } = await createAuthorizationRequest(config, callbackUrl, returnTo);
    authSession.set(authTransactionKey, transaction, { ttl: oidcTransactionTtlSeconds });
    return redirectResponse(authorizationUrl);
  } catch (error) {
    console.error("OIDC login could not be started", error);
    const code = error instanceof AuthConfigurationError ? "configuration" : "login_failed";
    return redirectResponse(authErrorUrl(url.origin, code));
  }
};
