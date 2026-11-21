#!/usr/bin/env bash
# Deterministic migration plans shared by the entry and isolated tests.
# @package @vxture/repo
# @layer Infrastructure
# @category deployment-script
# @author AI-Generated
# @date 2026-11-20

# ===========================================================================
# Planning never reads runtime secrets or contacts Docker/PostgreSQL.
# ===========================================================================
migration_error() { printf 'migration refused: %s\n' "$*" >&2; return 1; }
migration_sha() { sha256sum "$1" | cut -d ' ' -f 1; }

# Build an ordered inventory and hash code, SQL, DDL and timeout policy.
# Arguments: deploy directory, optional unique filename prefix.
migration_build_plan() {
  local deploy="$1" until="${2:-}" file name hit='' matches=0 selected=1
  local -a inventory=() sources=() digests=()
  local hashes line index=0
  export LC_ALL=C
  MIGRATION_TIMEOUT="${MIGRATE_TIMEOUT_SECONDS:-600}"
  MIGRATION_RUN_TIMEOUT="${MIGRATE_RUN_TIMEOUT_SECONDS:-1800}"
  [[ "$MIGRATION_TIMEOUT" =~ ^[1-9][0-9]{0,3}$ ]] && (( MIGRATION_TIMEOUT <= 3600 )) || { migration_error 'invalid statement timeout'; return 1; }
  [[ "$MIGRATION_RUN_TIMEOUT" =~ ^[1-9][0-9]{0,4}$ ]] && (( MIGRATION_RUN_TIMEOUT <= 86400 )) || { migration_error 'invalid run timeout'; return 1; }
  [[ "$until" != *[!A-Za-z0-9._-]* ]] || { migration_error 'invalid cutoff'; return 1; }
  MIGRATION_ALL=() MIGRATION_SELECTED=() MIGRATION_SKIPPED=()
  for file in "$deploy"/database/migrations/*.sql; do
    [[ -e "$file" || -L "$file" ]] || continue
    name="${file##*/}"
    [[ -f "$file" && ! -L "$file" && "$name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*\.sql$ ]] || { migration_error 'unsafe migration filename or symlink'; return 1; }
    MIGRATION_ALL+=("$name")
    if [[ -n "$until" && "$name" == "$until"* ]]; then hit="$name"; matches=$((matches+1)); fi
  done
  (( ${#MIGRATION_ALL[@]} > 0 )) || { migration_error 'empty migration inventory'; return 1; }
  if [[ -n "$until" && "$matches" != 1 ]]; then migration_error 'cutoff must identify exactly one migration'; return 1; fi
  for name in "${MIGRATION_ALL[@]}"; do
    if (( selected )); then MIGRATION_SELECTED+=("$name"); else MIGRATION_SKIPPED+=("$name"); fi
    [[ "$name" != "$hit" ]] || selected=0
  done
  MIGRATION_FULL=1
  (( ${#MIGRATION_SKIPPED[@]} == 0 )) || MIGRATION_FULL=0
  local voucher_count=0
  for name in "${MIGRATION_SELECTED[@]}"; do
    case "$name" in
      2026-12-09-promotion-ownership-foundation.sql|2026-12-10-wallet-source-ledger.sql|2026-12-11-recharge-card-funding.sql) voucher_count=$((voucher_count+1));;
    esac
  done
  if (( voucher_count != 0 && voucher_count != 3 )); then migration_error 'B02/B10/B11 require one uninterrupted stopped-write window'; return 1; fi
  for file in "$deploy"/database/ddl/[0-9]*.sql; do inventory+=("${file#"$deploy/"}"); done
  inventory+=(scripts/28d-apply-migrations.sh scripts/lib/migration-plan.sh database/verify/migration-cutover-preflight.sql)
  for name in "${inventory[@]}"; do
    [[ -f "$deploy/$name" && ! -L "$deploy/$name" ]] || { migration_error "missing or linked plan input: $name"; return 1; }
  done
  for name in "${MIGRATION_ALL[@]}"; do sources+=("$deploy/database/migrations/$name"); done
  for name in "${inventory[@]}"; do sources+=("$deploy/$name"); done
  hashes="$(sha256sum "${sources[@]}")" || { migration_error 'cannot hash plan inputs'; return 1; }
  while IFS= read -r line; do digests+=("${line%% *}"); done <<< "$hashes"
  MIGRATION_MANIFEST="$(
    printf 'vx-migration-plan-v1\nfull=%s\nstatement_timeout=%s\nrun_timeout=%s\n' "$MIGRATION_FULL" "$MIGRATION_TIMEOUT" "$MIGRATION_RUN_TIMEOUT"
    for name in "${MIGRATION_ALL[@]}"; do
      selected=skip
      for file in "${MIGRATION_SELECTED[@]}"; do [[ "$file" != "$name" ]] || selected=run; done
      printf '%s %s migrations/%s\n' "$selected" "${digests[$index]}" "$name"
      index=$((index+1))
    done
    for name in "${inventory[@]}"; do
      printf 'input %s %s\n' "${digests[$index]}" "$name"
      index=$((index+1))
    done
  )"
  MIGRATION_PLAN_SHA256="$(printf '%s\n' "$MIGRATION_MANIFEST" | sha256sum | cut -d ' ' -f 1)"
}

# Print a portable review artifact without runtime paths or connection strings.
migration_print_plan() {
  printf '%s\nMIGRATION_PLAN_SHA256=%s\nMIGRATION_SELECTED_COUNT=%s\nMIGRATION_FULL=%s\n' "$MIGRATION_MANIFEST" "$MIGRATION_PLAN_SHA256" "${#MIGRATION_SELECTED[@]}" "$MIGRATION_FULL"
}

# ===========================================================================
# Evidence is an attestation, not an automatic backup/stop mechanism.
# ===========================================================================
migration_require_authorization() {
  [[ "${CONFIRM_MIGRATE:-}" == yes ]] || { migration_error 'CONFIRM_MIGRATE=yes required'; return 1; }
  [[ "${MIGRATE_PLAN_SHA256:-}" == "$MIGRATION_PLAN_SHA256" ]] || { migration_error 'reviewed plan hash missing or changed'; return 1; }
  [[ "${MIGRATE_TARGET_SHA256:-}" =~ ^[a-f0-9]{64}$ ]] || { migration_error 'target identity hash required'; return 1; }
  [[ "${MIGRATE_BACKUP_SHA256:-}" =~ ^[a-f0-9]{64}$ ]] || { migration_error 'backup hash required'; return 1; }
  [[ "${MIGRATE_RESTORE_EVIDENCE:-}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || { migration_error 'restore evidence reference required'; return 1; }
  [[ "${MIGRATE_CUTOVER_EVIDENCE:-}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || { migration_error 'cutover evidence reference required'; return 1; }
  [[ "${MIGRATE_WRITES_STOPPED:-}" == yes && "${MIGRATE_RESTORE_VERIFIED:-}" == yes ]] || { migration_error 'stopped writes and verified recovery must be attested'; return 1; }
  [[ "${MIGRATE_QUIESCED_AT:-}" =~ ^[1-9][0-9]{9}$ ]] || { migration_error 'UTC quiescence epoch required'; return 1; }
  local age=$(( $(date +%s) - MIGRATE_QUIESCED_AT ))
  (( age >= 0 && age <= 3600 )) || { migration_error 'cutover evidence is future-dated or older than one hour'; return 1; }
}

# One psql session retains the lock across each migration's own transactions.
# Concurrent indexes are deliberately not enclosed in an outer transaction.
migration_emit_sql() {
  local name
  printf '\\set ON_ERROR_STOP on\nSET statement_timeout = %s;\n' "$((MIGRATION_TIMEOUT*1000))"
  cat <<'SQL'
SELECT pg_try_advisory_lock(742138660, 1) AS migration_lock_acquired \gset
\if :migration_lock_acquired
\else
DO $$ BEGIN RAISE EXCEPTION 'MIGRATION_LOCK_BUSY'; END $$;
\endif
\i /verify/migration-cutover-preflight.sql
SQL
  for name in "${MIGRATION_SELECTED[@]}"; do
    printf '\\echo MIGRATION_BEGIN=%s\nSET statement_timeout = %s;\n\\i /migrations/%s\n\\echo MIGRATION_DONE=%s\n' "$name" "$((MIGRATION_TIMEOUT*1000))" "$name" "$name"
  done
  if (( MIGRATION_FULL )); then
    printf '\\echo COLUMN_LOCKS_BEGIN\nBEGIN;\nSET LOCAL statement_timeout = %s;\n\\i /column_locks.sql\nCOMMIT;\n\\echo COLUMN_LOCKS_DONE\n' "$((MIGRATION_TIMEOUT*1000))"
  else
    printf '\\echo COLUMN_LOCKS_DEFERRED_PARTIAL_PLAN\n'
  fi
  printf 'SELECT pg_advisory_unlock(742138660, 1);\n\\echo MIGRATION_CHANNEL_COMPLETE=%s\n' "$MIGRATION_PLAN_SHA256"
}

# CLI for offline planning and test SQL; sourcing exposes the same functions.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
  migration_build_plan "${2:?deploy directory required}" "${MIGRATE_UNTIL:-}"
  case "${1:-plan}" in
    plan) migration_print_plan;;
    sql) migration_emit_sql;;
    *) migration_error 'expected plan or sql'; exit 1;;
  esac
fi
