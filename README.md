# ethos-booker

MCP server for booking gym sessions at Imperial College's Ethos sports centre.

Runs on Cloudflare Workers as a remote MCP server with OAuth authentication. Connect it to Claude, Cursor, or any MCP client and book/cancel gym slots through natural language. You sign in once via a web page -- your credentials never pass through the AI model.

## Tools

| Tool | What it does |
|------|-------------|
| `list_sessions` | Show available sessions for a date, filterable by location |
| `book_session` | Book a free session by date, time, and location |
| `cancel_booking` | Cancel a booking by date and optional time |
| `my_bookings` | List your upcoming bookings |
| `search_sessions` | Search across a date range with time/activity filters |

## Setup

### Claude.ai (web/desktop/mobile)

1. Go to **Settings > Connectors > Add custom connector**
2. Paste the server URL:
   ```
   https://ethos-booker.advitarora2.workers.dev/mcp
   ```
3. Leave OAuth Client ID and Client Secret blank
4. Claude.ai will open a login page in your browser when you first use a tool
5. Sign in with your Imperial Ethos email and password -- this goes directly to Imperial's servers
6. Done. You won't need to log in again until the token expires (30 days)

### Claude Code

```bash
claude mcp add ethos-booker --transport http https://ethos-booker.advitarora2.workers.dev/mcp
```

### Cursor

Settings > Tools & MCP > Add > paste the URL above.

## How it works

The server implements OAuth 2.1 with PKCE via `@cloudflare/workers-oauth-provider`. When a client like Claude.ai connects:

1. The MCP endpoint returns 401 with a `WWW-Authenticate` header
2. The client discovers OAuth endpoints from `/.well-known/oauth-protected-resource`
3. The client opens a browser popup to `/authorize`
4. You enter your Ethos credentials on the login page hosted on the worker
5. The worker authenticates with Imperial's OIDC system, verifies your identity
6. An OAuth token is issued to the client -- your password is never exposed to the AI
7. On subsequent requests, the client sends the Bearer token and the worker re-authenticates with Ethos as needed

### Authentication

The Ethos booking system (Gladstone Leisure Hub) uses an OIDC login flow behind Imperial's identity server. The worker handles the full redirect chain: navigating to the login page, extracting XSRF tokens, posting credentials, and pulling the access token from the OIDC form_post response.

### Booking

Sessions are fetched from the timetable API. Bookings go through the OneClick/Foc endpoint (free-of-charge one-click booking). If a stale basket blocks the OneClick path, the server automatically clears it and retries.

## Deploy your own

```bash
git clone https://github.com/advitrocks9/ethos-booker.git
cd ethos-booker
npm install

# create a KV namespace for OAuth token storage
npx wrangler kv namespace create OAUTH_KV
# update the KV namespace ID in wrangler.jsonc

npx wrangler deploy
```

Requires a Cloudflare account. The free tier is more than enough.

## Constraints

- Max 2 bookings per day
- 6-day advance booking window (opens at midnight)
- Cancel freely before the session starts
- Multiple no-shows within 7 days = 7-day suspension

## Stack

- TypeScript on Cloudflare Workers
- `@cloudflare/workers-oauth-provider` for OAuth 2.1
- `@modelcontextprotocol/sdk` for the MCP protocol layer
- Cloudflare KV for OAuth token persistence
