#!/usr/bin/env bash
# Verify native preflight inside the existing workbench runtime without host writes.
# @package @vxture/repo
# @layer Infrastructure
# @category test
# @author AI-Generated
# @date 2026-11-23
set -euo pipefail
LIB_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$(cd "$LIB_DIR/../.." && pwd)"
fixture="$(mktemp -d)"
trap '[[ -n "$fixture" && -d "$fixture/runtime" ]] && rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/runtime"
export RUNTIME_DIR="$fixture/runtime"
. "$LIB_DIR/compose-env.sh"
load_workbench_desktop_env
test "$WORKBENCH_DESKTOP_ENABLED" = 0
validate_workbench_desktop_runtime "$DEPLOY"
printf 'PASS: browser-only runtime needs no desktop configuration\n'
cat > "$fixture/runtime/.env.workbench-bff" <<'EOF'
WORKBENCH_DESKTOP_ENABLED=1
WORKBENCH_BFF_PORT=3061
WORKBENCH_BASE_URL=https://ruyin.work
OIDC_CLIENT_ID=workbench
OIDC_ISSUER=https://accounts.vxture.com
OIDC_CLIENT_SECRET=fixture-browser-secret
RUYIN_BFF_BASE=https://api.ruyin.work
RUYIN_DESKTOP_OIDC_CLIENT_SECRET=fixture-native-secret
RUYIN_DESKTOP_SESSION_TTL=86400
EOF
printf 'OIDC_CLIENT_SECRET_HASH_RUYIN_DESKTOP=\x27$2b$12$%053d\x27\n' 1 > "$fixture/runtime/.env.auth-bff"
load_workbench_desktop_env
test "$WORKBENCH_DESKTOP_ENABLED" = 1
validate_workbench_desktop_runtime "$DEPLOY"
test ! -e "$fixture/runtime/.env.ruyin-bff"
printf 'PASS: native module uses the existing file and registered 3061 listener\n'
sed -i 's/^RUYIN_DESKTOP_OIDC_CLIENT_SECRET=.*/RUYIN_DESKTOP_OIDC_CLIENT_SECRET=fixture-browser-secret/' "$fixture/runtime/.env.workbench-bff"
if validate_workbench_desktop_runtime "$DEPLOY" >/dev/null 2>&1; then exit 1; fi
printf 'PASS: sharing browser credentials is rejected\n'
printf 'WORKBENCH_DESKTOP_ENABLED=invalid\n' > "$fixture/runtime/.env.workbench-bff"
if load_workbench_desktop_env >/dev/null 2>&1; then exit 1; fi
printf 'PASS: invalid activation flag fails closed\n'
eval "$(sed -n '/^check_ruyin_public_health() {$/,/^}$/p' "$DEPLOY/scripts/40-verify-platform-runtime.sh")"
curl() { printf '%s' "$health_fixture"; }
mark_fail() { health_failed=1; }
health_failed=0
health_fixture='{"status":"ok","service":"workbench-bff","product":"vxture"}'
check_ruyin_public_health >/dev/null
test "$health_failed" = 0
health_fixture='{"status":"ok","service":"console-bff","product":"vxture"}'
check_ruyin_public_health >/dev/null
test "$health_failed" = 1
printf 'PASS: public native health identifies the existing workbench service\n'
