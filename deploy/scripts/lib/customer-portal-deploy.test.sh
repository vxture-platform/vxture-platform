#!/usr/bin/env bash
# Exercise the real deployment script using a deterministic Docker double.
# @package @vxture/repo
# @layer Infrastructure
# @category test
# @author AI-Generated
# @date 2026-11-15
set -euo pipefail
LIB_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$LIB_DIR/../36-deploy-customer-portal.sh"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/runtime"
export FIXTURE="$T"
export RUNTIME_DIR="$T/runtime"
export CUSTOMER_PORTAL_ENV_FILE="$T/runtime/portal.env"
export PATH="$T/bin:$PATH"
f="registry.test/portal_frontend@sha256:$(printf 'a%.0s' {1..64})"
b="registry.test/platform_bff-tenant@sha256:$(printf 'b%.0s' {1..64})"
old_f="registry.test/portal_frontend@sha256:$(printf 'c%.0s' {1..64})"
old_b="registry.test/platform_bff-tenant@sha256:$(printf 'd%.0s' {1..64})"

# ===========================================================================
# Docker boundary and isolated fixtures
# ===========================================================================
cat > "$T/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$FIXTURE/calls"
if [ "$1" = network ]; then [ ! -f "$FIXTURE/no-network" ]; exit; fi
if [ "$1" = image ]; then [ ! -f "$FIXTURE/no-image" ]; exit; fi
if [ "$1" = inspect ]; then
  name="${@: -1}"
  cat "$FIXTURE/$name"
  exit
fi
[ "$1" = compose ] || exit 98
shift
[ "$1" = --project-name ] && [ "$2" = vx-customer-portal ] || exit 97
shift 2
[ "$1" = --env-file ] || exit 96
shift 2
[ "$1" = -f ] && [[ "$2" = */compose.customer-portal.yml ]] || exit 95
shift 2
case "$1" in
  config)
    [ -z "${TENANT_BFF_TOKEN+x}" ] && [ -z "${OIDC_CLIENT_SECRET+x}" ] || exit 92
    [ ! -f "$FIXTURE/bad-config" ]
    ;;
  ps)
    name="${@: -1}"
    [ ! -f "$FIXTURE/$name" ] || echo "$name"
    ;;
  pull) [ ! -f "$FIXTURE/fail-pull" ] ;;
  up)
    [[ "$*" = 'up -d --no-build --pull never --wait --wait-timeout 90 frontend bff' ]] || exit 94
    printf '%s\n' "$CUSTOMER_PORTAL_FRONTEND_IMAGE" "$TENANT_BFF_IMAGE" >> "$FIXTURE/attempts"
    if [ -f "$FIXTURE/fail-up" ]; then rm "$FIXTURE/fail-up"; exit 1; fi
    [ ! -f "$FIXTURE/fail-all" ] || exit 1
    printf '%s\n' "$CUSTOMER_PORTAL_FRONTEND_IMAGE" > "$FIXTURE/frontend"
    printf '%s\n' "$TENANT_BFF_IMAGE" > "$FIXTURE/bff"
    ;;
  *) exit 93 ;;
esac
DOCKER
chmod +x "$T/bin/docker"
reset_case() {
  rm -f "$T/"{calls,attempts,frontend,bff,fail-pull,fail-up,fail-all,no-network,no-image,bad-config}
  rm -rf "$RUNTIME_DIR/customer-portal-releases"
  cat > "$CUSTOMER_PORTAL_ENV_FILE" <<'ENV'
TENANT_BFF_TOKEN=fixture-token-never-print
CUSTOMER_PORTAL_DATABASE_URL=postgresql://fixture-only
CUSTOMER_PORTAL_REDIS_URL=redis://fixture-only
OIDC_ISSUER=https://accounts.example.test
OIDC_CLIENT_ID=customer-portal
OIDC_CLIENT_SECRET=fixture-secret-never-print
ENV
}
running_pair() { printf '%s\n' "$old_f" > "$T/frontend"; printf '%s\n' "$old_b" > "$T/bff"; }
no_secrets() {
  local file
  for file in "$T/output" "$T/calls"; do
    if [ -f "$file" ] && grep -Eq 'fixture-token-never-print|fixture-secret-never-print' "$file"; then
      echo 'Secret leaked to output' >&2; exit 1
    fi
  done
}
run_ok() { bash "$SCRIPT" "$@" > "$T/output" 2>&1 || { cat "$T/output"; exit 1; }; no_secrets; }
run_bad() { if bash "$SCRIPT" "$@" > "$T/output" 2>&1; then echo "Expected rejection: $*" >&2; exit 1; fi; no_secrets; }
no_mutation() { if grep -Eq ' (pull|up) ' "$T/calls" 2>/dev/null; then echo 'Unexpected service mutation' >&2; exit 1; fi; }
expect_pair() { [ "$(cat "$1")" = "$(printf '%s\n' "$2" "$3")" ]; }

