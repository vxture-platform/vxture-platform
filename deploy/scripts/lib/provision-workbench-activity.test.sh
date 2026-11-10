#!/usr/bin/env bash
# Exercise activity provisioning without connecting to any real database.
# @package @vxture/repo
# @layer Infrastructure
# @category deployment-test
# @author AI-Generated
# @date 2026-11-11
set -euo pipefail
SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/33-provision-workbench-activity.sh"
TEST_ROOT="$(mktemp -d)"
case "$TEST_ROOT" in /tmp/*|/var/tmp/*) ;; *) echo "Unexpected test directory" >&2; exit 1 ;; esac
trap 'rm -rf -- "$TEST_ROOT"' EXIT
mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/runtime/secrets"
export RUNTIME_DIR="$TEST_ROOT/runtime"
export ACTIVITY_TEST_ROOT="$TEST_ROOT"
export PATH="$TEST_ROOT/bin:$PATH"
printf 'DATABASE_URL=postgresql://owner:fixture@db.invalid/db\n' > "$RUNTIME_DIR/secrets/rds-owner.env"
printf 'EXISTING_KEY=keep\n' > "$RUNTIME_DIR/.env.workbench-bff"
cat > "$TEST_ROOT/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail
if [[ " $* " == *" -i "* ]]; then
  cat > "$ACTIVITY_TEST_ROOT/applied.sql"
else
  printf '%s\n' "${ACTIVITY_TEST_ROLE_EXISTS:-0}"
fi
DOCKER
chmod +x "$TEST_ROOT/bin/docker"

# ============================================================================
# Operational gates and credential preparation
# ============================================================================
if bash "$SCRIPT" > "$TEST_ROOT/log" 2>&1; then echo "Missing gate accepted" >&2; exit 1; fi
test ! -f "$RUNTIME_DIR/secrets/rds-pw-svc_workbench_activity"
CONFIRM_PROVISION_WORKBENCH_ACTIVITY=yes PREPARE_ONLY=yes bash "$SCRIPT" > "$TEST_ROOT/log"
test -s "$RUNTIME_DIR/secrets/rds-pw-svc_workbench_activity"
test ! -f "$TEST_ROOT/applied.sql"
test "$(cat "$RUNTIME_DIR/.env.workbench-bff")" = "EXISTING_KEY=keep"

# ============================================================================
# Apply after the independently executed migration; repeat without rotating keys
# ============================================================================
export ACTIVITY_TEST_ROLE_EXISTS=1
CONFIRM_PROVISION_WORKBENCH_ACTIVITY=yes bash "$SCRIPT" > "$TEST_ROOT/log"
grep -q '^EXISTING_KEY=keep$' "$RUNTIME_DIR/.env.workbench-bff"
grep -q '^WORKBENCH_ACTIVITY_DATABASE_URL=postgresql://svc_workbench_activity:' "$RUNTIME_DIR/.env.workbench-bff"
grep -q 'GRANT INSERT (user_id, tenant_id, workspace_id, product_id, event_id)' "$TEST_ROOT/applied.sql"
if grep -q 'svc_workbench_inbox\|CREATE TABLE\|DROP TABLE' "$TEST_ROOT/applied.sql"; then echo "Unrelated SQL applied" >&2; exit 1; fi
cp "$RUNTIME_DIR/.env.workbench-bff" "$TEST_ROOT/env-before"
cp "$RUNTIME_DIR/secrets/rds-pw-svc_workbench_activity" "$TEST_ROOT/password-before"
CONFIRM_PROVISION_WORKBENCH_ACTIVITY=yes bash "$SCRIPT" > "$TEST_ROOT/log"
cmp "$TEST_ROOT/env-before" "$RUNTIME_DIR/.env.workbench-bff"
cmp "$TEST_ROOT/password-before" "$RUNTIME_DIR/secrets/rds-pw-svc_workbench_activity"

# Lost credentials must never silently rotate an existing database role.
rm "$RUNTIME_DIR/secrets/rds-pw-svc_workbench_activity"
if CONFIRM_PROVISION_WORKBENCH_ACTIVITY=yes bash "$SCRIPT" > "$TEST_ROOT/log" 2>&1; then echo "Credential loss accepted" >&2; exit 1; fi
cmp "$TEST_ROOT/env-before" "$RUNTIME_DIR/.env.workbench-bff"
echo "Activity provisioning gates, preparation, least privilege and repeatability passed."
