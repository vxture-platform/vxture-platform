#!/usr/bin/env bash
# deploy/scripts/15-migrate-runtime-ports.sh
# Rewrite port-bearing values in the runtime env files after the 2026-08-10 L0
# port re-map.
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-08-10
#
# ── Why this exists ──────────────────────────────────────────────────────────
# Changing `.env.<service>.example` does NOT change the host. 14-normalize
# regenerates each runtime file from its example but **keeps the host's value**
# for every key that already exists — by design, since those values are the
# host's own configuration and secrets. So a port that lives only in a runtime
# env file survives a deploy unchanged, while compose/nginx move to the new
# number, and the two halves land on opposite sides of the re-map.
#
# Concretely, without this script the first post-re-map deploy breaks these:
#
#   .env.platform-api   PLATFORM_API_PORT=3041  → container listens on 3041
#                       while nginx proxies vx-platform-api:8080 and the
#                       healthcheck probes 8080. Container reports unhealthy,
#                       the S2S tailnet edge (:8080) answers nothing, and every
#                       product repo's PLATFORM_API_URL goes dark.
#   .env.*-bff          AUTH_BFF_URL=…:3061     → every RP BFF keeps calling
#                       auth-bff on its old port while auth-bff listens on 3081.
#                       Login breaks on all four portals at once.
#   .env.console-bff    PLATFORM_API_URL=…:3041 → console quota resolution
#                       fails closed.
#   .env.gateway-bff    ADMIN_BFF_ORIGIN=…:3043 → admin routes 502 at the edge.
#
# The ports that compose sets in `environment:` (PORT, AUTH_BFF_PORT,
# ADMIN_BFF_PORT, OPERA_BFF_PORT, WEBSITE_BFF_PORT) are already authoritative —
# compose's `environment:` wins over `env_file` — but they are rewritten here
# too, so the file a human reads agrees with the process actually running.
#
# Idempotent: every rewrite is old-value-matched, so a second run is a no-op and
# a host already on the new numbers is untouched. Safe to leave in the deploy
# path permanently; it becomes dead weight once every host is migrated, and
# retires with the same discipline as the seed's guarded UPDATEs (#213).
#
# Run: bash scripts/15-migrate-runtime-ports.sh          # dry-run, prints a plan
#      APPLY=1 bash scripts/15-migrate-runtime-ports.sh  # rewrite in place
set -euo pipefail

RUNTIME_DIR="${DEPLOY_RUNTIME_DIR:-${RUNTIME_DIR:-/srv/vxture/runtime}}"
APPLY="${APPLY:-0}"

