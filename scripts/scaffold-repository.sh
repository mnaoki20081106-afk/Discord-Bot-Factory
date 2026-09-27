#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="${1:?owner/repository required}"
RUNTIME="${2:?runtime required}"
BOT_NAME="${3:?bot name required}"

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${FACTORY_ROOT:?FACTORY_ROOT is required}"

if [[ "$RUNTIME" != "node" && "$RUNTIME" != "worker" ]]; then
  echo "::error::runtime must be node or worker."
  exit 1
fi

TEMPLATE_ROOT="$FACTORY_ROOT/templates/$RUNTIME"
if [[ ! -d "$TEMPLATE_ROOT" ]]; then
  echo "::error::Template not found: $TEMPLATE_ROOT"
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

gh repo clone "$REPOSITORY" "$tmp/repo" >/dev/null 2>&1

cp -a "$TEMPLATE_ROOT/." "$tmp/repo/"

package_slug="$(printf '%s' "$BOT_NAME" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9._-]+/-/g; s/^-+//; s/-+$//')"
worker_slug="$(printf '%s' "$BOT_NAME" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9-]+/-/g; s/^-+//; s/-+$//')"

while IFS= read -r -d '' file; do
  sed -i     -e "s|__BOT_NAME__|$BOT_NAME|g"     -e "s|__BOT_PACKAGE__|$package_slug|g"     -e "s|__BOT_SLUG__|$worker_slug|g"     "$file"
done < <(find "$tmp/repo" -type f -not -path '*/.git/*' -print0)

git -C "$tmp/repo" config user.name "discord-bot-factory[bot]"
git -C "$tmp/repo" config user.email "discord-bot-factory[bot]@users.noreply.github.com"
git -C "$tmp/repo" add .
git -C "$tmp/repo" commit -m "feat: initialize $BOT_NAME" >/dev/null
git -C "$tmp/repo" push origin main >/dev/null

echo "Scaffolded $REPOSITORY using runtime=$RUNTIME"
