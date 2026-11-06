#!/usr/bin/env bash
# Provision only the Workbench inbox role and its dedicated runtime connection.
# @package @vxture/repo
# @layer Infrastructure
# @category deployment-script
# @author AI-Generated
# @date 2026-11-06
set -euo pipefail
umask 077

# ============================================================================
# Explicit operational gate; no shared service credentials or migrations change.
# ============================================================================
if [ "${CONFIRM_PROVISION_WORKBENCH_INBOX:-}" != "yes" ]; then
  echo "Explicit approval required: CONFIRM_PROVISION_WORKBENCH_INBOX=yes" >&2
  exit 1
fi
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"
SECRETS_DIR="$RUNTIME_DIR/secrets"
OWNER_ENV="$SECRETS_DIR/rds-owner.env"
PASSWORD_FILE="$SECRETS_DIR/rds-pw-svc_workbench_inbox"
WORKBENCH_ENV="$RUNTIME_DIR/.env.workbench-bff"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROLE_DDL="$SCRIPT_DIR/../database/ddl/97_service_roles.sql"
PGIMG="${PGIMG:-postgres:18-alpine}"
for source_file in "$OWNER_ENV" "$WORKBENCH_ENV" "$ROLE_DDL"; do
  [ -f "$source_file" ] || { echo "Missing required provisioning input: $source_file" >&2; exit 1; }
done

ROLE_EXISTS="$(docker run --rm --env-file "$OWNER_ENV" "$PGIMG" \
  sh -c 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAc "select count(*) from pg_roles where rolname='"'svc_workbench_inbox'"'"')"
ROLE_EXISTS="$(printf '%s' "$ROLE_EXISTS" | tr -d '[:space:]')"
case "$ROLE_EXISTS" in 0|1) ;; *) echo "Unable to verify inbox role state" >&2; exit 1 ;; esac
if [ ! -f "$PASSWORD_FILE" ]; then
  [ "$ROLE_EXISTS" = "0" ] || { echo "Existing inbox role has no local credential; refusing password rotation" >&2; exit 1; }
  openssl rand -hex 32 > "$PASSWORD_FILE"
  chmod 600 "$PASSWORD_FILE"
fi
INBOX_PASSWORD="$(cat "$PASSWORD_FILE")"
[[ "$INBOX_PASSWORD" =~ ^[A-Za-z0-9]{32,128}$ ]] || { echo "Inbox credential must be 32-128 alphanumeric characters" >&2; exit 1; }
OWNER_URL="$(sed -n 's/^DATABASE_URL=//p' "$OWNER_ENV")"
[[ "$OWNER_URL" =~ ^postgres(ql)?://[^@]+@[^[:space:]]+/[^[:space:]]+$ ]] || {
  echo "Expected a single PostgreSQL owner URL with encoded credentials" >&2; exit 1;
}
INBOX_URL="postgresql://svc_workbench_inbox:$INBOX_PASSWORD@${OWNER_URL#*@}"
INBOX_KEY_COUNT="$(grep -c '^WORKBENCH_INBOX_DATABASE_URL=' "$WORKBENCH_ENV" || true)"
[ "$INBOX_KEY_COUNT" -le 1 ] || { echo "Duplicate inbox runtime keys; refusing to proceed" >&2; exit 1; }
EXISTING_URL="$(sed -n 's/^WORKBENCH_INBOX_DATABASE_URL=//p' "$WORKBENCH_ENV")"
if [ -n "$EXISTING_URL" ] && [ "$EXISTING_URL" != "$INBOX_URL" ]; then
  echo "Existing inbox connection differs; refusing to overwrite runtime configuration" >&2
  exit 1
fi

# ============================================================================
# Apply only the authoritative inbox block, atomically with its private password.
# ============================================================================
TMP_SQL="$(mktemp "$RUNTIME_DIR/.workbench-inbox-sql.XXXXXX")"
TMP_ENV=""
trap 'rm -f -- "$TMP_SQL"; if [ -n "$TMP_ENV" ]; then rm -f -- "$TMP_ENV"; fi' EXIT
printf 'BEGIN;\n' > "$TMP_SQL"
awk '/^-- BEGIN WORKBENCH INBOX ROLE$/ { capture=1; next }
     /^-- END WORKBENCH INBOX ROLE$/ { capture=0 }
     capture { print }' "$ROLE_DDL" >> "$TMP_SQL"
grep -q 'GRANT UPDATE (read_at)' "$TMP_SQL" || { echo "Authoritative inbox grant block not found" >&2; exit 1; }
printf "ALTER ROLE svc_workbench_inbox PASSWORD '%s';\nCOMMIT;\n" "$INBOX_PASSWORD" >> "$TMP_SQL"
docker run --rm -i --env-file "$OWNER_ENV" "$PGIMG" \
  sh -c 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f -' < "$TMP_SQL"

# Preserve every existing runtime key; add only the dedicated connection.
if [ -z "$EXISTING_URL" ]; then
  BACKUP="$WORKBENCH_ENV.before-inbox.$(date -u +%Y%m%dT%H%M%SZ).$$"
  cp -p -- "$WORKBENCH_ENV" "$BACKUP"
  chmod 600 "$BACKUP"
  TMP_ENV="$(mktemp "$RUNTIME_DIR/.workbench-inbox-env.XXXXXX")"
  sed '/^WORKBENCH_INBOX_DATABASE_URL=$/d' "$WORKBENCH_ENV" > "$TMP_ENV"
  printf '\nWORKBENCH_INBOX_DATABASE_URL=%s\n' "$INBOX_URL" >> "$TMP_ENV"
  chmod 600 "$TMP_ENV"
  mv -- "$TMP_ENV" "$WORKBENCH_ENV"
  TMP_ENV=""
fi
echo "Workbench inbox role and private runtime key provisioned; no containers restarted."
