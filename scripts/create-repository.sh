#!/usr/bin/env bash
set -euo pipefail

REPO_NAME="${1:?repository name required}"
VISIBILITY="${2:-private}"
DESCRIPTION="${3:-Discord bot managed by Discord-Bot-Factory}"

: "${GH_TOKEN:?GH_TOKEN is required}"

if [[ ! "$REPO_NAME" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "::error::Invalid repository name."
  exit 1
fi

if [[ "$VISIBILITY" != "private" && "$VISIBILITY" != "public" ]]; then
  echo "::error::visibility must be private or public."
  exit 1
fi

OWNER="$(gh api user --jq .login)"

if gh api "repos/$OWNER/$REPO_NAME" >/dev/null 2>&1; then
  echo "::error::Repository $OWNER/$REPO_NAME already exists."
  exit 1
fi

private=false
if [[ "$VISIBILITY" == "private" ]]; then
  private=true
fi

gh api   --method POST   /user/repos   -f name="$REPO_NAME"   -f description="$DESCRIPTION"   -F private="$private"   -F auto_init=true   -F has_issues=true   -F has_projects=false   -F has_wiki=false >/dev/null

for attempt in $(seq 1 20); do
  if gh api "repos/$OWNER/$REPO_NAME" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

gh api   --method PUT   -H "Accept: application/vnd.github+json"   "repos/$OWNER/$REPO_NAME/topics"   --input - <<'JSON' >/dev/null
{"names":["discord-bot","bot-factory"]}
JSON

echo "repository=$OWNER/$REPO_NAME"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "repository=$OWNER/$REPO_NAME" >> "$GITHUB_OUTPUT"
fi
