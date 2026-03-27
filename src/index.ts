import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp";
import { createServer } from "./mcp-server";
import { authHandler } from "./auth-handler";

const mcpHandler = {
  async fetch(request: Request, env: unknown, ctx: ExecutionContext) {
    const server = createServer();
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
  accessTokenTTL: 86400, // 24 hours - re-authenticates with Ethos on each new session anyway
  refreshTokenTTL: 2592000, // 30 days
});
