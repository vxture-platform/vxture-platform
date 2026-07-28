#!/usr/bin/env bash
# deploy/scripts/27-provision-client-secrets.sh
# Provision confidential OIDC client secrets for the platform RPs.
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-06-17
#
# Run: CONFIRM_PROVISION_SECRETS=yes bash scripts/27-provision-client-secrets.sh
#
# For website/console/admin (LOCAL RPs co-located on the deploy host) it generates one
# random secret per client (when not already set), writes the plaintext into the
# RP runtime env (OIDC_CLIENT_SECRET in .env.<client>-bff — read by
# @vxture/core-oidc-rp) and the bcrypt hash into .env.auth-bff
# (OIDC_CLIENT_SECRET_HASH_<CLIENT> — projected by 23-seed into
# iam.oidc_client.client_secret_hash, which the IdP verifies with
# bcryptjs.compare). Without this the RP token exchange fails with 401
# invalid_client. The hash is single-quoted in .env.auth-bff because 23-seed
# sources that file with `. file` and bcrypt hashes contain '$' segments that
# bash would otherwise expand.
#
# For REMOTE RPs (umbra — umbra stack on worker-04, domain ruyin.ai; arda — vx-worker-02 via
# Tailscale) the hash still goes into .env.auth-bff (for the seed → IdP DB),
# but the plaintext has nowhere local to land: it is written to a 0600 file
# under secrets/ and only the PATH is printed (never the secret — keeps it out
# of CI logs). The operator retrieves it over SSH and pastes it into the remote
# app-bff env (OIDC_CLIENT_SECRET), then deletes the file.
# See docs/design/identity-app-integration-standard.md §11.
#
# Idempotent: a client whose secret + hash are already present is left untouched.
# Force rotation with FORCE_PROVISION_SECRETS=1.
#
# Follow-up (NOT done here): re-seed (23) so the DB picks up the hashes, then
# recreate the RP bffs so they load the new OIDC_CLIENT_SECRET. The
# The `db-init` workflow `provision-secrets` action chains all three.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATABASE_PRISMA_DIR="$COMPOSE_DIR/database/prisma"
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"
DB_TOOL_CACHE_DIR="${DB_TOOL_CACHE_DIR:-$RUNTIME_DIR/.db-tools/prisma-6.0.0-pg-8.20.0}"
DB_TOOL_INSTALL_TIMEOUT_SECONDS="${DB_TOOL_INSTALL_TIMEOUT_SECONDS:-600}"
PROVISION_TIMEOUT_SECONDS="${PROVISION_TIMEOUT_SECONDS:-300}"
AUTH_ENV_FILE="${AUTH_ENV_FILE:-$RUNTIME_DIR/.env.auth-bff}"
SECRETS_DIR="${SECRETS_DIR:-$RUNTIME_DIR/secrets}"
FORCE="${FORCE_PROVISION_SECRETS:-0}"
# LOCAL RPs: plaintext → .env.<client>-bff on this box.
CLIENTS_ALL="website console admin capconsole"
# REMOTE RPs: the RP lives off-box (umbra = umbra app-bff on worker-04). Plaintext
# has no local RP env → 0600 file, path printed; the operator transports it
# (umbra → worker-04 env). NOTE: umbra currently reuses the legacy ruyin secret
# (hash migrated to OIDC_CLIENT_SECRET_HASH_UMBRA by db-init; product_300 §2.4),
# so this script only mints one on FORCE rotation or a fresh install.
# karda-beta intentionally excluded — deferred until a beta host is assigned
# (TD-001 in vxture-karda); adding it here now would provision a secret for a
# client no host can use yet.
# atlas: vx-worker-02 (same host as arda/karda) via Tailscale; RP client_secret
# for its own outbound token-exchange calls (identity-app-integration-standard §11),
# separate from ATLAS_PROVISION_WEBHOOK_SECRET (inbound webhook HMAC, unrelated).
REMOTE_CLIENTS_ALL="umbra arda arda-beta karda atlas"

is_remote() {
  case " $REMOTE_CLIENTS_ALL " in *" $1 "*) return 0 ;; *) return 1 ;; esac
}

if [ "${CONFIRM_PROVISION_SECRETS:-}" != "yes" ]; then
  echo "错误：客户端密钥 provision 只允许首次部署或轮换时执行。" >&2
  echo "请确认后运行：CONFIRM_PROVISION_SECRETS=yes bash scripts/27-provision-client-secrets.sh" >&2
  exit 1
