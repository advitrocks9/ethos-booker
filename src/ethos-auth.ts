import type { AuthResult } from "./types";
import { ethosBaseUrl, parseFormField, decodeAndValidateJwt } from "./utils";

class CookieJar {
  private cookies = new Map<string, string>();

  capture(response: Response): void {
    const headers = response.headers as Headers & {
      getAll?: (name: string) => string[];
      getSetCookie?: () => string[];
    };
    let setCookies: string[] =
      headers.getAll?.("set-cookie") ?? headers.getSetCookie?.() ?? [];
    if (setCookies.length === 0) {
      const single = response.headers.get("set-cookie");
      if (single) setCookies.push(single);
    }
    for (const raw of setCookies) {
      const parts = raw.split(";")[0];
      if (!parts) continue;
      const eq = parts.indexOf("=");
      if (eq === -1) continue;
      const name = parts.slice(0, eq).trim();
      const value = parts.slice(eq + 1).trim();
      this.cookies.set(name, value);
    }
  }

  header(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  get size(): number {
    return this.cookies.size;
  }
}

async function followRedirects(
  url: string,
  jar: CookieJar,
  init?: RequestInit,
  maxRedirects = 15
): Promise<{ response: Response; finalUrl: string }> {
  let currentUrl = url;
  let currentInit: RequestInit = { ...init, redirect: "manual" };
  const cookieHeader = jar.header();
  if (cookieHeader) {
    currentInit.headers = { ...Object.fromEntries(new Headers(currentInit.headers as HeadersInit).entries()), Cookie: cookieHeader };
  }

  for (let i = 0; i < maxRedirects; i++) {
    const response = await fetch(currentUrl, currentInit);
    jar.capture(response);

    const status = response.status;
    if (status >= 300 && status < 400) {
      const location = response.headers.get("location");
      if (!location) return { response, finalUrl: currentUrl };

      currentUrl = location.startsWith("http")
        ? location
        : new URL(location, currentUrl).toString();

      currentInit = {
        redirect: "manual",
        headers: { Cookie: jar.header() },
      };
      continue;
    }

    return { response, finalUrl: currentUrl };
  }

  throw new Error("Too many redirects");
}

// OIDC flow: Members/Home -> login redirect -> POST creds -> extract access_token
export async function authenticate(
  email: string,
  password: string
): Promise<AuthResult> {
  const base = ethosBaseUrl();
  const jar = new CookieJar();

  const { response: loginPageRes, finalUrl: loginUrl } = await followRedirects(
    `${base}/en/Members/Home`,
    jar
  );

  if (!loginUrl.includes("/identity/login")) {
    console.error(`Auth flow error: expected login page, got: ${loginUrl}`);
    throw new Error("Ethos login page unavailable — try again later");
  }

  const loginHtml = await loginPageRes.text();
  const xsrf = parseFormField(loginHtml, "idsrv.xsrf");
  if (!xsrf) {
    throw new Error("Could not find XSRF token on login page");
  }

  const formBody = new URLSearchParams({
    "idsrv.xsrf": xsrf,
    Username: email,
    Password: password,
    RememberMe: "true",
  });

  const { response: postRes, finalUrl: postFinalUrl } = await followRedirects(
    loginUrl,
    jar,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: jar.header(),
      },
      body: formBody.toString(),
    }
  );

  const responseHtml = await postRes.text();
  let accessToken = parseFormField(responseHtml, "access_token");

  if (!accessToken) {
    accessToken = parseFormField(responseHtml, "id_token");
  }

  if (!accessToken) {
    if (postFinalUrl.includes("/identity/login")) {
      throw new Error("Login failed - check email and password");
    }
    if (postFinalUrl.includes("/Members/Home")) {
      // token sometimes embedded in page JS rather than a form field
      const tokenMatch = responseHtml.match(/access_token["']?\s*[:=]\s*["']([^"']+)["']/);
      if (tokenMatch?.[1]) {
        accessToken = tokenMatch[1];
      }
    }
  }

  if (!accessToken) {
    console.error(
      `Token extraction failed. Final URL: ${postFinalUrl}. ` +
      `Response length: ${responseHtml.length}. ` +
      `Has form fields: ${responseHtml.includes("<input")}`
    );
    throw new Error("Authentication succeeded but failed to extract session token — try again");
  }

  const claims = decodeAndValidateJwt(accessToken);
  const personId = Number(claims.dimension_person_pk ?? claims.sub);
  const memberNo = Number(claims.member_id ?? 0);

  if (!personId || isNaN(personId)) {
    const userinfoRes = await fetch(
      `${base}/identity/connect/userinfo`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (userinfoRes.ok) {
      const userinfo = (await userinfoRes.json()) as Record<string, unknown>;
      const pid = Number(userinfo.dimension_person_pk ?? userinfo.sub);
      return {
        accessToken,
        personId: pid,
        memberNo: Number(userinfo.member_id ?? memberNo),
        cookies: jar.header(),
      };
    }
    console.error("Could not determine personId from token claims or userinfo endpoint");
    throw new Error("Authentication failed — unable to identify user account");
  }

  return { accessToken, personId, memberNo, cookies: jar.header() };
}
