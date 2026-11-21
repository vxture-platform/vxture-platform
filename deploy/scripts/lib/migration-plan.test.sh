#!/usr/bin/env bash
# Real entry-point regressions with a Docker double and disposable fixture files.
# @package @vxture/repo
# @layer Infrastructure
# @category test
# @author AI-Generated
# @date 2026-11-20
set -euo pipefail
LIB_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$(cd "$LIB_DIR/../.." && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/vx-migration-test.XXXXXXXX")"
cleanup() {
  [[ -n "$T" && "$T" == "${TMPDIR:-/tmp}/vx-migration-test."* && -d "$T" && ! -L "$T" ]] || return 1
  rm -rf -- "$T"
}
trap cleanup EXIT
export FIXTURE="$T"
mkdir -p "$T/bin" "$T/deploy/scripts/lib" "$T/deploy/database/"{ddl,migrations,verify} "$T/runtime/secrets"
cp "$DEPLOY/scripts/28d-apply-migrations.sh" "$T/deploy/scripts/"
cp "$LIB_DIR/migration-plan.sh" "$T/deploy/scripts/lib/"
cp "$DEPLOY/database/verify/migration-cutover-preflight.sql" "$T/deploy/database/verify/"
printf 'SELECT 1;\n' > "$T/deploy/database/ddl/98_column_locks.sql"
printf 'SELECT 1;\n' > "$T/deploy/database/migrations/01-a.sql"
printf 'SELECT 2;\n' > "$T/deploy/database/migrations/01-b.sql"
printf 'SELECT 3;\n' > "$T/deploy/database/migrations/02-c.sql"
printf 'DATABASE_URL=postgresql://fixture-secret-never-print\n' > "$T/runtime/secrets/platform.env"
cat > "$T/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -eu
printf 'called\n' >> "$FIXTURE/calls"
cat > "$FIXTURE/sql"
[[ "${FAKE_DOCKER_FAIL:-}" != yes ]] || exit 86
[[ "${FAKE_RECEIPT_MISSING:-}" != yes ]] || exit 0
while IFS= read -r line; do
  case "$line" in
    '\echo MIGRATION_DONE='*|'\echo MIGRATION_CHANNEL_COMPLETE='*) printf '%s\n' "${line#'\echo '}";;
  esac
done < "$FIXTURE/sql"
DOCKER
chmod +x "$T/bin/docker"
export PATH="$T/bin:$PATH" RUNTIME_DIR="$T/runtime"
SCRIPT="$T/deploy/scripts/28d-apply-migrations.sh"
count=0
passed() { count=$((count+1)); printf 'ok %s - %s\n' "$count" "$1"; }
run_ok() { bash "$SCRIPT" "$@" > "$T/output" 2>&1 || { cat "$T/output"; exit 1; }; }
run_bad() { if bash "$SCRIPT" "$@" > "$T/output" 2>&1; then echo 'Expected rejection'; exit 1; fi; }
no_docker() { [[ ! -f "$T/calls" ]]; }
refresh_hash() { MIGRATE_PLAN_SHA256="$(bash "$SCRIPT" --plan | sed -n 's/^MIGRATION_PLAN_SHA256=//p')"; export MIGRATE_PLAN_SHA256; }
clear_calls() { rm -f "$T/calls" "$T/sql"; }