fi

check_file() {
  if [ ! -f "$1" ]; then
    echo "错误：缺少 $1" >&2
    exit 1
  fi
}

# Read the raw value of KEY from an env file (empty if file or key absent).
read_kv() {
  local file="$1" key="$2" line
  [ -f "$file" ] || return 0
  # `|| true` guards `set -e`/`pipefail`: a missing key makes grep exit 1, which
  # would otherwise abort the script when the value is captured in $(...).
  line="$(grep -E "^${key}=" "$file" 2>/dev/null | head -1 || true)"
  printf '%s' "${line#*=}"
}

# Upsert KEY=VALUE: replace the first matching line in place, else append.
# VALUE is written verbatim (awk -v, no regex/replacement metachars in our
# base64url secrets or single-quoted bcrypt hashes).
upsert_kv() {
  local file="$1" key="$2" val="$3" tmp
  touch "$file"
  if grep -qE "^${key}=" "$file"; then
    tmp="$(mktemp)"
    awk -v k="$key" -v v="$val" '
      !replaced && index($0, k "=") == 1 { print k "=" v; replaced = 1; next }
      { print }
    ' "$file" >"$tmp"
    mv "$tmp" "$file"
  else
    printf '%s=%s\n' "$key" "$val" >>"$file"
  fi
}

# Treat empty / CHANGEME / quoted-empty as "not provisioned".
is_unset() {
  local v="${1:-}"
  v="${v%\'}"; v="${v#\'}"; v="${v%\"}"; v="${v#\"}"
  [ -z "$v" ] || [ "$v" = "CHANGEME" ] || [ "$v" = "CHANGE_ME" ]
}

echo "=== Vxture OIDC Client Secret Provision ==="
check_file "$DATABASE_PRISMA_DIR/provision-client-secrets.mjs"

# ── operator-MFA secret: OPERATOR_TOTP_ENC_KEY ───────────────────────────────
# AES-256-GCM key for admin.operator_mfa.totp_secret at rest. Random, minted on the
# box once (idempotent; rotate with FORCE_PROVISION_SECRETS=1). Without it
# operator TOTP enroll/verify is fail-closed. 64 hex chars = 32 bytes; no shell
# metachars, so 23-seed sources it safely without quoting. Runs before the
# client-secret early-exit so it provisions even when all clients are present.
# (OPERATOR_SUPERADMIN_PASSWORD_HASH is deliberately NOT provisioned here — the
# password must be owner-chosen, never minted on the box. When unset the seed
# uses the bootstrap default + force-password-change in non-production only;
# since 2026-07-21 the 23/29 seed runners fail closed on a production DB
# without a real hash.)
operator_totp_key="$(read_kv "$AUTH_ENV_FILE" OPERATOR_TOTP_ENC_KEY)"
if [ "$FORCE" = "1" ] || is_unset "$operator_totp_key"; then
  upsert_kv "$AUTH_ENV_FILE" OPERATOR_TOTP_ENC_KEY "$(openssl rand -hex 32)"
  chmod 600 "$AUTH_ENV_FILE" 2>/dev/null || true
  echo "  [ok] OPERATOR_TOTP_ENC_KEY → $(basename "$AUTH_ENV_FILE") (generated)"
else
  echo "  [skip] OPERATOR_TOTP_ENC_KEY — already set"
fi

# Decide which clients still need a secret + hash pair.
NEED=()
for c in $CLIENTS_ALL $REMOTE_CLIENTS_ALL; do
  C="$(printf '%s' "$c" | tr '[:lower:]-' '[:upper:]_')"
  hash="$(read_kv "$AUTH_ENV_FILE" "OIDC_CLIENT_SECRET_HASH_${C}")"
  if is_remote "$c"; then
    # Remote RP: no local secret file to inspect; the IdP-side hash is the only
    # local artifact, so provision iff the hash is missing (or forced).
    if [ "$FORCE" = "1" ] || is_unset "$hash"; then
      NEED+=("$c")
    else
      echo "  [skip] $c (remote) — hash already present"
    fi
  else
    rp_file="$RUNTIME_DIR/.env.${c}-bff"
    sec="$(read_kv "$rp_file" OIDC_CLIENT_SECRET)"
    if [ "$FORCE" = "1" ] || is_unset "$sec" || is_unset "$hash"; then
      NEED+=("$c")
    else
      echo "  [skip] $c — secret + hash already present"
    fi
  fi
