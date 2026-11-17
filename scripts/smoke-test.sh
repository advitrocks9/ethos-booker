#!/bin/bash
# End-to-end smoke test: OAuth (DCR + PKCE) exactly as an MCP client does it,
# then read-only MCP calls. Needs curl and python3.
#
#   scripts/smoke-test.sh http://127.0.0.1:8787            # against `wrangler dev`
#   scripts/smoke-test.sh https://<worker>.workers.dev     # against a deploy
#
# Optional real booking round-trip (books, then cancels straight away):
#   BOOK_TIME=21:00 BOOK_LOCATION=pool BOOK_DAYS_AHEAD=2 scripts/smoke-test.sh <url>
set -euo pipefail
BASE="${1:-http://127.0.0.1:8787}"
REDIRECT="http://localhost:9999/cb"
BOOK_LOCATION="${BOOK_LOCATION:-gym}"
BOOK_DAYS_AHEAD="${BOOK_DAYS_AHEAD:-1}"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "== metadata"
curl -sf "$BASE/.well-known/oauth-authorization-server" | head -c 300; echo

echo "== register client"
CID=$(curl -sf -X POST "$BASE/oauth/register" -H 'Content-Type: application/json' \
  -d "{\"redirect_uris\":[\"$REDIRECT\"],\"client_name\":\"e2e\",\"token_endpoint_auth_method\":\"none\"}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["client_id"])')
echo "client_id=$CID"

VERIFIER=$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))')
CHALLENGE=$(python3 -c "import hashlib,base64,sys;print(base64.urlsafe_b64encode(hashlib.sha256(sys.argv[1].encode()).digest()).rstrip(b'=').decode())" "$VERIFIER")

echo "== authorize (server logs into Ethos here)"
AUTH_URL="$BASE/authorize?response_type=code&client_id=$CID&redirect_uri=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$REDIRECT")&code_challenge=$CHALLENGE&code_challenge_method=S256&scope=ethos&state=xyz"
HDRS=$(curl -s -D - -o "$WORK/auth_body" "$AUTH_URL")
STATUS=$(echo "$HDRS" | head -1)
echo "$STATUS"
LOC=$(echo "$HDRS" | grep -i '^location:' | tr -d '\r' | cut -d' ' -f2-)
if [ -z "$LOC" ]; then echo "no redirect; body:"; head -c 500 "$WORK/auth_body"; echo; exit 1; fi
CODE=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.parse_qs(urllib.parse.urlparse(sys.argv[1]).query)["code"][0])' "$LOC")
echo "got auth code"

echo "== token"
TOKEN=$(curl -sf -X POST "$BASE/oauth/token" \
  --data-urlencode grant_type=authorization_code --data-urlencode "code=$CODE" \
  --data-urlencode "redirect_uri=$REDIRECT" --data-urlencode "client_id=$CID" \
  --data-urlencode "code_verifier=$VERIFIER" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["access_token"])')
echo "got access token"

mcp() {
  curl -s -X POST "$BASE/mcp" -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d "$1" \
    | sed -n 's/^data: //; /^{/p' | python3 -c '
import sys,json
for line in sys.stdin:
    line=line.strip()
    if not line: continue
    d=json.loads(line)
    r=d.get("result",d.get("error"))
    if isinstance(r,dict) and "content" in r:
        for c in r["content"]: print(c.get("text"))
    elif isinstance(r,dict) and "tools" in r:
        print("tools:", ", ".join(t["name"] for t in r["tools"]))
    else: print(json.dumps(r)[:400])'
}

echo "== initialize"
mcp '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"e2e","version":"1"}}}'
echo "== tools/list"
mcp '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
echo "== my_bookings"
mcp '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"my_bookings","arguments":{}}}'
DAY=$(python3 -c 'import datetime,sys;print(datetime.date.today()+datetime.timedelta(days=int(sys.argv[1])))' "$BOOK_DAYS_AHEAD")
echo "== list_sessions $BOOK_LOCATION $DAY"
mcp "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"list_sessions\",\"arguments\":{\"date\":\"$DAY\",\"location\":\"$BOOK_LOCATION\",\"available_only\":true}}}"

if [ -n "${BOOK_TIME:-}" ]; then
  echo "== book_session $BOOK_LOCATION $DAY $BOOK_TIME"
  mcp "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"book_session\",\"arguments\":{\"date\":\"$DAY\",\"time\":\"$BOOK_TIME\",\"location\":\"$BOOK_LOCATION\"}}}"
  echo "== my_bookings (after booking)"
  mcp '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"my_bookings","arguments":{}}}'
  echo "== cancel_booking $DAY $BOOK_TIME"
  mcp "{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"tools/call\",\"params\":{\"name\":\"cancel_booking\",\"arguments\":{\"date\":\"$DAY\",\"time\":\"$BOOK_TIME\"}}}"
  echo "== my_bookings (after cancel)"
  mcp '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"my_bookings","arguments":{}}}'
fi
