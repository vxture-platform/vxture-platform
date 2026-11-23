#!/usr/bin/env bash
# provision-ruyin-client.test.sh - Resolve native backend secrets without issuing keys.
# @package @vxture/repo
# @layer Infrastructure
# @category deployment-test
# @author AI-Generated
# @date 2026-11-22
set -euo pipefail
SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/27-provision-client-secrets.sh"
# Exercise the actual resolver function only. Never source the provisioning entry point.
eval "$(sed -n '/^env_file_for() {$/,/^}$/p' "$SCRIPT")"
eval "$(sed -n '/^secret_key_for() {$/,/^}$/p' "$SCRIPT")"
test "$(secret_key_for ruyin-desktop)" = RUYIN_DESKTOP_OIDC_CLIENT_SECRET
test "$(secret_key_for workbench)" = OIDC_CLIENT_SECRET
RUNTIME_DIR=/isolated-runtime
test "$(env_file_for ruyin-desktop)" = /isolated-runtime/.env.workbench-bff
test "$(env_file_for console)" = /isolated-runtime/.env.console-bff
test "$(env_file_for workbench)" = /isolated-runtime/.env.workbench-bff
test "$(env_file_for ruyin)" = /isolated-runtime/.env.ruyin-bff
test "$(env_file_for ruyin-beta)" = /isolated-runtime/.env.ruyin-beta-bff
test "$(env_file_for platform-api)" = /isolated-runtime/.env.platform-api
WORKBENCH_BFF_ENV_FILE=/isolated-custom/desktop.env
PLATFORM_API_ENV_FILE=/isolated-custom/platform.env
test "$(env_file_for ruyin-desktop)" = /isolated-custom/desktop.env
test "$(env_file_for console)" = /isolated-runtime/.env.console-bff
test "$(env_file_for platform-api)" = /isolated-custom/platform.env
echo "Desktop confidential-client mapping and existing mappings passed; no provisioning executed."

# ============================================================================
# Exercise catalog discovery's actual nested shell/Node command without Docker
# ============================================================================
TEST_ROOT="$(mktemp -d)"
case "$TEST_ROOT" in /tmp/*|/var/tmp/*) ;; *) echo "Unexpected test directory" >&2; exit 1 ;; esac
trap 'rm -rf -- "$TEST_ROOT"' EXIT
mkdir -p "$TEST_ROOT/node_modules/pg"
cat > "$TEST_ROOT/node_modules/pg/index.js" <<'JS'
const assert = require('node:assert/strict');
exports.Client = class {
  async connect() {}
  async end() {}
  async query(sql, params) {
    assert.ok(sql.includes("status = 'active'"));
    assert.ok(sql.includes("token_endpoint_auth_method = 'client_secret_basic'"));
    assert.ok(sql.includes('$1::text[]'));
    const catalog = ['console','ruyin-desktop','workbench'];
    const selected = params[0];
    return { rows: catalog.filter(id => !selected || selected.includes(id)).map(client_id => ({client_id})) };
  }
};
JS
eval "$(sed -n '/^discover_clients() {$/,/^}$/p' "$SCRIPT")"
DB_TOOL_CACHE_DIR="$TEST_ROOT/cache"
docker() {
  # Execute only the discovered read command, using a local pg protocol fixture.
  local command="${!#}"
  command="${command//\/tmp\/vxture-db/$TEST_ROOT}"
  bash -c "$command"
}
test "$(discover_clients)" = $'console\nruyin-desktop\nworkbench'
CLIENT_IDS_OVERRIDE=ruyin-desktop
export CLIENT_IDS_OVERRIDE
test "$(discover_clients)" = ruyin-desktop
CLIENT_IDS_OVERRIDE='ruyin-desktop ruyin-desktop'
test "$(discover_clients)" = ruyin-desktop
CLIENT_IDS_OVERRIDE=ruyin
if discover_clients > "$TEST_ROOT/output" 2> "$TEST_ROOT/error"; then
  echo "Public client override accepted" >&2; exit 1
fi
test ! -s "$TEST_ROOT/output"
grep -q 'Only registered active confidential clients' "$TEST_ROOT/error"
echo "Real shell/Node discovery excludes public clients and validates overrides."
