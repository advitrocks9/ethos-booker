import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp";
import type { Env } from "./types";
import { createServer } from "./mcp-server";
import { authHandler } from "./auth-handler";

const mcpHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const { success } = await env.API_LIMITER.limit({ key: ip });
    if (!success) return new Response("Rate limit exceeded", { status: 429 });

    const server = createServer(env);
    return createMcpHandler(server)(request, env, ctx);
  },
};

export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: mcpHandler,
  defaultHandler: authHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  scopesSupported: ["ethos"],
  accessTokenTTL: 86400, // 24h — Ethos session is cached server-side and refreshed independently
  refreshTokenTTL: 2592000, // 30d
});
