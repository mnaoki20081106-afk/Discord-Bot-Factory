#!/usr/bin/env bash
# Runs ON the VPS (piped over ssh). Installs runtime deps, then (re)starts the bot as a
# systemd service. Idempotent: safe to run on every deploy.
set -euo pipefail

NAME="${1:?bot name required}"
RUNTIME="${2:?runtime required}"
ENTRYPOINT="${3:?entrypoint required}"
SWAP_MB="${4:-0}"
DIR="${5:?directory required}"
PIP_EXTRA="${6:-}"
SERVICE="factory-$NAME"

if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=""
else
  SUDO="sudo -n"
  if ! sudo -n true 2>/dev/null; then
    echo "ERROR: このユーザーはパスワード無しでsudoできません。root、またはsudo権限のあるユーザーで登録してください。"
    exit 1
  fi
fi

apt_install() {
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "WARN: apt-get が無いOSです。次を手動で入れてください: $*"
    return 0
  fi
  export DEBIAN_FRONTEND=noninteractive
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq "$@"
}

echo "==> OS: $(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" || uname -sr) / メモリ: $(free -m | awk '/Mem:/{print $2}')MB"

# Small servers: add swap once so pip installs and busy periods do not get OOM-killed.
if [[ "$SWAP_MB" -gt 0 ]] && [[ "$(swapon --noheadings 2>/dev/null | wc -l)" -eq 0 ]]; then
  echo "==> スワップ ${SWAP_MB}MB を作成"
  $SUDO fallocate -l "${SWAP_MB}M" /swapfile 2>/dev/null || $SUDO dd if=/dev/zero of=/swapfile bs=1M count="$SWAP_MB" status=none
  $SUDO chmod 600 /swapfile
  $SUDO mkswap /swapfile >/dev/null
  $SUDO swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null
fi

cd "$DIR"

case "$RUNTIME" in
  python)
    python3 -c 'import venv, ensurepip' 2>/dev/null || apt_install python3 python3-venv python3-pip build-essential
    [[ -d .venv ]] || python3 -m venv .venv
    .venv/bin/pip install -q --disable-pip-version-check --upgrade pip
    if [[ -f requirements.txt ]]; then
      echo "==> pip install -r requirements.txt"
      .venv/bin/pip install -q --disable-pip-version-check -r requirements.txt
    fi
    if [[ -n "$PIP_EXTRA" ]]; then
      echo "==> pip install (VPS専用の追加パッケージ): $PIP_EXTRA"
      # shellcheck disable=SC2086
      .venv/bin/pip install -q --disable-pip-version-check $PIP_EXTRA
    fi
    EXEC="$DIR/.venv/bin/python $ENTRYPOINT"
    ;;
  node)
    (command -v node >/dev/null && command -v npm >/dev/null) || apt_install nodejs npm
    if [[ -f package-lock.json ]]; then
      npm ci --omit=dev
    elif [[ -f package.json ]]; then
      npm install --omit=dev
    fi
    EXEC="$(command -v node) $ENTRYPOINT"
    ;;
  *)
    echo "ERROR: 未対応のruntime: $RUNTIME"
    exit 1
    ;;
esac

RUN_USER="$(id -un)"
RUN_GROUP="$(id -gn)"
echo "==> systemd: $SERVICE"
$SUDO tee "/etc/systemd/system/$SERVICE.service" >/dev/null <<UNIT
[Unit]
Description=$NAME (Discord Bot Factory)
After=network-online.target
Wants=network-online.target

[Service]
User=$RUN_USER
Group=$RUN_GROUP
WorkingDirectory=$DIR
EnvironmentFile=-$DIR/.env
ExecStart=$EXEC
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

$SUDO systemctl daemon-reload
$SUDO systemctl enable "$SERVICE" >/dev/null 2>&1
$SUDO systemctl restart "$SERVICE"

echo "==> 起動を確認しています（10秒）"
sleep 10
if $SUDO systemctl is-active --quiet "$SERVICE"; then
  echo "OK: $SERVICE は起動中です"
  $SUDO journalctl -u "$SERVICE" -n 25 --no-pager 2>/dev/null || true
else
  echo "ERROR: $SERVICE が起動していません。ログ:"
  $SUDO journalctl -u "$SERVICE" -n 80 --no-pager 2>/dev/null || true
  exit 1
fi