# ===========================================================================
# Preflight and fixed deployment scope
# ===========================================================================
reset_case
run_ok check "$f" "$b"
no_mutation
[ ! -d "$RUNTIME_DIR/customer-portal-releases" ]
echo 'ok - check is read-only and accepts only dedicated compose scope'
reset_case
cp "$CUSTOMER_PORTAL_ENV_FILE" "$RUNTIME_DIR/.env.tenant-bff"
CUSTOMER_PORTAL_ENV_FILE= run_ok check "$f" "$b"
grep -q -- "--env-file $RUNTIME_DIR/.env.tenant-bff" "$T/calls"
no_mutation
echo 'ok - the default runtime file resolves to the tenant BFF configuration'
for bad in registry.test/front:latest 'registry.test/front@sha256:abc' "Registry.test/front@sha256:$(printf 'a%.0s' {1..64})"; do
  reset_case; run_bad deploy "$bad" "$b"; no_mutation
done
reset_case
sed -i '/OIDC_CLIENT_SECRET=/d' "$CUSTOMER_PORTAL_ENV_FILE"
run_bad deploy "$f" "$b"; no_mutation
echo 'ok - mutable or malformed references and missing secrets are rejected before pull'
for flag in no-network bad-config; do
  reset_case; touch "$T/$flag"; run_bad deploy "$f" "$b"; no_mutation
done
reset_case
printf '%s\n' "$old_f" > "$T/frontend"
run_bad deploy "$f" "$b"; no_mutation
echo 'ok - invalid configuration, missing network and partial stacks are rejected'
reset_case; running_pair
printf '%s\n' 'registry.test/portal_frontend:latest' > "$T/frontend"
run_bad deploy "$f" "$b"; no_mutation
reset_case; running_pair; touch "$T/no-image"
run_bad deploy "$f" "$b"; no_mutation
echo 'ok - unpinned running images or missing recovery images prevent an upgrade'
reset_case
TENANT_BFF_TOKEN=caller-value OIDC_CLIENT_SECRET=caller-value run_ok check "$f" "$b"
echo 'ok - caller runtime variables do not override the dedicated env file'
wrong_b="registry.test/unrelated_bff@sha256:$(printf 'e%.0s' {1..64})"
for action in check deploy; do
  reset_case; run_bad "$action" "$f" "$wrong_b"; no_mutation
done
reset_case; running_pair
printf '%s\n' "$wrong_b" > "$T/bff"
run_bad deploy "$f" "$b"; no_mutation
reset_case
mkdir -p "$RUNTIME_DIR/customer-portal-releases"
printf '%s\n' "$old_f" "$wrong_b" > "$RUNTIME_DIR/customer-portal-releases/previous"
run_bad rollback; no_mutation
echo 'ok - deploy and rollback reject BFF images from another identity before mutation'

# ===========================================================================
# Release success, recovery and explicit rollback
# ===========================================================================
reset_case; running_pair
touch "$T/fail-pull"
run_bad deploy "$f" "$b"
[ ! -f "$T/attempts" ]
expect_pair <(cat "$T/frontend" "$T/bff") "$old_f" "$old_b"
echo 'ok - failed pull preserves the running release'
reset_case; running_pair
run_ok deploy "$f" "$b"
expect_pair "$RUNTIME_DIR/customer-portal-releases/current" "$f" "$b"
expect_pair "$RUNTIME_DIR/customer-portal-releases/previous" "$old_f" "$old_b"
run_ok rollback
expect_pair "$RUNTIME_DIR/customer-portal-releases/current" "$old_f" "$old_b"
expect_pair "$RUNTIME_DIR/customer-portal-releases/previous" "$f" "$b"
echo 'ok - successful upgrades record both digests and explicit rollback restores them'
reset_case; running_pair; touch "$T/fail-up"
run_bad deploy "$f" "$b"
[ "$(wc -l < "$T/attempts")" -eq 4 ]
expect_pair <(tail -n 2 "$T/attempts") "$old_f" "$old_b"
[ ! -f "$RUNTIME_DIR/customer-portal-releases/current" ]
grep -q 'previous portal images were restored' "$T/output"
echo 'ok - failed health gate restores the prior pair and still returns failure'
reset_case; running_pair; touch "$T/fail-all"
run_bad deploy "$f" "$b"
grep -q 'operator intervention is required' "$T/output"
echo 'ok - failed recovery is reported explicitly'
reset_case; touch "$T/fail-up"
run_bad deploy "$f" "$b"
[ "$(wc -l < "$T/attempts")" -eq 2 ]
grep -q 'no prior portal release exists' "$T/output"
echo 'ok - failed first release does not invent a rollback or delete containers'
reset_case
run_bad rollback; no_mutation
mkdir -p "$RUNTIME_DIR/customer-portal-releases"
printf '%s\n' "$old_f" "$old_b" > "$RUNTIME_DIR/customer-portal-releases/previous"
touch "$T/no-image"
run_bad rollback; no_mutation
echo 'ok - missing release record or unavailable rollback images fail closed'
reset_case
mkdir -p "$RUNTIME_DIR/customer-portal-releases"
exec 8>"$RUNTIME_DIR/customer-portal-releases/deploy.lock"
flock -n 8
run_bad deploy "$f" "$b"; no_mutation
flock -u 8
echo 'ok - concurrent deployments are rejected'
echo 'Customer portal deployment regressions passed.'
