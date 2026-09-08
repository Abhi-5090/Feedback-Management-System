#!/bin/bash
#
# End-to-end smoke test against a RUNNING deployment.
#
# Checks the things a unit test cannot: that the process is actually serving,
# the database is reachable from it, every surface answers, exports produce real
# file bytes, and role boundaries hold across the wire. Run it after any deploy
# — it is the difference between "it built" and "it works".
#
#   bash scripts/smoke-test.sh                      # defaults below
#   API=https://feedback.example.edu bash scripts/smoke-test.sh
#
# Exits non-zero if anything fails, so CI or a deploy script can gate on it.
set -u
API="${API:-http://localhost:5555}"
WEB="${WEB:-http://localhost:5173}"
ADMIN_EMAIL="${ADMIN_EMAIL:-fms@admin.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-FMS@Admin}"
MENTOR_EMAIL="${MENTOR_EMAIL:-}"
MENTOR_PASSWORD="${MENTOR_PASSWORD:-}"
echo "Target API: $API"
echo "Target web: $WEB"
echo
pass=0; fail=0
chk() { # name, expected, actual
  if [ "$2" = "$3" ]; then printf "  ✓ %-52s %s\n" "$1" "$3"; pass=$((pass+1));
  else printf "  ✗ %-52s got %s, expected %s\n" "$1" "$3" "$2"; fail=$((fail+1)); fi
}
code() { curl -s -o /tmp/s.json -w "%{http_code}" "$@"; }

echo "════ INFRASTRUCTURE ════"
chk "health"            200 "$(code $API/api/health)"
chk "readiness (db reachable)" 200 "$(code $API/api/ready)"
chk "unknown route 404" 404 "$(code $API/api/nope)"

echo
echo "════ AUTH ════"
AT=$(curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))")
[ -n "$AT" ] && { echo "  ✓ admin login"; pass=$((pass+1)); } || { echo "  ✗ admin login"; fail=$((fail+1)); }
chk "unauthenticated /me rejected" 401 "$(code $API/api/auth/me)"
chk "system status (admin)" 200 "$(code -H "Authorization: Bearer $AT" $API/api/auth/system)"

echo
echo "════ ADMIN SURFACE ════"
for p in "/api/trainers?limit=5" "/api/classes?limit=5" "/api/batches?limit=5" "/api/parameters" "/api/audit?limit=5"; do
  chk "GET $p" 200 "$(code -H "Authorization: Bearer $AT" "$API$p")"
done

echo
echo "════ ANALYTICS ════"
for p in "/api/dashboard/admin" "/api/analytics/classes" "/api/analytics/trainers" "/api/analytics/cohorts" "/api/analytics/mentor-load" "/api/analytics/themes" "/api/analytics/deltas"; do
  chk "GET $p" 200 "$(code -H "Authorization: Bearer $AT" "$API$p")"
done

echo
echo "════ EXPORTS ════"
chk "dashboard xlsx" 200 "$(code -H "Authorization: Bearer $AT" "$API/api/export/dashboard/admin?format=xlsx")"
head -c2 /tmp/s.json | grep -q PK && { echo "  ✓ xlsx magic bytes (PK)"; pass=$((pass+1)); } || { echo "  ✗ xlsx bytes"; fail=$((fail+1)); }
chk "dashboard pdf"  200 "$(code -H "Authorization: Bearer $AT" "$API/api/export/dashboard/admin?format=pdf")"
head -c4 /tmp/s.json | grep -q "%PDF" && { echo "  ✓ pdf magic bytes (%PDF)"; pass=$((pass+1)); } || { echo "  ✗ pdf bytes"; fail=$((fail+1)); }
chk "mentor matrix xlsx" 200 "$(code -H "Authorization: Bearer $AT" "$API/api/export/mentors?format=xlsx")"
chk "bad format rejected" 400 "$(code -H "Authorization: Bearer $AT" "$API/api/export/dashboard/admin?format=exe")"

echo
echo "════ MENTOR ROLE SCOPING ════"
if [ -n "$MENTOR_EMAIL" ] && [ -n "$MENTOR_PASSWORD" ]; then
  MT=$(curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' \
    -d "{\"email\":\"$MENTOR_EMAIL\",\"password\":\"$MENTOR_PASSWORD\"}" \
    | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))")
  # A mentor still on the admin-issued password is held at the change-password
  # gate, so 403 here is the CORRECT answer, not a failure.
  chk "mentor cannot reach admin dashboard"  403 "$(code -H "Authorization: Bearer $MT" $API/api/dashboard/admin)"
  chk "mentor cannot list trainers"          403 "$(code -H "Authorization: Bearer $MT" $API/api/trainers)"
else
  echo "  – skipped (set MENTOR_EMAIL and MENTOR_PASSWORD to include these)"
fi

echo
echo "════ FRONTEND ════"
if curl -s -o /dev/null -m 3 "$WEB/login" 2>/dev/null; then
  chk "SPA /login"                200 "$(code $WEB/login)"
  chk "SPA reaches API via proxy" 200 "$(code $WEB/api/health)"
else
  echo "  – skipped (no web server at $WEB)"
fi

echo
echo "═════════════════════════════════════════"
echo "  PASSED $pass   FAILED $fail"
echo "═════════════════════════════════════════"
[ "$fail" -eq 0 ] || exit 1
