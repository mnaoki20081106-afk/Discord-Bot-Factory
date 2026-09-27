#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="${1:?source root required}"
WORKING_DIRECTORY="${2:?working directory required}"
BOT_NAME="${3:?bot name required}"
HOST="${4:?host IP required}"
START_COMMAND="${5:-}"

: "${BOT_FACTORY_SSH_PRIVATE_KEY:?BOT_FACTORY_SSH_PRIVATE_KEY is required}"
: "${FACTORY_ROOT:?FACTORY_ROOT is required}"

WORKDIR="$SOURCE_ROOT/$WORKING_DIRECTORY"
if [[ ! -d "$WORKDIR" ]]; then
  echo "::error::Working directory not found: $WORKDIR"
  exit 1
fi
if [[ ! -f "$WORKDIR/Dockerfile" && ! -f "$WORKDIR/package.json" ]]; then
  echo "::error::Node deployment requires Dockerfile or package.json."
  exit 1
fi

key_file="$(mktemp)"
secret_json="$(mktemp)"
env_file="$(mktemp)"
generated_dockerfile=""
trap 'rm -f "$key_file" "$secret_json" "$env_file" "$generated_dockerfile"' EXIT

printf '%s\n' "$BOT_FACTORY_SSH_PRIVATE_KEY" > "$key_file"
chmod 600 "$key_file"

if [[ -n "${BOT_SECRET_BUNDLE:-}" ]]; then
  BOT_SECRET_BUNDLE="$BOT_SECRET_BUNDLE"     node "$FACTORY_ROOT/scripts/validate-secret-bundle.mjs" "$secret_json" >/dev/null

  node - "$secret_json" "$env_file" <<'NODE'
const fs = require("node:fs");
const input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const lines = Object.entries(input).map(([key, value]) => `${key}=${value}`);
fs.writeFileSync(process.argv[3], lines.join("\n") + (lines.length ? "\n" : ""), { mode: 0o600 });
NODE
else
  : > "$env_file"
fi

ssh_opts=(
  -i "$key_file"
  -o BatchMode=yes
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=10
)
ssh_cmd=(ssh "${ssh_opts[@]}" "ubuntu@$HOST")
scp_cmd=(scp "${ssh_opts[@]}")

ready=0
for attempt in $(seq 1 36); do
  if "${ssh_cmd[@]}" 'docker version >/dev/null 2>&1'; then
    ready=1
    break
  fi
  sleep 5
done
if [[ "$ready" -ne 1 ]]; then
  echo "::error::OCI host did not become ready."
  exit 1
fi

remote_base="/opt/bot-factory/apps/$BOT_NAME"
"${ssh_cmd[@]}"   "sudo mkdir -p '$remote_base/src' &&
   sudo chown -R ubuntu:ubuntu '$remote_base' &&
   rm -rf '$remote_base/src' &&
   mkdir -p '$remote_base/src'"

tar   --exclude='.git'   --exclude='node_modules'   --exclude='.env'   --exclude='.dev.vars'   -czf -   -C "$WORKDIR" . |
  "${ssh_cmd[@]}" "tar xzf - -C '$remote_base/src'"

"${scp_cmd[@]}" "$env_file" "ubuntu@$HOST:$remote_base/.env" >/dev/null
"${ssh_cmd[@]}" "chmod 600 '$remote_base/.env'"

if [[ -f "$WORKDIR/Dockerfile" ]]; then
  dockerfile="Dockerfile"
else
  generated_dockerfile="$(mktemp)"
  cat > "$generated_dockerfile" <<'DOCKER'
FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
RUN if node -e "process.exit(require('./package.json').scripts?.build ? 0 : 1)"; then npm run build; fi
RUN npm prune --omit=dev
ENV NODE_ENV=production
CMD ["npm","start"]
DOCKER
  "${scp_cmd[@]}" "$generated_dockerfile" "ubuntu@$HOST:$remote_base/src/Dockerfile.factory" >/dev/null
  dockerfile="Dockerfile.factory"
fi

image="bot-factory/$BOT_NAME:latest"
"${ssh_cmd[@]}"   "cd '$remote_base/src' && docker build -f '$dockerfile' -t '$image' ."

"${ssh_cmd[@]}" "docker rm -f '$BOT_NAME' >/dev/null 2>&1 || true"

if [[ -n "$START_COMMAND" ]]; then
  encoded="$(printf '%s' "$START_COMMAND" | base64 -w0)"
  "${ssh_cmd[@]}"     "docker run -d --name '$BOT_NAME' --restart unless-stopped       --env-file '$remote_base/.env' '$image'       sh -lc \"\$(printf '%s' '$encoded' | base64 -d)\""
else
  "${ssh_cmd[@]}"     "docker run -d --name '$BOT_NAME' --restart unless-stopped       --env-file '$remote_base/.env' '$image'"
fi

sleep 8
state="$("${ssh_cmd[@]}" "docker inspect -f '{{.State.Status}}' '$BOT_NAME' 2>/dev/null || true")"
if [[ "$state" != "running" ]]; then
  echo "::error::Container $BOT_NAME is not running (state=$state)."
  "${ssh_cmd[@]}" "docker logs --tail 200 '$BOT_NAME' || true"
  exit 1
fi

"${ssh_cmd[@]}" "docker logs --tail 40 '$BOT_NAME' || true"
echo "Bot $BOT_NAME is running on OCI host $HOST."
