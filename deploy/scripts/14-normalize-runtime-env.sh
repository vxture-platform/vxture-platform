#!/usr/bin/env bash
# deploy/scripts/14-normalize-runtime-env.sh
# Strictly normalize runtime env files against their .example templates.
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-07-21
#
# Why: 12-generate-env-files.sh is deliberately append-only (never reorders,
# never deletes), so long-lived hosts accumulate key-order drift, duplicated
# advisory blocks and dead keys — which breaks the strict actual==example
# contract that guardrails/39-audit-env.mjs enforces (exactKeyOrder) and makes
# the files hard to hand-maintain.
#
# What: for every (example, runtime) pair, regenerate the runtime file as the
# example verbatim (comments included) with each active KEY= line replaced by
# the runtime value when the key exists on the host (LAST occurrence wins,
# matching docker-compose env_file semantics). Then:
#   - runtime-only keys documented (commented) in the example are preserved in
#     a marked tail block (e.g. VX_IMAGE_* in the compose .env);
#   - runtime-only keys NOT documented in the example are DROPPED and reported;
#   - duplicate keys collapse to a single line (last value).
#
# Safety: dry-run by default (prints a per-file plan, writes nothing).
#   Run:   bash scripts/14-normalize-runtime-env.sh          # dry-run
#          APPLY=1 bash scripts/14-normalize-runtime-env.sh  # rewrite
# APPLY=1 first copies every file it rewrites into
# $PLATFORM_DIR/backup-normalize-<UTC>/ (chmod 700). Files keep mode 600.
# Running containers are unaffected until their next recreate (env_file is
# read at container start only).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PLATFORM_DIR="${PLATFORM_DIR:-/srv/vxture/runtime}"
SECRETS_DIR="$PLATFORM_DIR/secrets"
APPLY="${APPLY:-0}"
TS="$(date -u +%Y%m%d-%H%M%S)"
BACKUP_DIR="$PLATFORM_DIR/backup-normalize-$TS"

echo "=== Vxture Runtime Env Normalize ($([ "$APPLY" = "1" ] && echo APPLY || echo dry-run)) ==="
echo "Template directory: $WORKER_DIR"
echo "Runtime directory:  $PLATFORM_DIR"

active_keys() {
  grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$1" 2>/dev/null | cut -d= -f1 || true
}

documented_keys() {
  sed -nE 's/^[[:space:]]*#?[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=.*/\1/p' "$1" 2>/dev/null || true
}

# Effective runtime line for a key: LAST occurrence wins (env_file semantics).
runtime_line() {
  grep -E "^${2}=" "$1" | tail -n 1
}

