#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="${1:?source root required}"
WORKING_DIRECTORY="${2:?working directory required}"
BOT_NAME="${3:?bot name required}"
WRANGLER_CONFIG="${4:?wrangler config required}"
HEALTH_URL="${5:-}"
D1_MIGRATIONS_JSON="${6:-[]}"

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${FACTORY_ROOT:?FACTORY_ROOT is required}"

WORKDIR="$SOURCE_ROOT/$WORKING_DIRECTORY"

if [[ ! -d "$WORKDIR" ]]; then
  echo "::error::Working directory not found: $WORKDIR"
  exit 1
fi

if [[ -f "$SOURCE_ROOT/package-lock.json" && -f "$SOURCE_ROOT/package.json" ]]; then
  (cd "$SOURCE_ROOT" && npm ci)
elif [[ -f "$WORKDIR/package-lock.json" && -f "$WORKDIR/package.json" ]]; then
  (cd "$WORKDIR" && npm ci)
elif [[ -f "$WORKDIR/package.json" ]]; then
  (cd "$WORKDIR" && npm install)
fi

SECRET_ARGS=()
SECRET_FILE=""
if [[ -n "${BOT_SECRET_BUNDLE:-}" ]]; then
  SECRET_FILE="$(mktemp)"
  trap '[[ -n "$SECRET_FILE" ]] && rm -f "$SECRET_FILE"' EXIT
  count="$(BOT_SECRET_BUNDLE="$BOT_SECRET_BUNDLE" node "$FACTORY_ROOT/scripts/validate-secret-bundle.mjs" "$SECRET_FILE")"
  if [[ "$count" -gt 0 ]]; then
    SECRET_ARGS=(--secrets-file "$SECRET_FILE")
  fi
fi

cd "$WORKDIR"

echo "Deploying $BOT_NAME to Cloudflare..."
npx wrangler deploy   --config "$WRANGLER_CONFIG"   --name "$BOT_NAME"   "${SECRET_ARGS[@]}"

mapfile -t D1_BINDINGS < <(
  node -e '
    const values = JSON.parse(process.argv[1] || "[]");
    if (!Array.isArray(values)) process.exit(2);
    for (const value of values) console.log(String(value));
  ' "$D1_MIGRATIONS_JSON"
)

for binding in "${D1_BINDINGS[@]}"; do
  [[ -n "$binding" ]] || continue
  echo "Applying D1 migrations for binding $binding..."
  npx wrangler d1 migrations apply "$binding"     --remote     --config "$WRANGLER_CONFIG"
done

if [[ -n "$HEALTH_URL" ]]; then
  echo "Checking health endpoint: $HEALTH_URL"
  ok=0
  for attempt in $(seq 1 12); do
    if curl -fsS --max-time 10 "$HEALTH_URL" >/dev/null; then
      ok=1
      break
    fi
    sleep 5
  done
  if [[ "$ok" -ne 1 ]]; then
    echo "::error::Cloudflare deployment succeeded but health check failed."
    exit 1
  fi
fi
