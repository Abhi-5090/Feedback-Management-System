#!/bin/bash
#
# Is what I just pushed actually live — on BOTH halves?
#
# The frontend and the API deploy independently, so "I pushed" does not mean
# "it is running". This once left the API two commits behind a frontend that
# expected its new response fields, with nothing in the UI to say so. One
# command now answers it.
#
#   bash scripts/deploy-status.sh
#   API=https://... WEB=https://... bash scripts/deploy-status.sh
set -u
API="${API:-https://fms-api-dzuv.onrender.com}"
WEB="${WEB:-https://feedback-management-system-jade.vercel.app}"

LOCAL_FULL=$(git rev-parse HEAD 2>/dev/null || echo unknown)
LOCAL=${LOCAL_FULL:0:7}
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)
AHEAD=$(git rev-list --count "@{u}..HEAD" 2>/dev/null || echo '?')

echo "Local"
echo "  branch        : $BRANCH"
echo "  HEAD          : $LOCAL"
if [ "$AHEAD" != "0" ] && [ "$AHEAD" != "?" ]; then
  echo "  ** $AHEAD commit(s) not pushed yet — push before expecting a deploy **"
fi
echo

echo "API (Render)"
# Cold Render instances take ~50s to wake, so allow for it rather than
# reporting a sleeping service as a failed deploy.
API_JSON=$(curl -s -m 120 "$API/api/health" </dev/null)
API_COMMIT=$(echo "$API_JSON" | python3 -c "
import sys,json
try: print((json.load(sys.stdin).get('version') or {}).get('commit','unknown'))
except Exception: print('unreachable')" 2>/dev/null)
echo "  $API"
echo "  running       : $API_COMMIT"

echo
echo "Web (Vercel)"
WEB_HTML=$(curl -s -m 60 "$WEB/" </dev/null)
if echo "$WEB_HTML" | grep -q '<title>'; then
  echo "  $WEB"
  echo "  bundle        : $(echo "$WEB_HTML" | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' | head -1)"
else
  echo "  unreachable"
fi

echo
FAIL=0
if [ "$API_COMMIT" = "$LOCAL" ]; then
  echo "  API  up to date"
elif [ "$API_COMMIT" = "unknown" ]; then
  echo "  API  cannot report its commit — it predates this check, so it is"
  echo "       running OLD code. Redeploy it once and this becomes definitive."
  FAIL=1
else
  echo "  API  BEHIND — running $API_COMMIT, expected $LOCAL"
  echo "       Render dashboard > fms-api > Settings > Build & Deploy >"
  echo "       Auto-Deploy: On.  Or hit Manual Deploy > Deploy latest commit."
  FAIL=1
fi
echo "  Web  compare the bundle hash above with a local \`npm run build\`;"
echo "       Vercel deploys every push automatically."
exit $FAIL
