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
mkdir -p "$fixture/scripts/lib" "$fixture/nginx/templates" "$fixture/runtime"
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
export CUSTOMER_PORTAL_ENV_FILE="$fixture/runtime/.env.tenant-bff"
export VX_WORKER01_TAILNET_IP=127.0.0.1 VX_WORKER02_TAILNET_IP=127.0.0.2

check() {
  local expected="$1" value="$2" label="$3" result
  printf '%b' "$value" > "$CUSTOMER_PORTAL_ENV_FILE"
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

check accept 'CUSTOMER_PORTAL_HOSTS=a.ruyin.work\n' 'plain production host'
check accept "CUSTOMER_PORTAL_HOSTS='a.ruyin.work'\n" 'single-quoted production host'
check accept 'CUSTOMER_PORTAL_HOSTS="a.ruyin.work"\n' 'double-quoted host'
check accept ' CUSTOMER_PORTAL_HOSTS = "a.ruyin.work" \r\n' 'surrounding whitespace and CRLF'
check accept 'CUSTOMER_PORTAL_HOSTS=a.ruyin.work,studio.ruyin.work\n' 'multiple exact hosts'
check accept 'CUSTOMER_PORTAL_HOSTS=old.invalid\nCUSTOMER_PORTAL_HOSTS=a.ruyin.work\n' 'last assignment wins'
check accept 'CUSTOMER_PORTAL_HOSTS=""\n' 'explicitly disabled portals'
check reject 'CUSTOMER_PORTAL_HOSTS=admin.ruyin.work\n' 'reserved host remains rejected'
check reject 'CUSTOMER_PORTAL_HOSTS=a.ruyin.work,a.ruyin.work\n' 'duplicate host remains rejected'
check reject 'CUSTOMER_PORTAL_HOSTS=a.ruyin.work;echo injected\n' 'shell content remains rejected'
check reject 'CUSTOMER_PORTAL_HOSTS=a.ruyin.work.evil.example\n' 'foreign suffix remains rejected'
rm "$fixture/nginx/templates/customer-portal.vhost.template"
check reject 'CUSTOMER_PORTAL_HOSTS=a.ruyin.work\n' 'missing template remains rejected'