normalize_one() {
  local example="$1" runtime="$2" label="$3"

  if [ ! -f "$example" ]; then
    echo "[SKIP] $label: missing example $example"
    return
  fi
  if [ ! -f "$runtime" ]; then
    echo "[SKIP] $label: missing runtime $runtime (run 12-generate-env-files.sh first)"
    return
  fi

  local tmp kept=0 defaulted=0 key line
  tmp="$(mktemp)"

  # 1) Example body verbatim, active KEY= lines substituted with runtime values.
  while IFS= read -r line; do
    case "$line" in
      [A-Za-z_]*=*)
        key="${line%%=*}"
        if printf '%s' "$key" | grep -qE '^[A-Za-z_][A-Za-z0-9_]*$' \
          && grep -qE "^${key}=" "$runtime"; then
          runtime_line "$runtime" "$key" >> "$tmp"
          kept=$((kept + 1))
        else
          printf '%s\n' "$line" >> "$tmp"
          defaulted=$((defaulted + 1))
        fi
        ;;
      *)
        printf '%s\n' "$line" >> "$tmp"
        ;;
    esac
  done < "$example"

  # 2) Classify runtime-only active keys: documented-in-example -> keep in a
  #    marked tail block; undocumented -> drop (reported).
  local extra_documented=() extra_dropped=()
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    if active_keys "$example" | grep -qx "$key"; then continue; fi
    if documented_keys "$example" | grep -qx "$key"; then
      extra_documented+=("$key")
    else
      extra_dropped+=("$key")
    fi
  done < <(active_keys "$runtime" | awk '!seen[$0]++')

  if [ "${#extra_documented[@]}" -gt 0 ]; then
    {
      printf '\n# -- host-set optional keys (documented as commented in %s) --\n' "$(basename "$example")"
      for key in "${extra_documented[@]}"; do
        runtime_line "$runtime" "$key"
      done
    } >> "$tmp"
  fi

  # 3) Report.
  local dups
  dups="$(active_keys "$runtime" | sort | uniq -d | tr '\n' ' ')"
  echo "[PLAN] $label: from_runtime=$kept example_default=$defaulted optional_tail=${#extra_documented[@]} dropped=${#extra_dropped[@]}${dups:+ dedup: $dups}"
  if [ "${#extra_dropped[@]}" -gt 0 ]; then
    echo "       dropped (not documented in example): ${extra_dropped[*]}"
  fi

  # 4) Apply with backup.
  if [ "$APPLY" = "1" ]; then
    mkdir -p "$BACKUP_DIR"
    chmod 700 "$BACKUP_DIR"
    cp -p "$runtime" "$BACKUP_DIR/$(printf '%s' "${runtime#"$PLATFORM_DIR"/}" | tr / _)"
    install -m 600 "$tmp" "$runtime"
    echo "[OK]   $label normalized: $runtime"
  fi
  rm -f "$tmp"
}

# Pair list mirrors 12-generate-env-files.sh, plus the host-generated
# platform-app overlay (32-provision-service-db-roles.sh) whose example is the
# key-order authority all the same.
normalize_one "$WORKER_DIR/.env.example" "$PLATFORM_DIR/.env" "compose env"
normalize_one "$WORKER_DIR/secrets/platform.env.example" "$SECRETS_DIR/platform.env" "platform shared env"
normalize_one "$WORKER_DIR/secrets/platform-app.env.example" "$SECRETS_DIR/platform-app.env" "platform app overlay env"
normalize_one "$WORKER_DIR/secrets/platform-mail.env.example" "$SECRETS_DIR/platform-mail.env" "platform mail env"
normalize_one "$WORKER_DIR/secrets/platform-sms.env.example" "$SECRETS_DIR/platform-sms.env" "platform sms env"
normalize_one "$WORKER_DIR/secrets/platform-identity.env.example" "$SECRETS_DIR/platform-identity.env" "platform identity (signing key) env"
normalize_one "$WORKER_DIR/.env.auth-bff.example" "$PLATFORM_DIR/.env.auth-bff" "auth-bff env"
normalize_one "$WORKER_DIR/.env.website-bff.example" "$PLATFORM_DIR/.env.website-bff" "website-bff env"
normalize_one "$WORKER_DIR/.env.console-bff.example" "$PLATFORM_DIR/.env.console-bff" "console-bff env"
normalize_one "$WORKER_DIR/.env.admin-bff.example" "$PLATFORM_DIR/.env.admin-bff" "admin-bff env"
normalize_one "$WORKER_DIR/.env.platform-api.example" "$PLATFORM_DIR/.env.platform-api" "platform-api env"
normalize_one "$WORKER_DIR/.env.gateway-bff.example" "$PLATFORM_DIR/.env.gateway-bff" "gateway-bff env"

echo ""
if [ "$APPLY" = "1" ]; then
  echo "=== Done (files rewritten; backup: $BACKUP_DIR) ==="
  echo "Verify: VX_ENV_AUDIT_STRICT_RUNTIME=1 node guardrails/39-audit-env.mjs"
else
  echo "=== Dry-run only — nothing written. Re-run with APPLY=1 to rewrite. ==="
fi
