#!/usr/bin/env bash
# deploy/scripts/12-generate-env-files.sh
# 从 deploy bundle 的 .example 模板生成或安全补齐 runtime env 文件。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-06-05
#
# 运行：bash scripts/12-generate-env-files.sh
# 幂等：不存在则从 .example 创建；已存在则只追加缺失 key，不覆盖已有值。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PLATFORM_DIR="${PLATFORM_DIR:-/srv/vxture/runtime}"
SECRETS_DIR="$PLATFORM_DIR/secrets"
OWNER_USER="${OWNER_USER:-${SUDO_USER:-$(id -un)}}"
OWNER_GROUP="${OWNER_GROUP:-$(id -gn "$OWNER_USER" 2>/dev/null || printf '%s' "$OWNER_USER")}"

echo "=== Vxture Runtime Env Sync ==="
echo "Template directory: $WORKER_DIR"
echo "Runtime directory:  $PLATFORM_DIR"
echo "Runtime owner:      $OWNER_USER:$OWNER_GROUP"

fix_runtime_permissions() {
  if [ "$(id -u)" -eq 0 ]; then
    chown -R "$OWNER_USER:$OWNER_GROUP" "$PLATFORM_DIR"
  fi

  chmod 700 "$PLATFORM_DIR" "$SECRETS_DIR"
}

if [ "$(id -u)" -ne 0 ] && { [ ! -d "$PLATFORM_DIR" ] || [ ! -w "$PLATFORM_DIR" ]; }; then
  echo "错误：当前用户无法创建或写入 $PLATFORM_DIR" >&2
  echo "首次初始化请执行：bash scripts/13-prepare-runtime-env.sh" >&2
  echo "13 脚本会在必要时通过 sudo 创建目录，并将 $PLATFORM_DIR 归还给 $OWNER_USER:$OWNER_GROUP。" >&2
  exit 1
fi

mkdir -p "$SECRETS_DIR"
fix_runtime_permissions

# -- Helpers -------------------------------------------------------------------

active_env_keys() {
  local file="$1"
  grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$file" 2>/dev/null | cut -d= -f1 || true
}

documented_env_keys() {
  local file="$1"
  sed -nE 's/^[[:space:]]*#?[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=.*/\1/p' "$file" 2>/dev/null || true
}

has_env_key() {
  local file="$1"
  local key="$2"
  grep -qE "^${key}=" "$file" 2>/dev/null
}

has_documented_env_key() {
  local file="$1"
  local key="$2"
  documented_env_keys "$file" | grep -qx "$key"
}

example_line_for_key() {
  local file="$1"
  local key="$2"
  grep -E "^${key}=" "$file" | tail -n 1
}

ensure_plain_secret_file() {
  local file="$1"
  local label="$2"

  if [ -f "$file" ] && [ -s "$file" ]; then
    chmod 600 "$file"
    echo "[SKIP] $label exists: $file"
    return
  fi

  printf '%s\n' "CHANGEME" > "$file"
  chmod 600 "$file"
  echo "[OK] Created $label placeholder: $file"
}

