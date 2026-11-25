#!/usr/bin/env bash
# Run the real Nginx preflight without writing any host configuration.
# @package @vxture/repo
# @layer Infrastructure
# @category test
# @author AI-Generated
# @date 2026-11-17
set -euo pipefail

LIB_DIR="$(cd "$(dirname "$0")" && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/scripts/lib" "$fixture/nginx/templates" "$fixture/runtime/customer-portal-releases" "$fixture/nginxconf/sites-enabled"
cp "$LIB_DIR/../20-sync-nginx-config.sh" "$fixture/scripts/"
cp "$LIB_DIR/compose-env.sh" "$LIB_DIR/env-values.sh" "$LIB_DIR/site-takeover.sh" "$fixture/scripts/lib/"
touch "$fixture/nginx/nginx.conf" "$fixture/compose.nginx.yml"
touch "$fixture/nginx/templates/customer-portal.vhost.template"

# Stop after all portal validation, before the first configuration mutation.
cat > "$fixture/scripts/lib/nginx-idp-port.sh" <<'SH'
idp_alias_sync() { echo 'PREFLIGHT_ACCEPTED'; exit 0; }
SH
# The real script prepares directories before validation; contain those writes.
mkdir() { :; }
export -f mkdir
export RUNTIME_DIR="$fixture/runtime"
export NGINX_CONFIG_DIR="$fixture/nginxconf"
export CUSTOMER_PORTAL_ENV_FILE="$fixture/runtime/.env.tenant-bff"
export VX_WORKER01_TAILNET_IP=127.0.0.1 VX_WORKER02_TAILNET_IP=127.0.0.2

run_check() {
  local expected="$1" label="$2" result
  if result="$(bash "$fixture/scripts/20-sync-nginx-config.sh" 2>&1)"; then
    [ "$expected" = accept ] && [[ "$result" == *PREFLIGHT_ACCEPTED* ]] || {
      echo "FAIL: $label unexpectedly passed" >&2; exit 1;
    }
  else
    [ "$expected" = reject ] && [[ "$result" != *PREFLIGHT_ACCEPTED* ]] || {
      echo "FAIL: $label: $result" >&2; exit 1;
    }
  fi
  echo "PASS: $label"
}
check() {
  printf '%b' "$2" > "$CUSTOMER_PORTAL_ENV_FILE"
  run_check "$1" "$3"
}

# ============================================================================
# Fresh hosts and host-list syntax remain supported without legacy env aliases.
# ============================================================================
run_check reject 'explicit env path cannot be silently ignored'
unset CUSTOMER_PORTAL_ENV_FILE
run_check accept 'fresh host without a portal remains supported'
export CUSTOMER_PORTAL_ENV_FILE="$fixture/runtime/.env.tenant-bff"

check accept 'CUSTOMER_PORTAL_HOSTS=a.ruyin.work\n' 'plain production host'
check accept "CUSTOMER_PORTAL_HOSTS='a.ruyin.work'\n" 'single-quoted production host'
check accept 'CUSTOMER_PORTAL_HOSTS="a.ruyin.work"\n' 'double-quoted host'
check accept ' CUSTOMER_PORTAL_HOSTS = "a.ruyin.work" \r\n' 'surrounding whitespace and CRLF'
check accept 'CUSTOMER_PORTAL_HOSTS=a.ruyin.work,studio.ruyin.work\n' 'multiple exact hosts'
check accept 'CUSTOMER_PORTAL_HOSTS=old.invalid\nCUSTOMER_PORTAL_HOSTS=a.ruyin.work\n' 'last assignment wins'
check accept 'CUSTOMER_PORTAL_HOSTS=""\n' 'empty host list on a fresh host'
check reject 'CUSTOMER_PORTAL_HOSTS=admin.ruyin.work\n' 'reserved host remains rejected'
check reject 'CUSTOMER_PORTAL_HOSTS=a.ruyin.work,a.ruyin.work\n' 'duplicate host remains rejected'
check reject 'CUSTOMER_PORTAL_HOSTS=a.ruyin.work;echo injected\n' 'shell content remains rejected'
check reject 'CUSTOMER_PORTAL_HOSTS=a.ruyin.work.evil.example\n' 'foreign suffix remains rejected'

# ============================================================================
# Existing routes and managed release records prevent silent portal removal.
# ============================================================================
printf 'existing-route\n' > "$NGINX_CONFIG_DIR/sites-enabled/customer-portal-a.conf"
rm "$CUSTOMER_PORTAL_ENV_FILE"
unset CUSTOMER_PORTAL_ENV_FILE
run_check reject 'installed route requires the default Tenant env'
export CUSTOMER_PORTAL_ENV_FILE="$fixture/runtime/.env.tenant-bff"
check reject '# missing host key\n' 'installed route requires the host key'
check reject 'CUSTOMER_PORTAL_HOSTS=""\n' 'installed route rejects an empty host list'
check accept 'CUSTOMER_PORTAL_HOSTS=a.ruyin.work\n' 'installed portal with a complete config passes'
[[ "$(cat "$NGINX_CONFIG_DIR/sites-enabled/customer-portal-a.conf")" == existing-route ]]
rm "$NGINX_CONFIG_DIR/sites-enabled/customer-portal-a.conf"
printf 'managed-release\n' > "$RUNTIME_DIR/customer-portal-releases/current"
rm "$CUSTOMER_PORTAL_ENV_FILE"
unset CUSTOMER_PORTAL_ENV_FILE
run_check reject 'managed release requires config even when the vhost is already missing'
export CUSTOMER_PORTAL_ENV_FILE="$fixture/runtime/.env.tenant-bff"
check reject 'CUSTOMER_PORTAL_HOSTS=\n' 'managed release rejects an empty host list'
check accept 'CUSTOMER_PORTAL_HOSTS=a.ruyin.work\n' 'managed release with exact hosts passes'
[[ "$(cat "$RUNTIME_DIR/customer-portal-releases/current")" == managed-release ]]
rm "$fixture/nginx/templates/customer-portal.vhost.template"
check reject 'CUSTOMER_PORTAL_HOSTS=a.ruyin.work\n' 'missing template remains rejected'
