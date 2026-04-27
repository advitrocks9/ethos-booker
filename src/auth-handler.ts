import type { Env } from "./types";
import { resolveEthosSession } from "./session";

const FIXED_USER_ID = "ethos-owner";

function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

// Single-user MCP: server owns the Ethos credentials, so /authorize
// auto-completes without prompting. The OAuth dance still happens (so claude.ai
// gets per-device refresh tokens), but the user never sees a login form.
export const authHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== "/authorize") {
      return new Response("Not found", { status: 404 });
    }

    if (request.method !== "GET" && request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const ip = clientIp(request);
    const { success } = await env.AUTH_LIMITER.limit({ key: ip });
    if (!success) {
      return new Response("Too many authorization attempts", { status: 429 });
    }

    // Verify the server can actually log into Ethos before issuing an OAuth
    // grant. Otherwise the client gets a token that fails on every tool call.
    try {
      await resolveEthosSession(env);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Authentication failed";
      console.error(`Ethos preflight failed: ${msg}`);
      return new Response(
        `Server cannot authenticate with Ethos: ${msg}`,
        { status: 502 }
      );
    }

    const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);

    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: oauthReqInfo,
      userId: FIXED_USER_ID,
      scope: ["ethos"],
      metadata: {
        label: "Ethos Booker",
        userAgent: request.headers.get("User-Agent") ?? "",
      },
      // Session is resolved per-tool-call from KV, not stored in props.
      props: {},
    });

    return Response.redirect(redirectTo, 302);
  },
};