# file : old → new. Ordered old-first so no substitution can create a value a
# later rule would rewrite again (8080 is never a source, 3041 never a target
# in the same file).
# Legacy sources are listed alongside current ones: a host that never ran the
# 2026-07-24 migration is on 3090, one that did is on 3061, and both must land
# on 3081. Chaining through the intermediate value would depend on rule order
# surviving future edits, so each starting point names its final target directly.
MIGRATIONS="
.env.platform-api|PLATFORM_API_PORT=3041|PLATFORM_API_PORT=8080
.env.platform-api|AUTH_BFF_URL=http://vx-platform-auth-bff:3061|AUTH_BFF_URL=http://vx-platform-auth-bff:3081
.env.auth-bff|AUTH_BFF_PORT=3061|AUTH_BFF_PORT=3081
.env.website-bff|AUTH_BFF_URL=http://vx-platform-auth-bff:3061|AUTH_BFF_URL=http://vx-platform-auth-bff:3081
.env.website-bff|WEBSITE_BFF_PORT=3011|WEBSITE_BFF_PORT=3001
.env.console-bff|AUTH_BFF_URL=http://vx-platform-auth-bff:3061|AUTH_BFF_URL=http://vx-platform-auth-bff:3081
.env.console-bff|PLATFORM_API_URL=http://vx-platform-api:3041|PLATFORM_API_URL=http://vx-platform-api:8080
.env.admin-bff|AUTH_BFF_URL=http://vx-platform-auth-bff:3061|AUTH_BFF_URL=http://vx-platform-auth-bff:3081
.env.admin-bff|ADMIN_BFF_PORT=3043|ADMIN_BFF_PORT=3031
.env.opera-bff|AUTH_BFF_URL=http://vx-platform-auth-bff:3061|AUTH_BFF_URL=http://vx-platform-auth-bff:3081
.env.opera-bff|OPERA_BFF_PORT=3051|OPERA_BFF_PORT=3041
.env.gateway-bff|AUTH_BFF_ORIGIN=http://vx-platform-auth-bff:3061|AUTH_BFF_ORIGIN=http://vx-platform-auth-bff:3081
.env.gateway-bff|ADMIN_BFF_ORIGIN=http://vx-platform-admin-bff:3043|ADMIN_BFF_ORIGIN=http://vx-platform-admin-bff:3031
.env.auth-bff|AUTH_BFF_PORT=3090|AUTH_BFF_PORT=3081
.env.platform-api|AUTH_BFF_URL=http://vx-platform-auth-bff:3090|AUTH_BFF_URL=http://vx-platform-auth-bff:3081
.env.website-bff|AUTH_BFF_URL=http://vx-platform-auth-bff:3090|AUTH_BFF_URL=http://vx-platform-auth-bff:3081
.env.console-bff|AUTH_BFF_URL=http://vx-platform-auth-bff:3090|AUTH_BFF_URL=http://vx-platform-auth-bff:3081
.env.admin-bff|AUTH_BFF_URL=http://vx-platform-auth-bff:3090|AUTH_BFF_URL=http://vx-platform-auth-bff:3081
.env.opera-bff|AUTH_BFF_URL=http://vx-platform-auth-bff:3090|AUTH_BFF_URL=http://vx-platform-auth-bff:3081
.env.gateway-bff|AUTH_BFF_ORIGIN=http://vx-platform-auth-bff:3090|AUTH_BFF_ORIGIN=http://vx-platform-auth-bff:3081
.env.gateway-bff|WEBSITE_BFF_ORIGIN=http://vx-platform-website-bff:3011|WEBSITE_BFF_ORIGIN=http://vx-platform-website-bff:3001
"

echo "=== L0 port re-map — runtime env migration (${RUNTIME_DIR}) ==="
[ "$APPLY" = "1" ] || echo "    dry-run (set APPLY=1 to rewrite)"

changed=0
missing=0
while IFS='|' read -r file old new; do
  [ -n "${file:-}" ] || continue
  path="$RUNTIME_DIR/$file"
  if [ ! -f "$path" ]; then
    echo "  [--] $file — not on this host, skipped"
    missing=$((missing + 1))
    continue
  fi
  if grep -qxF "$old" "$path"; then
    if [ "$APPLY" = "1" ]; then
      # Whole-line match keeps a value like :30610 from being touched.
      tmp="$(mktemp)"
      awk -v o="$old" -v n="$new" '$0 == o { print n; next } { print }' "$path" >"$tmp"
      cat "$tmp" >"$path" # preserve mode/ownership of the original
      rm -f "$tmp"
      echo "  [ok] $file: $old → $new"
    else
      echo "  [would] $file: $old → $new"
    fi
    changed=$((changed + 1))
  elif grep -qxF "$new" "$path"; then
    echo "  [skip] $file: already on $new"
  else
    echo "  [warn] $file: neither old nor new value present for ${old%%=*} — check by hand"
  fi
done <<EOF
$(printf '%s\n' "$MIGRATIONS" | sed '/^[[:space:]]*$/d')
EOF

echo "=== ${changed} line(s) $([ "$APPLY" = "1" ] && echo rewritten || echo "would change"), ${missing} file(s) absent ==="
