export type AuthUser = {
  subject: string;
  issuer: string;
  name: string;
  email: string | null;
  preferredUsername: string | null;
  local: boolean;
};

export type OidcTransaction = {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
  createdAt: number;
};
