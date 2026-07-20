import { defineMiddleware } from "astro:middleware";
import type { AuthUser } from "./domain/auth";
import { redirectResponse } from "./lib/auth/http";
import { readAuthUser, requireSession } from "./lib/auth/session";
import { json } from "./lib/http";

const publicRoutes = new Set(["/auth/login", "/auth/callback", "/auth/error", "/auth/signed-out"]);

function isPublicPath(pathname: string) {
  return publicRoutes.has(pathname) || pathname === "/favicon.svg" || pathname.startsWith("/_astro/");
}

function isUnsafeCrossOriginRequest(request: Request, origin: string) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return false;
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin && requestOrigin !== origin) return true;
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === "cross-site";
}

function secure(response: Response, pathname: string) {
  const headers = new Headers(response.headers);
  headers.set("referrer-policy", "same-origin");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("permissions-policy", "camera=(), geolocation=(), microphone=()");
  if (pathname.startsWith("/auth/")) headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  if (isPublicPath(pathname)) return secure(await next(), pathname);

  if (isUnsafeCrossOriginRequest(context.request, context.url.origin)) {
    return pathname.startsWith("/api/")
      ? json({ error: "Cross-origin request rejected", code: "forbidden" }, 403)
      : new Response("Forbidden", { status: 403 });
  }

  let user: AuthUser | undefined;
  try {
    user = await readAuthUser(requireSession(context.session));
  } catch (error) {
    console.error("Could not read the authentication session", error);
    return pathname.startsWith("/api/")
      ? json({ error: "Authentication unavailable", code: "authentication_unavailable" }, 503)
      : redirectResponse(new URL("/auth/error?code=configuration", context.url));
  }

  if (!user) {
    if (pathname.startsWith("/api/")) {
      return json({ error: "Authentication required", code: "unauthorized" }, 401);
    }
    const loginUrl = new URL("/auth/login", context.url);
    loginUrl.searchParams.set("returnTo", `${pathname}${context.url.search}`);
    return redirectResponse(loginUrl);
  }

  context.locals.user = user;
  return secure(await next(), pathname);
});
