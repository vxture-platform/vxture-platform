#!/usr/bin/env bash
# Exercise native ingress validation before any host or Docker mutation.
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
mkdir -p "$fixture/scripts/lib" "$fixture/guardrails" "$fixture/runtime" "$fixture/nginx/templates"
cp "$DEPLOY/scripts/20-sync-nginx-config.sh" "$fixture/scripts/"
cp "$DEPLOY/guardrails/39-audit-env.mjs" "$fixture/guardrails/"
cp "$LIB_DIR/compose-env.sh" "$LIB_DIR/env-values.sh" "$LIB_DIR/site-takeover.sh" "$fixture/scripts/lib/"
cp "$DEPLOY/compose.nginx.yml" "$fixture/"
cp "$DEPLOY/nginx/templates/ruyin-api.vhost.template" "$fixture/nginx/templates/"
touch "$fixture/nginx/nginx.conf"
printf 'idp_alias_sync() { echo PREFLIGHT_ACCEPTED; exit 0; }\n' > "$fixture/scripts/lib/nginx-idp-port.sh"
printf 'VX_WORKER01_TAILNET_IP=203.0.113.1\nVX_WORKER02_TAILNET_IP=203.0.113.2\n' > "$fixture/runtime/.env"
cat > "$fixture/runtime/.env.workbench-bff" <<'EOF'
WORKBENCH_DESKTOP_ENABLED=1
WORKBENCH_BFF_PORT=3061
WORKBENCH_BASE_URL=https://ruyin.work
OIDC_CLIENT_ID=workbench
OIDC_ISSUER=https://accounts.vxture.com
OIDC_CLIENT_SECRET=fixture-browser-secret
RUYIN_BFF_BASE=https://api.ruyin.work
RUYIN_DESKTOP_OIDC_CLIENT_SECRET=fixture-native-secret
EOF
printf 'OIDC_CLIENT_SECRET_HASH_RUYIN_DESKTOP=\x27$2b$12$%053d\x27\n' 1 > "$fixture/runtime/.env.auth-bff"
export RUNTIME_DIR="$fixture/runtime"
mkdir() { echo MUTATION_REACHED; }
export -f mkdir
check() {
  local expected="$1" output status=0
  output="$(bash "$fixture/scripts/20-sync-nginx-config.sh" 2>&1)" || status=$?
  if [ "$expected" = accept ]; then test "$status" = 0; [[ "$output" == *PREFLIGHT_ACCEPTED* ]];
  else test "$status" != 0; [[ "$output" != *PREFLIGHT_ACCEPTED* && "$output" != *MUTATION_REACHED* ]]; fi
  [[ "$output" != *fixture-native-secret* && "$output" != *fixture-browser-secret* ]]
}
check accept
sed -i 's/^RUYIN_DESKTOP_OIDC_CLIENT_SECRET=.*/RUYIN_DESKTOP_OIDC_CLIENT_SECRET=/' "$fixture/runtime/.env.workbench-bff"
check reject
sed -i 's/^WORKBENCH_DESKTOP_ENABLED=.*/WORKBENCH_DESKTOP_ENABLED=0/' "$fixture/runtime/.env.workbench-bff"
check accept
printf 'PASS: enabled native ingress validates its own credentials before host writes; browser-only mode remains available\n'
