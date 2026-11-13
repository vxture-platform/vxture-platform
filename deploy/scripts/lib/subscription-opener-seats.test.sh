#!/usr/bin/env bash
# Verify targeted production repair selection and fail-closed execution.
# @package @vxture/repo
# @layer Infrastructure
# @category test
# @author AI-Generated
# @date 2026-11-13
set -euo pipefail
DEPLOY_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FX="$(mktemp -d)"
trap 'rm -rf "$FX"' EXIT
mkdir -p "$FX/bin" "$FX/runtime/secrets"
touch "$FX/runtime/secrets/rds-owner.env"
export MOCK_CALLS="$FX/calls" RUNTIME_DIR="$FX/runtime"
export OPENER_SEAT_SNAPSHOT_DIR="$FX/snapshot"
export PATH="$FX/bin:$PATH"
cat > "$FX/bin/docker" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$MOCK_CALLS"
if [ -n "${MOCK_FAIL:-}" ] && [[ "$*" == *"$MOCK_FAIL"* ]]; then exit 9; fi
echo 'mock SQL completed'
MOCK
chmod +x "$FX/bin/docker"
SCRIPT="$DEPLOY_ROOT/scripts/32-subscription-opener-seats.sh"

# Targeted workflow exits before shared deploy synchronization and honors runtime layout.
WORKFLOW="$DEPLOY_ROOT/../.github/workflows/db-init.yml"
sed -n '/SRC="${STAGE_DIR:?}\/deploy"/,/DEPLOY_DIR="${DEPLOY_DIR:/p' "$WORKFLOW" > "$FX/targeted-workflow"
grep -q 'opener-seats-preflight|opener-seats-repair)' "$FX/targeted-workflow"
grep -q 'RUNTIME_DIR="${DEPLOY_RUNTIME_DIR:-/srv/vxture/runtime}"' "$FX/targeted-workflow"
grep -q 'bash "$SRC/scripts/32-subscription-opener-seats.sh" preflight' "$FX/targeted-workflow"
grep -q 'exit 0' "$FX/targeted-workflow"
if grep -q 'mkdir\|rm -rf\|cp -R' "$FX/targeted-workflow"; then
  echo 'Targeted action mutates shared deployment files'; exit 1
fi

# Preflight is read-only and repair requires explicit authorization.
if bash "$SCRIPT" repair > "$FX/out" 2>&1; then echo 'Unconfirmed repair passed'; exit 1; fi
[ ! -s "$MOCK_CALLS" ]
if bash "$SCRIPT" invalid > "$FX/out" 2>&1; then echo 'Invalid mode passed'; exit 1; fi
[ ! -s "$MOCK_CALLS" ]
bash "$SCRIPT" preflight > "$FX/out"
[ "$(wc -l < "$MOCK_CALLS")" -eq 1 ]
grep -q '/database/verify/subscription-opener-seats.sql' "$MOCK_CALLS"
[ -s "$OPENER_SEAT_SNAPSHOT_DIR/preflight.txt" ]

# Exactly two fixed migrations, no general replay or seed path.
: > "$MOCK_CALLS"
CONFIRM_OPENER_SEATS=yes bash "$SCRIPT" repair > "$FX/out"
[ "$(wc -l < "$MOCK_CALLS")" -eq 4 ]
sed -n '2p' "$MOCK_CALLS" | grep -q '/migrations/2026-11-15-subscription-opener-seats-01-install.sql'
sed -n '3p' "$MOCK_CALLS" | grep -q '/migrations/2026-11-15-subscription-opener-seats-02-backfill.sql'
sed -n '4p' "$MOCK_CALLS" | grep -q '/verify/subscription-opener-seats.sql'
[ -s "$OPENER_SEAT_SNAPSHOT_DIR/backfill.txt" ]
[ -s "$OPENER_SEAT_SNAPSHOT_DIR/after.txt" ]

# SQL errors propagate through tee and prevent subsequent execution.
: > "$MOCK_CALLS"
if CONFIRM_OPENER_SEATS=yes MOCK_FAIL=01-install.sql bash "$SCRIPT" repair > "$FX/out" 2>&1; then
  echo 'Failed installation was ignored'; exit 1
fi
[ "$(wc -l < "$MOCK_CALLS")" -eq 2 ]
echo 'Subscription opener targeted runner checks passed'
