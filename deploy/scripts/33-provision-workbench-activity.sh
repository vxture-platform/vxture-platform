#!/usr/bin/env bash
# Provision only the Workbench activity role and its dedicated runtime connection.
# @package @vxture/repo
# @layer Infrastructure
# @category deployment-script
# @author AI-Generated
# @date 2026-11-11
set -euo pipefail
umask 077

# ============================================================================
# Explicit operational gate; no shared service credentials or migrations change.
# ============================================================================
if [ "${CONFIRM_PROVISION_WORKBENCH_ACTIVITY:-}" != "yes" ]; then
  echo "Explicit approval required: CONFIRM_PROVISION_WORKBENCH_ACTIVITY=yes" >&2
  exit 1
fi
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"
SECRETS_DIR="$RUNTIME_DIR/secrets"
OWNER_ENV="$SECRETS_DIR/rds-owner.env"
PASSWORD_FILE="$SECRETS_DIR/rds-pw-svc_workbench_activity"
WORKBENCH_ENV="$RUNTIME_DIR/.env.workbench-bff"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROLE_DDL="$SCRIPT_DIR/../database/ddl/97_service_roles.sql"
PGIMG="${PGIMG:-postgres:18-alpine}"
for source_file in "$OWNER_ENV" "$WORKBENCH_ENV" "$ROLE_DDL"; do
  [ -f "$source_file" ] || { echo "Missing required provisioning input: $source_file" >&2; exit 1; }
done

ROLE_EXISTS="$(docker run --rm --env-file "$OWNER_ENV" "$PGIMG" \
  sh -c 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAc "select count(*) from pg_roles where rolname='"'svc_workbench_activity'"'"')"
ROLE_EXISTS="$(printf '%s' "$ROLE_EXISTS" | tr -d '[:space:]')"
case "$ROLE_EXISTS" in 0|1) ;; *) echo "Unable to verify activity role state" >&2; exit 1 ;; esac
if [ ! -f "$PASSWORD_FILE" ]; then
  [ "$ROLE_EXISTS" = "0" ] || { echo "Existing activity role has no local credential; refusing password rotation" >&2; exit 1; }
  openssl rand -hex 32 > "$PASSWORD_FILE"
  chmod 600 "$PASSWORD_FILE"
fi
ACTIVITY_PASSWORD="$(cat "$PASSWORD_FILE")"
[[ "$ACTIVITY_PASSWORD" =~ ^[A-Za-z0-9]{32,128}$ ]] || { echo "Inbox credential must be 32-128 alphanumeric characters" >&2; exit 1; }
OWNER_URL="$(sed -n 's/^DATABASE_URL=//p' "$OWNER_ENV")"
[[ "$OWNER_URL" =~ ^postgres(ql)?://[^@]+@[^[:space:]]+/[^[:space:]]+$ ]] || {
  echo "Expected a single PostgreSQL owner URL with encoded credentials" >&2; exit 1;
}
ACTIVITY_URL="postgresql://svc_workbench_activity:$ACTIVITY_PASSWORD@${OWNER_URL#*@}"
ACTIVITY_KEY_COUNT="$(grep -c '^WORKBENCH_ACTIVITY_DATABASE_URL=' "$WORKBENCH_ENV" || true)"
[ "$ACTIVITY_KEY_COUNT" -le 1 ] || { echo "Duplicate activity runtime keys; refusing to proceed" >&2; exit 1; }
EXISTING_URL="$(sed -n 's/^WORKBENCH_ACTIVITY_DATABASE_URL=//p' "$WORKBENCH_ENV")"
if [ -n "$EXISTING_URL" ] && [ "$EXISTING_URL" != "$ACTIVITY_URL" ]; then
  echo "Existing activity connection differs; refusing to overwrite runtime configuration" >&2
  exit 1
fi

# ============================================================================
# Apply only the authoritative activity block, atomically with its private password.
# ============================================================================
# Prepare the private credential before a separately approved schema migration.
if [ "${PREPARE_ONLY:-no}" = "yes" ]; then
  echo "Workbench activity credential prepared; no database or runtime changes applied."
  exit 0
fi
TMP_SQL="$(mktemp "$RUNTIME_DIR/.workbench-activity-sql.XXXXXX")"
TMP_ENV=""
trap 'rm -f -- "$TMP_SQL"; if [ -n "$TMP_ENV" ]; then rm -f -- "$TMP_ENV"; fi' EXIT
printf 'BEGIN;\n' > "$TMP_SQL"
awk '/^-- BEGIN WORKBENCH ACTIVITY ROLE$/ { capture=1; next }
     /^-- END WORKBENCH ACTIVITY ROLE$/ { capture=0 }
     capture { print }' "$ROLE_DDL" >> "$TMP_SQL"
grep -q 'GRANT INSERT (user_id, tenant_id, workspace_id, product_id, event_id)' "$TMP_SQL" || { echo "Authoritative activity grant block not found" >&2; exit 1; }
printf "ALTER ROLE svc_workbench_activity PASSWORD '%s';\nCOMMIT;\n" "$ACTIVITY_PASSWORD" >> "$TMP_SQL"
docker run --rm -i --env-file "$OWNER_ENV" "$PGIMG" \
  sh -c 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f -' < "$TMP_SQL"

# Preserve every existing runtime key; add only the dedicated connection.
if [ -z "$EXISTING_URL" ]; then
  BACKUP="$WORKBENCH_ENV.before-activity.$(date -u +%Y%m%dT%H%M%SZ).$$"
  cp -p -- "$WORKBENCH_ENV" "$BACKUP"
  chmod 600 "$BACKUP"
  TMP_ENV="$(mktemp "$RUNTIME_DIR/.workbench-activity-env.XXXXXX")"
  sed '/^WORKBENCH_ACTIVITY_DATABASE_URL=$/d' "$WORKBENCH_ENV" > "$TMP_ENV"
  printf '\nWORKBENCH_ACTIVITY_DATABASE_URL=%s\n' "$ACTIVITY_URL" >> "$TMP_ENV"
  chmod 600 "$TMP_ENV"
  mv -- "$TMP_ENV" "$WORKBENCH_ENV"
  TMP_ENV=""
fi
echo "Workbench activity role and private runtime key provisioned; no containers restarted."
