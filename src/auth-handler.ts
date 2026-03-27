import type { Env } from "./types";
import { authenticate } from "./ethos-auth";

function loginPage(oauthRequest: string, error?: string): Response {
  const errorHtml = error
    ? `<p style="color:#c0392b;margin-bottom:16px">${error}</p>`
    : "";

  // escape for safe embedding in HTML attribute
  const escaped = oauthRequest.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Ethos Booker - Login</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,.1); padding: 32px; width: 100%; max-width: 400px; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    .sub { color: #666; font-size: 14px; margin-bottom: 24px; }
    label { display: block; font-size: 14px; font-weight: 500; margin-bottom: 4px; }
    input[type=email], input[type=password] { width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; margin-bottom: 16px; }
    button { width: 100%; padding: 10px; background: #002147; color: #fff; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; }
    button:hover { background: #003366; }
    .note { margin-top: 16px; font-size: 12px; color: #999; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Ethos Booker</h1>
    <p class="sub">Sign in with your Imperial Ethos account</p>
    ${errorHtml}
    <form method="POST" action="/authorize">
      <input type="hidden" name="oauth_request" value="${escaped}">
      <label for="email">Email</label>
      <input type="email" id="email" name="email" placeholder="name@imperial.ac.uk" required>
      <label for="password">Password</label>
      <input type="password" id="password" name="password" required>
      <button type="submit">Sign in</button>
    </form>
    <p class="note">Your credentials go directly to Imperial's servers. They are not stored in plaintext or shared with the AI model.</p>
  </div>
</body>
</html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}

export const authHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/authorize" && request.method === "GET") {
      // OAuthProvider forwards the original authorize request here after validation.
      // capture all query params as a JSON blob to round-trip through the form.
      const oauthParams = Object.fromEntries(url.searchParams.entries());
      return loginPage(JSON.stringify(oauthParams));
    }

    if (url.pathname === "/authorize" && request.method === "POST") {
      const formData = await request.formData();
      const oauthRequestRaw = formData.get("oauth_request") as string;
      const email = formData.get("email") as string;
      const password = formData.get("password") as string;

      if (!email || !password || !oauthRequestRaw) {
        return loginPage(oauthRequestRaw ?? "{}", "Please fill in all fields.");
      }

      let params: Record<string, string>;
      try {
        params = JSON.parse(oauthRequestRaw);
      } catch {
        return loginPage("{}", "Invalid request state. Please try reconnecting.");
      }

      let authResult;
      try {
        authResult = await authenticate(email, password);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Authentication failed";
        return loginPage(oauthRequestRaw, msg);
      }

      // completeAuthorization expects camelCase field names
      const oauthRequest = {
        clientId: params.client_id,
        redirectUri: params.redirect_uri,
        responseType: params.response_type,
        codeChallenge: params.code_challenge,
        codeChallengeMethod: params.code_challenge_method,
        state: params.state,
        scope: params.scope,
        resource: params.resource,
      };

      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthRequest,
        userId: String(authResult.personId),
        scope: params.scope?.split(" ") ?? ["ethos"],
        props: {
          email,
          password,
          personId: authResult.personId,
          memberNo: authResult.memberNo,
        },
      });

      return Response.redirect(redirectTo, 302);
    }

    return new Response("Not found", { status: 404 });
  },
};
