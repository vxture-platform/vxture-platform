#!/usr/bin/env bash
# Verify convergence against real deployment entry points and the image classifier.
# @package @vxture/repo
# @layer Infrastructure
# @category test
# @author AI-Generated
# @date 2026-11-23
set -euo pipefail
LIB_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$(cd "$LIB_DIR/../.." && pwd)"
fixture="$(mktemp -d)"
trap '[[ -n "$fixture" && -d "$fixture/scripts" ]] && rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/scripts/lib" "$fixture/guardrails" "$fixture/runtime" "$fixture/bin"
cp "$DEPLOY/scripts/33-recreate-service.sh" "$fixture/scripts/"
cp "$LIB_DIR/compose-env.sh" "$LIB_DIR/nginx-idp-port.sh" "$fixture/scripts/lib/"
cp "$DEPLOY/guardrails/39-audit-env.mjs" "$fixture/guardrails/"
cp "$DEPLOY/compose.platform.yml" "$fixture/"
printf 'VX_WORKER01_TAILNET_IP=203.0.113.1\nVX_WORKER02_TAILNET_IP=203.0.113.2\n' > "$fixture/runtime/.env"
printf '#!/usr/bin/env bash\nprintf called >> "$RUYIN_TEST_DOCKER_CALL_FILE"\necho DOCKER_REACHED >&2; exit 98\n' > "$fixture/bin/docker"
chmod +x "$fixture/bin/docker"
export RUYIN_TEST_DOCKER_CALL_FILE="$fixture/docker-called"
run() {
  local output status=0
  rm -f -- "$RUYIN_TEST_DOCKER_CALL_FILE"
  output="$(PATH="$fixture/bin:$PATH" RUNTIME_DIR="$fixture/runtime" bash "$fixture/scripts/33-recreate-service.sh" "$1" 2>&1)" || status=$?
  test "$status" != 0
  test ! -e "$RUYIN_TEST_DOCKER_CALL_FILE"
  [[ "$output" != *DOCKER_REACHED* ]]
}
run ruyin-bff
printf 'PASS: obsolete standalone service cannot be recreated\n'
printf 'WORKBENCH_DESKTOP_ENABLED=1\n' > "$fixture/runtime/.env.workbench-bff"
run workbench-bff
printf 'PASS: invalid native activation stops the existing service recreation before Docker\n'
printf 'WORKBENCH_DESKTOP_ENABLED=invalid\n' > "$fixture/runtime/.env.workbench-bff"
output=''
status=0
output="$(PATH="$fixture/bin:$PATH" RUNTIME_DIR="$fixture/runtime" bash "$fixture/scripts/33-recreate-service.sh" console-bff 2>&1)" || status=$?
test "$status" != 0
test -e "$RUYIN_TEST_DOCKER_CALL_FILE"
[[ "$output" != *WORKBENCH_DESKTOP_ENABLED* ]]
run workbench-bff
printf 'PASS: broken native configuration does not block unrelated service repairs\n'
for entry in 30-deploy-platform-stack.sh 33-recreate-service.sh 40-verify-platform-runtime.sh 51-check-platform-alerts.sh; do
  ! grep -q 'compose.ruyin.yml\|vx-platform-ruyin-bff\|RUYIN_BFF_PORT' "$DEPLOY/scripts/$entry"
done
! grep -q 'platform_bff-ruyin' "$DEPLOY/../scripts/workflows/images.mjs"
printf 'PASS: deployment uses the original service set and image without an overlay or new listener\n'
