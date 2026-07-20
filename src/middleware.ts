import { defineMiddleware } from "astro:middleware";
import type { AuthUser } from "./domain/auth";
import { isLoopbackRequest, readOidcConfig } from "./lib/auth/config";
import { redirectResponse } from "./lib/auth/http";
import { optionalAuthenticationUser } from "./lib/auth/oidc";
import { readAuthUser, requireSession } from "./lib/auth/session";
import { json } from "./lib/http";
import { getKv } from "./lib/kv";

const publicRoutes = new Set(["/auth/login", "/auth/callback", "/auth/error", "/auth/signed-out"]);
const publicAssets = new Set(["/favicon.svg", "/theme-boot.js"]);

function isPublicPath(pathname: string) {
  return publicRoutes.has(pathname) || publicAssets.has(pathname) || pathname.startsWith("/_astro/");
}

function isUnsafeCrossOriginRequest(request: Request, origin: string) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return false;
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin && requestOrigin !== origin) return true;
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === "cross-site";
}

function secure(response: Response, pathname: string, request: Request) {
  const headers = new Headers(response.headers);
  headers.set("referrer-policy", "same-origin");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("permissions-policy", "camera=(), geolocation=(), microphone=()");
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("cross-origin-resource-policy", "same-origin");
  headers.set("x-permitted-cross-domain-policies", "none");
  if (!isPublicPath(pathname)) headers.set("cache-control", "private, no-store");
  if (new URL(request.url).protocol === "https:") {
    headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  }
  if (!isLoopbackRequest(request)) {
    headers.set(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https:; connect-src 'self'; " +
        "font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; " +
        "script-src-attr 'none'"
    );
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  if (isPublicPath(pathname)) return secure(await next(), pathname, context.request);

  if (isUnsafeCrossOriginRequest(context.request, context.url.origin)) {
    const response = pathname.startsWith("/api/")
      ? json({ error: "Cross-origin request rejected", code: "forbidden" }, 403)
      : new Response("Forbidden", { status: 403 });
    return secure(response, pathname, context.request);
  }

  let oidcConfigured = false;
  try {
    oidcConfigured = Boolean(await readOidcConfig(getKv(context.locals)));
  } catch (error) {
    console.error("Could not read the OIDC configuration", error);
    const response = pathname.startsWith("/api/")
      ? json({ error: "Authentication configuration is invalid", code: "authentication_configuration_invalid" }, 503)
      : redirectResponse(new URL("/auth/error?code=configuration", context.url));
    return secure(response, pathname, context.request);
  }

  if (!oidcConfigured) {
    context.locals.user = optionalAuthenticationUser();
    return secure(await next(), pathname, context.request);
  }

  let user: AuthUser | undefined;
  try {
    user = await readAuthUser(requireSession(context.session));
  } catch (error) {
    console.error("Could not read the authentication session", error);
    const response = pathname.startsWith("/api/")
      ? json({ error: "Authentication unavailable", code: "authentication_unavailable" }, 503)
      : redirectResponse(new URL("/auth/error?code=configuration", context.url));
    return secure(response, pathname, context.request);
  }

  if (!user) {
    if (pathname.startsWith("/api/")) {
      return secure(json({ error: "Authentication required", code: "unauthorized" }, 401), pathname, context.request);
    }
    const loginUrl = new URL("/auth/login", context.url);
    loginUrl.searchParams.set("returnTo", `${pathname}${context.url.search}`);
    return secure(redirectResponse(loginUrl), pathname, context.request);
  }

  context.locals.user = user;
  return secure(await next(), pathname, context.request);
});
