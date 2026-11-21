#!/usr/bin/env bash
# Forward migrations with a reviewed plan and explicit cutover evidence.
# @package @vxture/repo
# @layer Infrastructure
# @category deployment-script
# @author AI-Generated
# @date 2026-11-20
# Preview: bash scripts/28d-apply-migrations.sh --plan
# Apply requires CONFIRM_MIGRATE=yes, MIGRATE_PLAN_SHA256 and the evidence
# validated by lib/migration-plan.sh. No service stop, restore or restamp occurs.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MIG_DIR="$COMPOSE_DIR/database/migrations"
source "$SCRIPT_DIR/lib/migration-plan.sh"

# ===========================================================================
# Validate exact bytes before reading credentials or starting Docker.
# ===========================================================================
migration_build_plan "$COMPOSE_DIR" "${MIGRATE_UNTIL:-}"
migration_print_plan
case "${1:-apply}" in
  --plan) exit 0;;
  apply) ;;
  *) migration_error 'expected --plan or apply'; exit 1;;
esac
migration_require_authorization
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"
PLATFORM_ENV="$RUNTIME_DIR/secrets/rds-owner.env"
[[ -f "$PLATFORM_ENV" ]] || PLATFORM_ENV="$RUNTIME_DIR/secrets/platform.env"
[[ -f "$PLATFORM_ENV" && ! -L "$PLATFORM_ENV" ]] || { migration_error 'runtime owner credentials missing or linked'; exit 1; }

# One client owns the lock through COMMITs and concurrent indexes. Timeout
# disconnects it, releasing its lock; committed earlier files remain committed.
log_dir="$(mktemp -d "${TMPDIR:-/tmp}/vx-migrate.XXXXXXXX")"
cleanup() {
  [[ -n "$log_dir" && "$log_dir" == "${TMPDIR:-/tmp}/vx-migrate."* && -d "$log_dir" && ! -L "$log_dir" ]] || return 1
  rm -rf -- "$log_dir"
}
trap cleanup EXIT
# Freeze the reviewed input bytes. A concurrent bundle sync must not change
# mounted migrations between preflight and execution.
snapshot="$log_dir/deploy"
mkdir -p "$snapshot/database/ddl" "$snapshot/database/verify" "$snapshot/scripts/lib"
cp -R "$MIG_DIR" "$snapshot/database/"
cp "$COMPOSE_DIR/database/ddl/"[0-9]*.sql "$snapshot/database/ddl/"
cp "$SCRIPT_DIR/28d-apply-migrations.sh" "$snapshot/scripts/"
cp "$SCRIPT_DIR/lib/migration-plan.sh" "$snapshot/scripts/lib/"
cp "$COMPOSE_DIR/database/verify/migration-cutover-preflight.sql" "$snapshot/database/verify/"
migration_build_plan "$snapshot" "${MIGRATE_UNTIL:-}"
migration_require_authorization
migration_emit_sql | docker run --rm -i \
  --network vxture-prod \
  --env-file "$PLATFORM_ENV" \
  --env MIGRATION_RUN_TIMEOUT="$MIGRATION_RUN_TIMEOUT" \
  --env MIGRATE_TARGET_SHA256="$MIGRATE_TARGET_SHA256" \
  --env MIGRATE_QUIESCED_AT="$MIGRATE_QUIESCED_AT" \
  -v "$snapshot/database/migrations:/migrations:ro" \
  -v "$snapshot/database/ddl/98_column_locks.sql:/column_locks.sql:ro" \
  -v "$snapshot/database/verify/migration-cutover-preflight.sql:/verify/migration-cutover-preflight.sql:ro" \
  postgres:18-alpine sh -c '
    exec timeout "$MIGRATION_RUN_TIMEOUT" psql "$DATABASE_URL" -X --no-password -v ON_ERROR_STOP=1 \
      -v target_sha256="$MIGRATE_TARGET_SHA256" -v quiesced_at="$MIGRATE_QUIESCED_AT"
  ' | tee "$log_dir/output"
grep -Fxq "MIGRATION_CHANNEL_COMPLETE=$MIGRATION_PLAN_SHA256" "$log_dir/output" || { migration_error 'completion receipt missing'; exit 1; }
[[ "$(grep -c '^MIGRATION_DONE=' "$log_dir/output")" == "${#MIGRATION_SELECTED[@]}" ]] || { migration_error 'incomplete migration receipts'; exit 1; }
printf 'Migration apply complete; full=%s. Keep writes stopped pending structural verification and separately confirmed baseline restamp.\n' "$MIGRATION_FULL"
