const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const maxRedirects = 5;

export class UnsafeRemoteUrlError extends Error {}

export type RemoteFetchOptions = {
  blockedOrigins?: ReadonlySet<string>;
};

export function publicHttpUrl(value: string | URL, options: RemoteFetchOptions = {}) {
  const url = typeof value === "string" ? new URL(value) : new URL(value.href);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new UnsafeRemoteUrlError("Only http and https URLs can be fetched");
  }
  if (url.username || url.password) {
    throw new UnsafeRemoteUrlError("URLs with credentials cannot be fetched");
  }
  if ([...(options.blockedOrigins ?? [])].some((origin) => origin.toLowerCase() === url.origin.toLowerCase())) {
    throw new UnsafeRemoteUrlError("The application origin cannot be fetched");
  }

  return url;
}

export async function fetchPublicUrl(input: string | URL, init: RequestInit = {}, options: RemoteFetchOptions = {}) {
  let url = publicHttpUrl(input, options);

  for (let redirect = 0; ; redirect += 1) {
    const response = await fetch(url.href, {
      ...init,
      cache: "no-store",
      redirect: "manual"
    });
    if (!redirectStatuses.has(response.status)) return response;
    if (redirect >= maxRedirects) throw new UnsafeRemoteUrlError("Too many redirects");

    const location = response.headers.get("location");
    if (!location) throw new UnsafeRemoteUrlError("Redirect response did not include a location");
    url = publicHttpUrl(new URL(location, url), options);
  }
}
