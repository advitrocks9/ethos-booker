import type { AuthResult, Env } from "./types";
import { authenticate } from "./ethos-auth";
import { decodeAndValidateJwt } from "./utils";

interface CachedSession extends AuthResult {
  expiresAt: number;
}

const KEY = "ethos:session:v1";
// refresh slightly before the JWT actually expires
const REFRESH_MARGIN_MS = 60_000;
// floor for cases where exp is missing/unreadable
const FALLBACK_TTL_MS = 50 * 60 * 1000;

export async function resolveEthosSession(env: Env): Promise<AuthResult> {
  if (!env.ETHOS_EMAIL || !env.ETHOS_PASSWORD) {
    throw new Error(
      "Server not configured: set ETHOS_EMAIL and ETHOS_PASSWORD as Wrangler secrets."
    );
  }

  const cached = await env.OAUTH_KV.get<CachedSession>(KEY, "json");
  if (cached && cached.expiresAt > Date.now() + REFRESH_MARGIN_MS) {
    return cached;
  }

  const fresh = await authenticate(env.ETHOS_EMAIL, env.ETHOS_PASSWORD);
  let expiresAt: number;
  try {
    const claims = decodeAndValidateJwt(fresh.accessToken);
    expiresAt =
      typeof claims.exp === "number"
        ? claims.exp * 1000
        : Date.now() + FALLBACK_TTL_MS;
  } catch {
    expiresAt = Date.now() + FALLBACK_TTL_MS;
  }

  const session: CachedSession = { ...fresh, expiresAt };
  const ttlSec = Math.max(60, Math.floor((expiresAt - Date.now()) / 1000));
  await env.OAUTH_KV.put(KEY, JSON.stringify(session), {
    expirationTtl: ttlSec,
  });
  return session;
}

export async function invalidateEthosSession(env: Env): Promise<void> {
  await env.OAUTH_KV.delete(KEY);
}
