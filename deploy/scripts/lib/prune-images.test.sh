#!/usr/bin/env bash
# Verify ownership boundaries and fail-closed Docker inventories before pruning.
# @package @vxture/repo
# @layer Infrastructure
# @category test
# @author AI-Generated
# @date 2026-11-25
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/prune-images.sh"
fixture="$(mktemp -d)"
trap 'rm -rf -- "$fixture"' EXIT
ACR='registry.example.test:5000/vx-platform'
export PRUNE_FIXTURE="$fixture" ACR
count=0
assert_eq() {
  [[ "$2" == "$3" ]] || { echo "FAIL: $1" >&2; exit 1; }
  count=$((count+1)); echo "ok $count - $1"
}

# ============================================================================
# Repository ownership, independent releases, image aliases and stopped users.
# ============================================================================
cat > "$fixture/owned" <<EOF
$ACR/platform_bff-auth:release
$ACR/platform_accounts@sha256:1234
$ACR/platform_website:release
EOF
cat > "$fixture/inuse" <<EOF
sha256:running
sha256:stopped
EOF
cat > "$fixture/images" <<EOF
$ACR/platform_bff-auth sha256:running
$ACR/platform_accounts sha256:stopped
$ACR/platform_bff-auth sha256:old
$ACR/platform_bff-auth sha256:old
$ACR/platform_website sha256:unused
$ACR/platform_bff-tenant sha256:tenant-candidate
$ACR/platform_bff-tenant sha256:tenant-rollback
$ACR/customer_portal_frontend sha256:tenant-frontend
other.example.test/platform_bff-auth sha256:foreign-registry
$ACR/platform_unknown sha256:unknown
postgres sha256:tool
<none> sha256:dangling
$ACR/platform_bff-auth sha256:shared
$ACR/platform_bff-tenant sha256:shared
$ACR/customer_portal_frontend sha256:reverse-shared
$ACR/platform_website sha256:reverse-shared
EOF
actual="$(select_stale_platform_images "$fixture/inuse" "$fixture/owned" < "$fixture/images")"
assert_eq 'only unused images exclusively owned by the main stack, deduplicated' $'sha256:old\nsha256:unused' "$actual"
: > "$fixture/empty"
for missing in inuse owned; do
  inuse="$fixture/inuse"; owned="$fixture/owned"
  if [[ "$missing" == inuse ]]; then inuse="$fixture/empty"; else owned="$fixture/empty"; fi
  actual="$(select_stale_platform_images "$inuse" "$owned" < "$fixture/images" 2>/dev/null)"
  assert_eq "empty $missing inventory preserves every image" '' "$actual"
done
printf '%s\n' 'postgres:18-alpine' > "$fixture/unowned"
actual="$(select_stale_platform_images "$fixture/inuse" "$fixture/unowned" < "$fixture/images")"
assert_eq 'non-platform Compose projects cannot authorize image removal' '' "$actual"

# ============================================================================
# Real collection and removal entry point with a bounded Docker substitute.
# ============================================================================
mkdir "$fixture/bin"
cat > "$fixture/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$PRUNE_FIXTURE/calls"
case "$*" in
  'ps -aq')
    [[ "${PRUNE_FAIL:-}" != ps ]] || exit 1
    [[ "${PRUNE_FAIL:-}" != empty ]] || exit 0
    echo synthetic-container;;
  'inspect --format {{.Image}} synthetic-container')
    cat "$PRUNE_FIXTURE/inuse"
    [[ "${PRUNE_FAIL:-}" != inspect ]] || exit 1;;
  'compose -f fixture-compose.yml config --images')
    cat "$PRUNE_FIXTURE/owned"
    [[ "${PRUNE_FAIL:-}" != compose ]] || exit 1;;
  'images --no-trunc --format {{.Repository}} {{.ID}}')
    cat "$PRUNE_FIXTURE/images"
    [[ "${PRUNE_FAIL:-}" != images ]] || exit 1;;
  'rmi sha256:old sha256:unused') echo "$*" >> "$PRUNE_FIXTURE/removed";;
  *) echo 'Unexpected Docker mutation' >&2; exit 99;;
esac
DOCKER
chmod +x "$fixture/bin/docker"
export PATH="$fixture/bin:$PATH"
prune_stale_platform_images fixture-compose.yml > "$fixture/output"
assert_eq 'real cleanup removes exactly the selected platform image IDs' 'rmi sha256:old sha256:unused' "$(cat "$fixture/removed")"
! grep -Eq 'image prune|rmi .*--force|rmi .* -f' "$fixture/calls"
for failure in ps empty inspect compose images; do
  rm -f "$fixture/removed"
  PRUNE_FAIL="$failure" prune_stale_platform_images fixture-compose.yml > "$fixture/output" 2>&1
  [[ ! -e "$fixture/removed" ]]
  grep -q 'cleanup skipped' "$fixture/output"
  count=$((count+1)); echo "ok $count - incomplete $failure inventory preserves all images"
done
