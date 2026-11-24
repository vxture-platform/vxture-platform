#!/usr/bin/env bash
# Dedicated portal deployment; database and ingress changes are separate actions.
# @package @vxture/repo
# @layer Infrastructure
# @category deployment-script
# @author AI-Generated
# @date 2026-11-15
# Usage: bash scripts/36-deploy-customer-portal.sh check|deploy FRONTEND@sha256:... BFF@sha256:...
#        bash scripts/36-deploy-customer-portal.sh rollback
# Rollback restores images using current runtime settings, not old secrets or schemas.
set -euo pipefail
umask 077

# ===========================================================================
# Configuration and validation
# ===========================================================================
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=deploy/scripts/lib/env-values.sh
. "$SCRIPT_DIR/lib/env-values.sh"
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"
ENV_FILE="${CUSTOMER_PORTAL_ENV_FILE:-$RUNTIME_DIR/.env.tenant-bff}"
STATE_DIR="$RUNTIME_DIR/customer-portal-releases"
action="${1:-}"
fail() { echo "customer-portal: $*" >&2; exit 1; }
case "$action" in check|deploy) [ "$#" -eq 3 ] || fail 'Expected frontend and BFF digest references' ;;
  rollback) [ "$#" -eq 1 ] || fail 'Rollback takes no image arguments' ;;
  *) fail 'Usage: check|deploy FRONTEND@sha256:... BFF@sha256:... | rollback' ;;
esac
[ -f "$ENV_FILE" ] || fail 'Dedicated runtime env file is missing'
for key in TENANT_BFF_TOKEN CUSTOMER_PORTAL_DATABASE_URL CUSTOMER_PORTAL_REDIS_URL OIDC_ISSUER OIDC_CLIENT_ID OIDC_CLIENT_SECRET; do
  [ -n "$(env_value "$ENV_FILE" "$key")" ] || fail "Missing runtime key: $key"
  # The dedicated env file is authoritative, independent of the caller's shell.
  unset "$key"
done
unset OIDC_BACKCHANNEL_ISSUER CUSTOMER_PORTAL_FRONTEND_IMAGE TENANT_BFF_IMAGE
valid_ref() { [[ "$1" =~ ^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$ ]]; }
valid_tenant_ref() { valid_ref "$1" && [[ "$1" =~ (^|/)platform_bff-tenant@sha256: ]]; }
read_pair() {
  local file="$1"
  [ -f "$file" ] || fail 'No previous release is recorded'
  mapfile -t pair < "$file"
  [ "${#pair[@]}" -eq 2 ] || fail 'Invalid release record'
  frontend="${pair[0]}"; bff="${pair[1]}"
}

# ===========================================================================
# Serialized deployment and immutable image selection
# ===========================================================================
if [ "$action" != check ]; then
  mkdir -p "$STATE_DIR"
  exec 9>"$STATE_DIR/deploy.lock"
  flock -n 9 || fail 'Another customer portal deployment is running'
fi
if [ "$action" = rollback ]; then read_pair "$STATE_DIR/previous";
else frontend="$2"; bff="$3"; fi
if ! valid_ref "$frontend" || ! valid_ref "$bff"; then
  fail 'Only lowercase repository@sha256:<64 hex> references are accepted'
fi
# Runtime keys belong to this BFF identity; cross-identity rollback is incompatible.
valid_tenant_ref "$bff" || fail 'The BFF image repository must be platform_bff-tenant'
export CUSTOMER_PORTAL_FRONTEND_IMAGE="$frontend" TENANT_BFF_IMAGE="$bff"
compose=(docker compose --project-name vx-customer-portal --env-file "$ENV_FILE" -f "$DEPLOY_DIR/compose.customer-portal.yml")
"${compose[@]}" config --quiet >/dev/null 2>&1 || fail 'Compose configuration is invalid; check the dedicated env file'
docker network inspect vxture-prod >/dev/null 2>&1 || fail 'External ingress network vxture-prod is missing'
if [ "$action" = check ]; then echo 'Customer portal configuration and digest references are valid; no services changed.'; exit 0; fi

previous=()
for service in frontend bff; do
  id="$("${compose[@]}" ps --all -q "$service")"
  if [ -n "$id" ]; then
    ref="$(docker inspect --format '{{.Config.Image}}' "$id")"
    valid_ref "$ref" || fail 'Existing portal containers must use digest references before managed upgrades'
    if [ "$service" = bff ]; then
      valid_tenant_ref "$ref" || fail 'Existing BFF image uses another identity; managed recovery requires platform_bff-tenant'
    fi
    docker image inspect "$ref" >/dev/null 2>&1 || fail 'Previous portal image is unavailable locally for rollback'
    previous+=("$ref")
  fi
done
[ "${#previous[@]}" -ne 1 ] || fail 'Partial portal stack detected; repair it before upgrading'
if [ "$action" = rollback ]; then
  # An offline rollback must not depend on registry availability.
  docker image inspect "$frontend" "$bff" >/dev/null 2>&1 || fail 'Rollback images are unavailable locally'
else
  "${compose[@]}" pull frontend bff || fail 'Image pull failed; existing services were not changed'
fi

# ===========================================================================
# Apply, health gate, and recovery
# ===========================================================================
tmp="$(mktemp -d "$STATE_DIR/.release.XXXXXX")"
trap 'rm -f "$tmp/current" "$tmp/previous"; rmdir "$tmp"' EXIT
if [ "${#previous[@]}" -eq 2 ]; then
  printf '%s\n' "${previous[@]}" > "$tmp/previous"
  mv "$tmp/previous" "$STATE_DIR/previous"
fi
if ! "${compose[@]}" up -d --no-build --pull never --wait --wait-timeout 90 frontend bff; then
  if [ "${#previous[@]}" -eq 2 ]; then
    export CUSTOMER_PORTAL_FRONTEND_IMAGE="${previous[0]}" TENANT_BFF_IMAGE="${previous[1]}"
    if "${compose[@]}" up -d --no-build --pull never --wait --wait-timeout 90 frontend bff; then
      fail 'New release failed its health gate; previous portal images were restored'
    fi
    fail 'New release and automatic recovery failed; operator intervention is required'
  fi
  fail 'First deployment failed its health gate; no prior portal release exists'
fi
printf '%s\n' "$frontend" "$bff" > "$tmp/current"
mv "$tmp/current" "$STATE_DIR/current"
echo 'Customer portal release is healthy. Database, ingress and other stacks were not changed.'