# ===========================================================================
# Scope, source and evidence gates must precede every Docker call.
# ===========================================================================
run_ok --plan; no_docker
grep -q '^MIGRATION_SELECTED_COUNT=3$' "$T/output"
passed 'preview never reads credentials or calls Docker'
MIGRATE_UNTIL=01 run_bad --plan; no_docker
passed 'ambiguous prefix is rejected'
MIGRATE_UNTIL=missing run_bad --plan; no_docker
MIGRATE_UNTIL='01;false' run_bad --plan; no_docker
passed 'unknown and malformed cutoffs are rejected'
MIGRATE_UNTIL=01-a run_ok --plan
grep -q '^MIGRATION_FULL=0$' "$T/output"
passed 'one unique prefix produces a partial plan'
run_bad; no_docker
passed 'apply requires explicit confirmation'
export CONFIRM_MIGRATE=yes
run_bad; no_docker
passed 'apply requires reviewed content hash'
refresh_hash
export MIGRATE_TARGET_SHA256="$(printf 'a%.0s' {1..64})"
export MIGRATE_BACKUP_SHA256="$(printf 'b%.0s' {1..64})"
export MIGRATE_RESTORE_EVIDENCE=isolated-restore MIGRATE_CUTOVER_EVIDENCE=isolated-cutover
export MIGRATE_WRITES_STOPPED=yes MIGRATE_RESTORE_VERIFIED=yes MIGRATE_QUIESCED_AT="$(date +%s)"
for key in MIGRATE_TARGET_SHA256 MIGRATE_BACKUP_SHA256 MIGRATE_RESTORE_EVIDENCE MIGRATE_CUTOVER_EVIDENCE MIGRATE_WRITES_STOPPED MIGRATE_RESTORE_VERIFIED MIGRATE_QUIESCED_AT; do
  (unset "$key"; run_bad; no_docker)
done
passed 'all evidence fields are mandatory before Docker'
MIGRATE_QUIESCED_AT="$(( $(date +%s)-3601 ))" run_bad; no_docker
MIGRATE_QUIESCED_AT="$(( $(date +%s)+120 ))" run_bad; no_docker
passed 'stale and future cutover evidence is rejected'
printf 'SELECT 4;\n' >> "$T/deploy/database/migrations/01-a.sql"
run_bad; no_docker
passed 'SQL changes invalidate a reviewed plan'
refresh_hash
printf 'SELECT 5;\n' >> "$T/deploy/database/ddl/98_column_locks.sql"
run_bad; no_docker
passed 'column grant changes invalidate a reviewed plan'
refresh_hash
MIGRATE_TIMEOUT_SECONDS=0 run_bad --plan
MIGRATE_RUN_TIMEOUT_SECONDS=invalid run_bad --plan
no_docker
passed 'invalid timeout policy is rejected'
for file in 2026-12-09-promotion-ownership-foundation.sql 2026-12-10-wallet-source-ledger.sql 2026-12-11-recharge-card-funding.sql; do printf 'SELECT 1;\n' > "$T/deploy/database/migrations/$file"; done
MIGRATE_UNTIL=2026-12-10 run_bad --plan; no_docker
passed 'voucher upgrades cannot stop between B02 and B11'

# ===========================================================================
# Actual entry, session boundaries, failure propagation and receipt validation.
# ===========================================================================
refresh_hash
run_ok
[[ -f "$T/calls" ]]
grep -Fq 'pg_try_advisory_lock' "$T/sql"
grep -Fq '\i /verify/migration-cutover-preflight.sql' "$T/sql"
grep -Fq '\i /column_locks.sql' "$T/sql"
if grep -q 'fixture-secret-never-print' "$T/output"; then echo 'Secret leaked'; exit 1; fi
passed 'complete plan uses one session, checks preflight and replays column grants'
clear_calls
FAKE_DOCKER_FAIL=yes run_bad
passed 'Docker or SQL failure cannot produce success'
clear_calls
FAKE_RECEIPT_MISSING=yes run_bad
passed 'zero exit without completion receipts is rejected'
clear_calls
export MIGRATE_UNTIL=01-a
refresh_hash
run_ok
grep -Fq 'COLUMN_LOCKS_DEFERRED_PARTIAL_PLAN' "$T/sql"
if grep -Fq '\i /column_locks.sql' "$T/sql"; then echo 'Future column grants executed on partial schema'; exit 1; fi
passed 'partial migration defers grants for the full schema'
printf 'S04_GATE_TESTS_PASSED=%s\n' "$count"
