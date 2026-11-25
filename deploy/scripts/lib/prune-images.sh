#!/usr/bin/env bash
# Select and prune images owned by the main platform Compose project only.
# @package @vxture/repo
# @layer Infrastructure
# @category deployment-script
# @author AI-Generated
# @date 2026-11-25
# Inputs: container image IDs, Compose image references, then Docker repository/ID rows.
# Independent release candidates and rollback images must survive platform upgrades.

# ============================================================================
# Pure selection: exact repository ownership and complete image alias protection.
# ============================================================================
select_stale_platform_images() {
  local inuse_file="$1" owned_file="$2"
  if [ ! -s "$inuse_file" ] || [ ! -s "$owned_file" ]; then
    echo 'Image inventory or ownership list is empty; refusing to select images.' >&2
    return 0
  fi
  awk -v inuse_file="$inuse_file" -v owned_file="$owned_file" '
    BEGIN {
      while ((getline line < inuse_file) > 0) if (line != "") used[line] = 1
      close(inuse_file)
      while ((getline line < owned_file) > 0) {
        sub(/@[^/]*$/, "", line)
        sub(/:[^/]*$/, "", line)
        if (line ~ /\/platform_[a-z-]+$/) owned[line] = 1
      }
      close(owned_file)
    }
    NF == 2 && $2 != "" {
      if (!seen[$2]++) order[++count] = $2
      if ($1 in owned) candidate[$2] = 1
      else external[$2] = 1
    }
    END {
      for (i = 1; i <= count; i++) {
        id = order[i]
        if (candidate[id] && !used[id] && !external[id]) print id
      }
    }
  '
}

# ============================================================================
# Docker collection: incomplete inventories must never trigger image removal.
# ============================================================================
prune_stale_platform_images() (
  set -euo pipefail
  local compose_file="$1" inventory stale
  inventory="$(mktemp -d "${TMPDIR:-/tmp}/vx-image-inventory.XXXXXXXX")"
  trap 'rm -rf -- "$inventory"' EXIT
  if ! docker ps -aq > "$inventory/containers" 2>/dev/null ||
     [ ! -s "$inventory/containers" ] ||
     ! xargs -r docker inspect --format '{{.Image}}' < "$inventory/containers" > "$inventory/inuse" 2>/dev/null ||
     ! docker compose -f "$compose_file" config --images > "$inventory/owned" 2>/dev/null ||
     ! docker images --no-trunc --format '{{.Repository}} {{.ID}}' > "$inventory/images" 2>/dev/null; then
    echo 'Image cleanup skipped: a complete container, Compose and image inventory is required.' >&2
    return 0
  fi
  stale="$(select_stale_platform_images "$inventory/inuse" "$inventory/owned" < "$inventory/images")"
  if [ -z "$stale" ]; then
    echo 'No unused images owned exclusively by the platform stack.'
  else
    echo 'Removing unused images owned exclusively by the platform stack:'
    printf '%s\n' "$stale"
    # Never force removal: Docker must still reject newly referenced images.
    printf '%s\n' "$stale" | xargs -r docker rmi >/dev/null 2>&1 || true
  fi
)
