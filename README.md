# ethos-booker (manual login)

> This is the **manual login** branch. You authenticate by telling the AI your credentials once per session. For the OAuth version (one-time browser login, credentials never touch the AI), see the [`main`](https://github.com/advitrocks9/ethos-booker/tree/main) branch.

MCP server for booking gym sessions at Imperial College's Ethos sports centre. Runs on Cloudflare Workers with Durable Objects for stateful sessions.

## Tools

| Tool | What it does |
|------|-------------|
| `login` | Authenticate with your Ethos email and password |
| `list_sessions` | Show available sessions for a date, filterable by location |
| `book_session` | Book a free session by date, time, and location |
| `cancel_booking` | Cancel a booking by date and optional time |
| `my_bookings` | List your upcoming bookings |
| `search_sessions` | Search across a date range with time/activity filters |

## Setup

### Claude Code

```bash
claude mcp add ethos-booker --transport http https://ethos-booker.advitarora2.workers.dev/mcp
```

Then in a conversation: "log in to Ethos with my email advit@imperial.ac.uk and password xyz". The token is cached in the Durable Object for the rest of the session.

### Cursor

Settings > Tools & MCP > Add > paste:
```
https://ethos-booker.advitarora2.workers.dev/mcp
```

### Claude.ai

Works, but your credentials pass through the AI model in plaintext. If you care about that, use the [OAuth version on `main`](https://github.com/advitrocks9/ethos-booker/tree/main) instead.

Settings > Connectors > Add custom connector > paste the URL above. Leave OAuth fields blank.

## Trade-offs vs the OAuth version

| | This branch (`manual`) | `main` (OAuth) |
|---|---|---|
| Auth flow | Tell the AI your credentials | Browser popup, one-time login |
| Credentials touch AI? | Yes | No |
| Session state | Durable Object (cached token) | Stateless (re-authenticates per call) |
| Speed | Fast (token cached across tool calls) | Slower (OIDC login on first call per session) |
| Best for | Claude Code, Cursor, devs | Claude.ai, non-technical users |

## Deploy your own

```bash
git clone -b manual https://github.com/advitrocks9/ethos-booker.git
cd ethos-booker
npm install
npx wrangler deploy
```

Requires a Cloudflare account. Free tier is more than enough.

## How it works

The Ethos booking system (Gladstone Leisure Hub) exposes a REST API behind an OIDC login. This server handles the full auth flow -- navigating the redirect chain, extracting XSRF tokens, posting credentials, and pulling the access token from the OIDC form_post response.

Once authenticated, sessions are fetched from the timetable API and bookings go through the OneClick/Foc endpoint (free-of-charge one-click booking). If a stale basket blocks the OneClick path, the server automatically clears it and retries.

Session state (auth token, cookies) is held in a Cloudflare Durable Object, so each MCP session gets its own isolated state and the Ethos token is reused across tool calls.

## Constraints

- Max 2 bookings per day
- 6-day advance booking window (opens at midnight)
- Cancel freely before the session starts
- Multiple no-shows within 7 days = 7-day suspension

## Stack

- TypeScript on Cloudflare Workers
- Cloudflare Agents SDK (`McpAgent` + Durable Objects)
- `@modelcontextprotocol/sdk` for the MCP protocol layer
