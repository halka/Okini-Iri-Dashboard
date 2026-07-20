import type { APIRoute } from "astro";
import { AuthConfigurationError, isLoopbackRequest, readOidcConfig } from "../../lib/auth/config";
import { authErrorUrl, redirectResponse, safeReturnTo } from "../../lib/auth/http";
import { createAuthorizationRequest, localDevelopmentUser } from "../../lib/auth/oidc";
import { authTransactionKey, authUserKey, oidcTransactionTtlSeconds, readAuthUser, requireSession } from "../../lib/auth/session";

export const GET: APIRoute = async ({ request, session, url }) => {
  const authSession = requireSession(session);
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));

  try {
    const existingUser = await readAuthUser(authSession);
    if (existingUser) return redirectResponse(new URL(returnTo, url));

    const config = readOidcConfig();
    if (!config) {
      if (!isLoopbackRequest(request)) return redirectResponse(authErrorUrl(url.origin, "configuration"));
      await authSession.regenerate();
      authSession.set(authUserKey, localDevelopmentUser());
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