sync_env_from_example() {
  local example_file="$1"
  local runtime_file="$2"
  local label="$3"

  if [ ! -f "$example_file" ]; then
    echo "错误：缺少模板文件 $example_file" >&2
    exit 1
  fi

  if [ ! -f "$runtime_file" ]; then
    cp "$example_file" "$runtime_file"
    chmod 600 "$runtime_file"
    echo "[OK] Created $label from example: $runtime_file"
    return
  fi

  chmod 600 "$runtime_file"

  local missing_keys=()
  local key
  while IFS= read -r key; do
    if [ -n "$key" ] && ! has_env_key "$runtime_file" "$key"; then
      missing_keys+=("$key")
    fi
  done < <(active_env_keys "$example_file")

  if [ "${#missing_keys[@]}" -gt 0 ]; then
    {
      printf '\n'
      printf '# ============================================================================\n'
      printf '# 从 .example 追加的新配置项，请手动填写真实值；已有配置不会被覆盖。\n'
      printf '# Added from: %s\n' "$(basename "$example_file")"
      printf '# ============================================================================\n'
      for key in "${missing_keys[@]}"; do
        example_line_for_key "$example_file" "$key"
      done
    } >> "$runtime_file"
    echo "[OK] Appended ${#missing_keys[@]} missing key(s): $runtime_file"
  else
    echo "[OK] No missing keys: $runtime_file"
  fi

  local deprecated_keys=()
  while IFS= read -r key; do
    if [ -n "$key" ] && ! has_documented_env_key "$example_file" "$key"; then
      deprecated_keys+=("$key")
    fi
  done < <(active_env_keys "$runtime_file")

  # Advisory only — printed to stdout, never appended to the runtime file.
  # (The old file-append had no idempotency check, so every run stacked another
  # WARN block into the file — worker-01's .env.auth-bff accumulated 60+ of
  # them. Cleanup/realign is 14-normalize-runtime-env.sh's job.)
  if [ "${#deprecated_keys[@]}" -gt 0 ]; then
    echo "[WARN] $runtime_file 存在已废弃待删除配置项（已不在 .example 中）：${deprecated_keys[*]}"
    echo "       Run: APPLY=1 bash scripts/14-normalize-runtime-env.sh to strictly realign."
  fi
}

# -- 1. Raw secret placeholders ------------------------------------------------
# 原始密码文件没有 .example 对应文件，首次只写 CHANGEME，必须手动替换。
ensure_plain_secret_file "$SECRETS_DIR/pg-password" "Postgres password"
ensure_plain_secret_file "$SECRETS_DIR/redis-password" "Redis password"

# -- 2. Env files from .example ------------------------------------------------
sync_env_from_example "$WORKER_DIR/.env.example" "$PLATFORM_DIR/.env" "compose env"
sync_env_from_example "$WORKER_DIR/secrets/platform.env.example" "$SECRETS_DIR/platform.env" "platform shared env"
sync_env_from_example "$WORKER_DIR/secrets/platform-mail.env.example" "$SECRETS_DIR/platform-mail.env" "platform mail env"
sync_env_from_example "$WORKER_DIR/secrets/platform-sms.env.example" "$SECRETS_DIR/platform-sms.env" "platform sms env"
sync_env_from_example "$WORKER_DIR/secrets/platform-identity.env.example" "$SECRETS_DIR/platform-identity.env" "platform identity (signing key) env"
sync_env_from_example "$WORKER_DIR/.env.auth-bff.example" "$PLATFORM_DIR/.env.auth-bff" "auth-bff env"
sync_env_from_example "$WORKER_DIR/.env.website-bff.example" "$PLATFORM_DIR/.env.website-bff" "website-bff env"
sync_env_from_example "$WORKER_DIR/.env.console-bff.example" "$PLATFORM_DIR/.env.console-bff" "console-bff env"
sync_env_from_example "$WORKER_DIR/.env.admin-bff.example" "$PLATFORM_DIR/.env.admin-bff" "admin-bff env"
sync_env_from_example "$WORKER_DIR/.env.platform-api.example" "$PLATFORM_DIR/.env.platform-api" "platform-api env"
sync_env_from_example "$WORKER_DIR/.env.gateway-bff.example" "$PLATFORM_DIR/.env.gateway-bff" "gateway-bff env"

fix_runtime_permissions
chmod 600 "$PLATFORM_DIR"/.env* "$SECRETS_DIR"/* 2>/dev/null || true

echo ""
echo "=== Done ==="
echo ""
echo "Runtime env files are synchronized from .example templates."
echo "Existing values were preserved; missing keys were appended."
echo "Raw secret files are initialized as CHANGEME when absent and must be edited manually."
echo ""
echo "Next: grep -R \"CHANGE_ME\\|CHANGEME\" \"$PLATFORM_DIR\""
