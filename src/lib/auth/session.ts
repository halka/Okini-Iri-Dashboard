import type { AstroSession } from "astro";
import type { AuthUser, OidcTransaction } from "../../domain/auth";

export const authUserKey = "auth:user";
export const authTransactionKey = "auth:transaction";
export const authIdTokenKey = "auth:id-token";
export const oidcTransactionTtlSeconds = 10 * 60;

export function requireSession(session: AstroSession | undefined): AstroSession {
  if (!session) throw new Error("Astro session storage is unavailable");
  return session;
}

export async function readAuthUser(session: AstroSession) {
  const user = await session.get<AuthUser>(authUserKey);
  // Legacy development/anonymous sessions are not evidence of an OIDC login.
  if (user?.local || user?.issuer === "urn:optional-authentication") return undefined;
  return user;
}

export function readOidcTransaction(session: AstroSession) {
  return session.get<OidcTransaction>(authTransactionKey);
}
