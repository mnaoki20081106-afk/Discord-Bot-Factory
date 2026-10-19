#!/usr/bin/env bash
# Runs on the GitHub Actions runner. Uploads the bot repository to a VPS over SSH and runs
# scripts/vps/remote-setup.sh there. Output is also written to $RUNNER_TEMP/vps-deploy.log so
# the workflow can report the tail back to the Control Plane (shown on the management site).
set -euo pipefail

SOURCE_ROOT="${1:?source root required}"
TEMP="${RUNNER_TEMP:-/tmp}"
LOG="$TEMP/vps-deploy.log"
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1

: "${VPS_HOST:?}" "${VPS_PORT:?}" "${VPS_USER:?}" "${VPS_AUTH:?}"
: "${BOT_NAME:?}" "${BOT_RUNTIME:?}" "${BOT_ENTRYPOINT:?}" "${BOT_ENV_B64:?}"
: "${FACTORY_ROOT:?}"

if [[ ! "$BOT_NAME" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "ERROR: BOT名が不正です: $BOT_NAME"
  exit 1
fi

KNOWN="$TEMP/vps_known_hosts"
SSH_OPTS=(-p "$VPS_PORT" -o ConnectTimeout=20 -o ServerAliveInterval=15 -o LogLevel=ERROR)

if [[ -n "${VPS_KNOWN_HOST:-}" ]]; then
  printf '%s\n' "$VPS_KNOWN_HOST" > "$KNOWN"
  echo "==> 登録済みのホスト鍵で接続します"
else
  echo "==> 初回接続: ホスト鍵を取得して記録します"
  keys="$(ssh-keyscan -p "$VPS_PORT" -T 15 "$VPS_HOST" 2>/dev/null | grep -E ' (ssh-ed25519|ecdsa-sha2-[a-z0-9]+|ssh-rsa) ' || true)"
  line="$(printf '%s\n' "$keys" | grep ' ssh-ed25519 ' | head -n1 || true)"
  [[ -n "$line" ]] || line="$(printf '%s\n' "$keys" | head -n1)"
  if [[ -z "$line" ]]; then
    echo "ERROR: ${VPS_HOST}:${VPS_PORT} へ接続できません。IPアドレス・ポート・ファイアウォール(22番の受信許可)を確認してください。"
    exit 1
  fi
  printf '%s\n' "$line" > "$KNOWN"
  printf '%s\n' "$line" > "$TEMP/vps-host-key"
fi
SSH_OPTS+=(-o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$KNOWN")

if [[ "$VPS_AUTH" == "key" ]]; then
  SSH=(ssh "${SSH_OPTS[@]}" -i "${VPS_KEY_FILE:?}" -o IdentitiesOnly=yes -o BatchMode=yes)
else
  command -v sshpass >/dev/null 2>&1 || { sudo apt-get update -qq && sudo apt-get install -y -qq sshpass; }
  : "${SSHPASS:?}"
  SSH=(sshpass -e ssh "${SSH_OPTS[@]}" -o PubkeyAuthentication=no -o PreferredAuthentications=password)
fi
TARGET="$VPS_USER@$VPS_HOST"

echo "==> 接続テスト ($TARGET)"
if ! "${SSH[@]}" "$TARGET" 'echo connected'; then
  echo "ERROR: SSH接続に失敗しました。ユーザー名・秘密鍵（またはパスワード）を確認してください。サーバーを作り直した場合はホスト鍵が変わっています。管理サイトのVPSタブで、同じ表示名のままホストを入力し直して更新してください。"
  exit 1
fi

REMOTE_DIR="\$HOME/factory/$BOT_NAME"
echo "==> ソースをアップロード"
tar -C "$SOURCE_ROOT" --exclude=.git --exclude=.venv --exclude=node_modules --exclude=__pycache__ --exclude=.env -czf - . \
  | "${SSH[@]}" "$TARGET" "mkdir -p $REMOTE_DIR && tar -xzf - -C $REMOTE_DIR"

echo "==> .env を書き込み"
"${SSH[@]}" "$TARGET" "umask 077 && printf '%s' '$BOT_ENV_B64' | base64 -d > $REMOTE_DIR/.env"

echo "==> サーバー側のセットアップ"
"${SSH[@]}" "$TARGET" "bash -s -- '$BOT_NAME' '$BOT_RUNTIME' '$BOT_ENTRYPOINT' '${BOT_SWAP_MB:-0}' \"$REMOTE_DIR\" '${BOT_PIP_EXTRA:-}'" \
  < "$FACTORY_ROOT/scripts/vps/remote-setup.sh"

echo "==> 完了"
