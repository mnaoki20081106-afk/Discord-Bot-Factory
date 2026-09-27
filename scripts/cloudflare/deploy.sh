#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="${1:?source root required}"
WORKING_DIRECTORY="${2:?working directory required}"
BOT_NAME="${3:?bot name required}"
WRANGLER_CONFIG="${4:?wrangler config required}"
HEALTH_URL="${5:-}"
D1_MIGRATIONS_JSON="${6:-[]}"
D1_SCHEMA_FILES_JSON="${7:-[]}"
FACTORY_WRANGLER_VERSION="${FACTORY_WRANGLER_VERSION:-4.142.0}"

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${FACTORY_ROOT:?FACTORY_ROOT is required}"

WORKDIR="$SOURCE_ROOT/$WORKING_DIRECTORY"

if [[ ! -d "$WORKDIR" ]]; then
  echo "::error::Working directory not found: $WORKDIR"
  exit 1
fi

if [[ -f "$WORKDIR/package-lock.json" && -f "$WORKDIR/package.json" ]]; then
  (cd "$WORKDIR" && npm ci)
elif [[ -f "$SOURCE_ROOT/package-lock.json" && -f "$SOURCE_ROOT/package.json" ]]; then
  (cd "$SOURCE_ROOT" && npm ci)
elif [[ -f "$WORKDIR/package.json" ]]; then
  (cd "$WORKDIR" && npm install)
fi

SECRET_ARGS=()
SECRET_FILE=""
DELETE_SECRET_FILE=""

cleanup_temp_files() {
  [[ -z "$SECRET_FILE" ]] || rm -f "$SECRET_FILE"
  [[ -z "$DELETE_SECRET_FILE" ]] || rm -f "$DELETE_SECRET_FILE"
}
trap cleanup_temp_files EXIT

if [[ -n "${BOT_SECRET_BUNDLE:-}" ]]; then
  SECRET_FILE="$(mktemp)"
  count="$(BOT_SECRET_BUNDLE="$BOT_SECRET_BUNDLE" node "$FACTORY_ROOT/scripts/validate-secret-bundle.mjs" "$SECRET_FILE")"
  if [[ "$count" -gt 0 ]]; then
    SECRET_ARGS=(--secrets-file "$SECRET_FILE")
  fi
fi

cd "$WORKDIR"

run_wrangler() {
  npx --yes "wrangler@$FACTORY_WRANGLER_VERSION" "$@"
}

# The Factory registry is the single source of truth for account routing.
# Reject a hard-coded account_id so a stale Wrangler config cannot send a bot
# to a different Cloudflare account than bot-factory.json requested.
if [[ "$WRANGLER_CONFIG" == *.toml ]]; then
  if grep -Eq '^[[:space:]]*account_id[[:space:]]*=' "$WRANGLER_CONFIG"; then
    echo "::error::Remove account_id from $WRANGLER_CONFIG. Factory selects the account from the Control Plane."
    exit 1
  fi
else
  if grep -Eq '"account_id"[[:space:]]*:' "$WRANGLER_CONFIG"; then
    echo "::error::Remove account_id from $WRANGLER_CONFIG. Factory selects the account from the Control Plane."
    exit 1
  fi
fi

echo "Deploying $BOT_NAME to Cloudflare account $CLOUDFLARE_ACCOUNT_ID..."
run_wrangler deploy   --config "$WRANGLER_CONFIG"   --name "$BOT_NAME"   "${SECRET_ARGS[@]}"

if [[ -n "${BOT_SECRET_DELETE_KEYS:-}" ]]; then
  DELETE_SECRET_FILE="$(mktemp)"
  delete_count="$(
    BOT_SECRET_DELETE_KEYS="$BOT_SECRET_DELETE_KEYS" node - "$DELETE_SECRET_FILE" <<'NODE'
const fs = require("node:fs");
const output = process.argv[2];
let keys;
try {
  keys = JSON.parse(process.env.BOT_SECRET_DELETE_KEYS || "[]");
} catch {
  throw new Error("BOT_SECRET_DELETE_KEYS is not valid JSON.");
}
if (!Array.isArray(keys)) throw new Error("BOT_SECRET_DELETE_KEYS must be an array.");
const result = {};
for (const raw of keys) {
  const key = String(raw);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid secret deletion key: ${key}`);
  result[key] = null;
}
fs.writeFileSync(output, JSON.stringify(result), { mode: 0o600 });
process.stdout.write(String(Object.keys(result).length));
NODE
  )"

  if [[ "$delete_count" -gt 0 ]]; then
    echo "Removing $delete_count stale Factory-managed Worker secret(s)..."
    run_wrangler secret bulk "$DELETE_SECRET_FILE" --config "$WRANGLER_CONFIG" --name "$BOT_NAME"
  fi
fi

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
  run_wrangler d1 migrations apply "$binding"     --remote     --config "$WRANGLER_CONFIG"
done

mapfile -t D1_SCHEMA_ENTRIES < <(
  node -e '
    const values = JSON.parse(process.argv[1] || "[]");
    if (!Array.isArray(values)) process.exit(2);
    for (const value of values) {
      if (!value || typeof value !== "object") process.exit(3);
      const binding = String(value.binding || "");
      const file = String(value.file || "");
      if (!binding || !file) process.exit(4);
      process.stdout.write(JSON.stringify({ binding, file }) + "\n");
    }
  ' "$D1_SCHEMA_FILES_JSON"
)

for entry in "${D1_SCHEMA_ENTRIES[@]}"; do
  [[ -n "$entry" ]] || continue
  binding="$(node -e 'const x=JSON.parse(process.argv[1]);process.stdout.write(x.binding)' "$entry")"
  schema_file="$(node -e 'const x=JSON.parse(process.argv[1]);process.stdout.write(x.file)' "$entry")"

  if [[ ! -f "$schema_file" ]]; then
    echo "::error::D1 schema file not found: $schema_file"
    exit 1
  fi

  echo "Applying D1 schema file $schema_file to binding $binding..."
  run_wrangler d1 execute "$binding"     --remote     --config "$WRANGLER_CONFIG"     --file "$schema_file"
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