done

if [ "${#NEED[@]}" -eq 0 ]; then
  echo "=== All client secrets already provisioned (use FORCE_PROVISION_SECRETS=1 to rotate) ==="
  exit 0
fi

mkdir -p "$DB_TOOL_CACHE_DIR"
chmod 700 "$DB_TOOL_CACHE_DIR" 2>/dev/null || true

echo "==> 生成 ${NEED[*]} 的随机 secret + bcrypt hash"
# stdout (TSV: client<TAB>secret<TAB>hash) is captured, never logged.
PAIRS="$(docker run --rm \
  --env CLIENTS="${NEED[*]}" \
  --env DB_TOOL_INSTALL_TIMEOUT_SECONDS="$DB_TOOL_INSTALL_TIMEOUT_SECONDS" \
  --env PROVISION_TIMEOUT_SECONDS="$PROVISION_TIMEOUT_SECONDS" \
  -v "$DATABASE_PRISMA_DIR:/db/prisma:ro" \
  -v "$DB_TOOL_CACHE_DIR:/tmp/vxture-db" \
  node:24-alpine \
  sh -lc '
    set -e
    if [ ! -d /tmp/vxture-db/node_modules/bcryptjs ]; then
      timeout "$DB_TOOL_INSTALL_TIMEOUT_SECONDS" npm install --prefix /tmp/vxture-db bcryptjs@2.4.3 >/dev/null
    fi
    export NODE_PATH="/tmp/vxture-db/node_modules"
    timeout "$PROVISION_TIMEOUT_SECONDS" node /db/prisma/provision-client-secrets.mjs
  ')"

if [ -z "$PAIRS" ]; then
  echo "错误：未生成任何 client secret（生成器无输出）。" >&2
  exit 1
fi

REMOTE_HANDOFF=()
while IFS="$(printf '\t')" read -r c secret hash; do
  [ -n "$c" ] || continue
  C="$(printf '%s' "$c" | tr '[:lower:]-' '[:upper:]_')"
  # bcrypt hash (contains '$') → auth-bff env, single-quoted so `. source` in
  # 23-seed reads it literally instead of expanding $2a/$10/... segments.
  upsert_kv "$AUTH_ENV_FILE" "OIDC_CLIENT_SECRET_HASH_${C}" "'${hash}'"
  chmod 600 "$AUTH_ENV_FILE" 2>/dev/null || true
  if is_remote "$c"; then
    # Plaintext has no local RP env; drop it in a 0600 file for manual transport
    # to the off-box app-bff. Print only the path (never the secret) → CI-safe.
    mkdir -p "$SECRETS_DIR"
    secret_file="$SECRETS_DIR/oidc-client-secret-${c}.txt"
    printf '%s\n' "$secret" >"$secret_file"
    chmod 600 "$secret_file" 2>/dev/null || true
    REMOTE_HANDOFF+=("$c:$secret_file")
    echo "  [ok] $c (remote) — hash → $(basename "$AUTH_ENV_FILE"), plaintext → $secret_file (0600)"
  else
    rp_file="$RUNTIME_DIR/.env.${c}-bff"
    # Plaintext (base64url, no '$') → local RP env, unquoted.
    upsert_kv "$rp_file" OIDC_CLIENT_SECRET "$secret"
    chmod 600 "$rp_file" 2>/dev/null || true
    echo "  [ok] $c — secret → $(basename "$rp_file"), hash → $(basename "$AUTH_ENV_FILE")"
  fi
done <<EOF
$PAIRS
EOF

echo "=== Client secrets provisioned ==="
echo "下一步：重新 seed（iam.oidc_client 写入 hash），再 recreate website/console/admin-bff。"
if [ "${#REMOTE_HANDOFF[@]}" -gt 0 ]; then
  echo ""
  echo "!! 远程跨域 RP 需手动转运明文 secret 到其 app-bff env（OIDC_CLIENT_SECRET）："
  for h in "${REMOTE_HANDOFF[@]}"; do
    echo "   - ${h%%:*}: 取 ${h#*:} → 填到远程 app-bff .env → 转运后删除该文件"
  done
fi
