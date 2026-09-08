#!/usr/bin/env bash
#
# Fails if a real credential appears in a TRACKED file.
#
# This exists because a live MongoDB Atlas URI — username and password — was
# committed in FMS_Backend/.env.example and stayed in the repository's history.
# .env itself was correctly ignored; the leak came through the template that is
# meant to be committed, which is exactly the file nobody thinks to check.
#
# Written for bash 3.2 (the /bin/bash macOS ships) — no mapfile, no readarray.
#
# Run locally:  bash scripts/check-secrets.sh
set -uo pipefail

fail=0
note() { printf '  %s\n' "$1"; }

# Patterns that should never appear in a tracked file. Each is a credential
# WITH a secret in it — not merely a hostname, so documenting
# "mongodb+srv://<user>:<password>@<cluster>" in a comment stays allowed.
patterns='mongodb(\+srv)?://[^/[:space:]]+:[^@[:space:]]+@
AKIA[0-9A-Z]{16}
sk-[A-Za-z0-9]{32,}
ghp_[A-Za-z0-9]{36}
-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'

filelist="$(mktemp)"
trap 'rm -f "$filelist"' EXIT
git ls-files -z > "$filelist"

count=$(tr -cd '\0' < "$filelist" | wc -c | tr -d ' ')
echo "Scanning $count tracked files for credentials…"
if [ "$count" -eq 0 ]; then
  echo "FAIL: no tracked files found — is this a git repository?"
  exit 1
fi

while IFS= read -r pattern; do
  [ -n "$pattern" ] || continue
  # Placeholders are fine: <password>, ${VAR}, change_me, xxxx, ***, REDACTED.
  hits=$(xargs -0 grep -InE -- "$pattern" < "$filelist" 2>/dev/null \
    | grep -vE '<[A-Za-z_]+>|\$\{|change_me|placeholder|example\.com|xxxx|\*\*\*|REDACTED|NEW_PASSWORD' \
    || true)
  if [ -n "$hits" ]; then
    echo ""
    echo "FAIL: credential-shaped string in a tracked file"
    note "pattern: $pattern"
    printf '%s\n' "$hits" | while IFS= read -r line; do note "$line"; done
    fail=1
  fi
done <<EOF
$patterns
EOF

# .env must never be tracked, whatever the suffix. Only .env.example may be.
tracked_env=$(git ls-files | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$' || true)
if [ -n "$tracked_env" ]; then
  echo ""
  echo "FAIL: an environment file is tracked (only .env.example may be)"
  printf '%s\n' "$tracked_env" | while IFS= read -r line; do note "$line"; done
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "OK — no credentials found in tracked files."
fi
exit "$fail"
