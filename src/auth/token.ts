import type { IncomingMessage } from "node:http";

import type { OAuthStore, TokenRecord } from "./oauth-store.js";
import { UnauthorizedError } from "../util/errors.js";

export async function requireBearerToken(
  request: IncomingMessage,
  store: OAuthStore,
): Promise<TokenRecord> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new UnauthorizedError();
  const accessToken = header.slice("Bearer ".length);
  const record = store.getToken(accessToken);
  if (!record) throw new UnauthorizedError("Invalid or expired token");
  return record;
}
