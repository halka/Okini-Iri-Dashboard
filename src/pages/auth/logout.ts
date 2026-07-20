import type { APIRoute } from "astro";
import { readOidcConfig } from "../../lib/auth/config";
import { redirectResponse } from "../../lib/auth/http";
import { discoverProvider } from "../../lib/auth/oidc";
import { authIdTokenKey, requireSession } from "../../lib/auth/session";

export const POST: APIRoute = async ({ session, url }) => {
  const authSession = requireSession(session);
  const idToken = await authSession.get<string>(authIdTokenKey);
  authSession.destroy();
  const signedOutUrl = new URL("/auth/signed-out", url);

  try {
    const config = readOidcConfig();
    if (!config || !idToken) return redirectResponse(signedOutUrl, 303);
    const provider = await discoverProvider(config);
    if (!provider.end_session_endpoint) return redirectResponse(signedOutUrl, 303);

    const logoutUrl = new URL(provider.end_session_endpoint);
    logoutUrl.searchParams.set("id_token_hint", idToken);
    logoutUrl.searchParams.set("post_logout_redirect_uri", signedOutUrl.href);
    return redirectResponse(logoutUrl, 303);
  } catch (error) {
    console.error("OIDC provider logout failed", error);
    return redirectResponse(signedOutUrl, 303);
  }
};

export const ALL: APIRoute = () => new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
