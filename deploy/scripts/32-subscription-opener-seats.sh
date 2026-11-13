#!/usr/bin/env bash
# Targeted opener-seat preflight/repair; never replays unrelated migrations.
# @package @vxture/repo
# @layer Infrastructure
# @category deployment-script
# @author AI-Generated
# @date 2026-11-13
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"
DB_ENV="$RUNTIME_DIR/secrets/rds-owner.env"
[ -f "$DB_ENV" ] || DB_ENV="$RUNTIME_DIR/secrets/platform.env"
ACTION="${1:-preflight}"
case "$ACTION" in
  preflight) ;;
  repair)
    [ "${CONFIRM_OPENER_SEATS:-}" = yes ] || { echo 'CONFIRM_OPENER_SEATS=yes required' >&2; exit 1; }
    ;;
  *) echo 'Expected preflight or repair' >&2; exit 2 ;;
esac
[ -f "$DB_ENV" ] || { echo 'Database environment missing' >&2; exit 1; }

# Only fixed repository paths are accepted; credentials stay inside the container.
run_sql() {
  docker run --rm --network vxture-prod --env-file "$DB_ENV" \
    -v "$DEPLOY_ROOT/database:/database:ro" postgres:18-alpine \
    sh -c 'exec psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$1"' sh "$1"
}
umask 077
SNAPSHOT_DIR="${OPENER_SEAT_SNAPSHOT_DIR:-/srv/vxture/backups/subscription-opener-seats/$(date -u +%Y%m%dT%H%M%SZ)-$$}"
mkdir -p "$SNAPSHOT_DIR"
echo "Snapshot directory: $SNAPSHOT_DIR"
run_sql /database/verify/subscription-opener-seats.sql | tee "$SNAPSHOT_DIR/preflight.txt"
if [ "$ACTION" = repair ]; then
  run_sql /database/migrations/2026-11-15-subscription-opener-seats-01-install.sql | tee "$SNAPSHOT_DIR/install.txt"
  run_sql /database/migrations/2026-11-15-subscription-opener-seats-02-backfill.sql | tee "$SNAPSHOT_DIR/backfill.txt"
  run_sql /database/verify/subscription-opener-seats.sql | tee "$SNAPSHOT_DIR/after.txt"
fi
