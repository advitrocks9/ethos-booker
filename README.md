# ethos-booker

MCP server for booking gym sessions at Imperial College's Ethos sports centre.

Runs on Cloudflare Workers. Single-user: deploy your own instance, store your Imperial credentials as Wrangler secrets, and connect from claude.ai (web/desktop/mobile), Claude Code, or any MCP client. New devices connect with one click — no login form, no re-typing credentials.

## Tools

| Tool | What it does |
|------|-------------|
| `list_sessions` | Show available sessions for a date, filterable by location |
| `book_session` | Book a free session by date, time, and location |
| `cancel_booking` | Cancel a booking by date and optional time |
| `my_bookings` | List your upcoming bookings |
| `search_sessions` | Search across a date range with time/activity filters |

## Connect to your deployed instance

Once you've deployed (see below), the same URL works on every device — paste it once per client, click Connect, done.

### Claude.ai (web / desktop / mobile)

1. **Settings → Connectors → Add custom connector**
2. Paste your worker URL (the one ending in `/mcp`):
   ```
   https://ethos-booker.<your-subdomain>.workers.dev/mcp
   ```
3. Leave OAuth Client ID and Client Secret blank
4. Click Connect — claude.ai opens a brief redirect (no form), grants access, done
5. The connection lasts 30 days; renewal is silent

### Claude Code

```bash
claude mcp add ethos-booker --transport http https://ethos-booker.<your-subdomain>.workers.dev/mcp
```

### Cursor

Settings → Tools & MCP → Add → paste the URL.

## Deploy your own instance

```bash
git clone https://github.com/advitrocks9/ethos-booker.git
cd ethos-booker
npm install

# create a KV namespace and put its id into wrangler.jsonc
npx wrangler kv namespace create OAUTH_KV

# store your Imperial credentials as encrypted secrets (one-time)
npx wrangler secret put ETHOS_EMAIL
npx wrangler secret put ETHOS_PASSWORD

npx wrangler deploy
```

Wrangler will print the worker URL — append `/mcp` and use it as your connector URL.

For local development, copy `.dev.vars.example` to `.dev.vars` and fill in real credentials. `.dev.vars` is gitignored.

## How auth works

The server holds your Ethos credentials as Wrangler secrets and authenticates with Imperial on your behalf. The OAuth dance between claude.ai and the worker is preserved (so each client gets a proper refresh token), but `/authorize` auto-completes — no login page is ever shown.

Concretely, on first connect from a new device:

1. claude.ai discovers OAuth endpoints from `/.well-known/oauth-protected-resource`
2. Opens `/authorize` in a popup
3. The worker verifies it can log into Ethos with the stored secrets, then immediately calls `completeAuthorization` and redirects back
4. claude.ai exchanges the code for an access token (24h) + refresh token (30d)
5. Subsequent tool calls hit `/mcp` with the bearer token

The actual Ethos session (JWT + cookies) is cached in KV under `ethos:session:v1` and refreshed lazily based on the JWT `exp` claim — independent of the OAuth token lifetime, so booking calls don't fail when the OAuth token rotates.

If a booking fails because Ethos returned HTML or a 401-style error, the cached session is invalidated and the worker re-authenticates once before giving up.

## Constraints

- Max 2 bookings per day
- 6-day advance booking window (opens at midnight)
- Cancel freely before the session starts
- Multiple no-shows within 7 days = 7-day suspension

## Stack

- TypeScript on Cloudflare Workers
- `@cloudflare/workers-oauth-provider` for OAuth 2.1 (auto-approve mode)
- `@modelcontextprotocol/sdk` for the MCP protocol layer
- Cloudflare KV for OAuth state and Ethos session cache
