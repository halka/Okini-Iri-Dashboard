export function safeReturnTo(value: string | null) {
  if (!value || !value.startsWith("/")) return "/";
  try {
    const base = new URL("https://local.invalid/");
    const target = new URL(value, base);
    if (target.origin !== base.origin || target.pathname.startsWith("/auth/")) return "/";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}

export function redirectResponse(location: URL | string, status = 302) {
  return new Response(null, {
    status,
    headers: {
      "cache-control": "no-store",
      location: location.toString()
    }
  });
}

export function authErrorUrl(origin: string, code: string) {
  const url = new URL("/auth/error", origin);
  url.searchParams.set("code", code);
  return url;
}
