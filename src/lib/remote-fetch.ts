const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const maxRedirects = 3;
const blockedHostSuffixes = [".localhost", ".local", ".internal", ".home.arpa", ".nip.io", ".sslip.io", ".xip.io"];

export class UnsafeRemoteUrlError extends Error {}

export type RemoteFetchOptions = {
  blockedOrigins?: ReadonlySet<string>;
};

export function publicHttpUrl(value: string | URL, options: RemoteFetchOptions = {}) {
  const url = typeof value === "string" ? new URL(value) : new URL(value.href);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new UnsafeRemoteUrlError("Only http and https URLs can be fetched");
  }
  if (url.username || url.password) {
    throw new UnsafeRemoteUrlError("URLs with credentials cannot be fetched");
  }
  if (url.port && !['80', '443'].includes(url.port)) {
    throw new UnsafeRemoteUrlError("Only standard HTTP ports can be fetched");
  }
  if (isBlockedHostname(hostname)) {
    throw new UnsafeRemoteUrlError("Private or local network URLs cannot be fetched");
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

function isBlockedHostname(hostname: string) {
  if (!hostname || hostname === "localhost" || hostname.includes(":")) return true;
  if (blockedHostSuffixes.some((suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix))) return true;
  if (!hostname.includes(".")) return true;

  const ipv4 = hostname.split(".");
  if (ipv4.length !== 4 || ipv4.some((part) => !/^\d+$/.test(part))) return false;
  const octets = ipv4.map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return true;
  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 0) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51) ||
    (first === 203 && second === 0) ||
    first >= 224
  );
}
