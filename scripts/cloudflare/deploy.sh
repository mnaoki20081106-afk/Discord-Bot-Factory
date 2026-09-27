#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="${1:?source root required}"
WORKING_DIRECTORY="${2:-.}"
BOT_NAME="${3:?bot name required}"
WRANGLER_CONFIG="${4:-auto}"
HEALTH_URL="${5:-}"
WORKDIR="$SOURCE_ROOT/$WORKING_DIRECTORY"

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"

if [[ ! "$BOT_NAME" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]]; then
  echo "::error::bot_name must match ^[a-z0-9][a-z0-9-]{0,62}$"
  exit 1
fi

cd "$WORKDIR"

if [[ ! -f package.json ]]; then
  echo "::error::package.json was not found in $WORKDIR"
  exit 1
fi

if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

if [[ "$WRANGLER_CONFIG" == "auto" || -z "$WRANGLER_CONFIG" ]]; then
  for candidate in wrangler.jsonc wrangler.json wrangler.toml; do
    if [[ -f "$candidate" ]]; then
      WRANGLER_CONFIG="$candidate"
      break
    fi
  done
fi

if [[ "$WRANGLER_CONFIG" == "auto" || ! -f "$WRANGLER_CONFIG" ]]; then
  echo "::error::Wrangler config not found in $WORKDIR"
  exit 1
fi

tmp_json=""
SECRET_ARGS=()
if [[ -n "${BOT_SECRET_BUNDLE:-}" ]]; then
  tmp_json="$(mktemp)"
  trap '[[ -n "$tmp_json" ]] && rm -f "$tmp_json"' EXIT
  count="$(BOT_SECRET_BUNDLE="$BOT_SECRET_BUNDLE" node "$FACTORY_ROOT/scripts/validate-secret-bundle.mjs" "$tmp_json")"
  if [[ "$count" -gt 0 ]]; then
    SECRET_ARGS=(--secrets-file "$tmp_json")
  fi
fi

echo "Deploying $BOT_NAME to Cloudflare with $WRANGLER_CONFIG"
npx wrangler deploy   --config "$WRANGLER_CONFIG"   --name "$BOT_NAME"   "${SECRET_ARGS[@]}"

if [[ -n "$HEALTH_URL" ]]; then
  echo "Checking $HEALTH_URL"
  ok=0
  for attempt in $(seq 1 12); do
    if curl -fsS --max-time 10 "$HEALTH_URL" >/dev/null; then
      ok=1
      break
    fi
    sleep 5
  done
  if [[ "$ok" -ne 1 ]]; then
    echo "::error::Health check failed after deployment: $HEALTH_URL"
    exit 1
  fi
fi
