#!/usr/bin/env bash
# Run the targeted provisioning entry using synthetic output, never real keys.
# @package @vxture/repo
# @layer Infrastructure
# @category test
# @author AI-Generated
# @date 2026-11-22
set -euo pipefail
LIB_DIR="$(cd "$(dirname "$0")" && pwd)"
fixture="$(mktemp -d)"
trap '[[ -n "$fixture" && -d "$fixture/deploy/scripts" ]] && rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/deploy/scripts" "$fixture/deploy/database/prisma" "$fixture/runtime/secrets" "$fixture/bin"
cp "$LIB_DIR/../27-provision-client-secrets.sh" "$fixture/deploy/scripts/"
touch "$fixture/deploy/database/prisma/provision-client-secrets.mjs"
printf 'OPERATOR_TOTP_ENC_KEY=fixture-keep-totp\n' > "$fixture/runtime/.env.auth-bff"
printf 'PLATFORM_WEBHOOK_ENC_KEY=fixture-keep-api\n' > "$fixture/runtime/.env.platform-api"
printf 'PLATFORM_WEBHOOK_ENC_KEY=fixture-keep-opera\n' > "$fixture/runtime/.env.opera-bff"
printf 'DATABASE_URL=fixture-never-connected\n' > "$fixture/runtime/secrets/platform.env"
printf 'OIDC_CLIENT_ID=workbench\nOIDC_CLIENT_SECRET=fixture-keep-browser\nRUYIN_DESKTOP_OIDC_CLIENT_SECRET=\n' > "$fixture/runtime/.env.workbench-bff"
cp "$fixture/runtime/.env.platform-api" "$fixture/api-before"
cp "$fixture/runtime/.env.opera-bff" "$fixture/opera-before"

# Known synthetic fixtures; they are not generated or usable credentials.
cat > "$fixture/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$RUYIN_PROVISION_TEST_LOG"
case "$*" in
  *CLIENT_IDS_OVERRIDE=ruyin-desktop*)
    test "${RUYIN_TEST_REGISTRATION:-valid}" = valid || exit 1
    echo ruyin-desktop ;;
  *CLIENTS=ruyin-desktop*)
    client="${RUYIN_TEST_PAIR_CLIENT:-ruyin-desktop}"
    printf '%s\tfixture_secret_aaaaaaaaaaaaaaaaaaaaaaaaaaaa\t$2b$12$%053d\n' "$client" 1 ;;
  *) echo 'Unexpected non-desktop provisioning operation.' >&2; exit 98 ;;
esac
EOF
printf '#!/usr/bin/env bash\necho UNEXPECTED_GLOBAL_KEY_OPERATION >&2\nexit 97\n' > "$fixture/bin/openssl"
chmod +x "$fixture/bin/docker" "$fixture/bin/openssl"
export RUYIN_PROVISION_TEST_LOG="$fixture/docker.log"
export RUNTIME_DIR="$fixture/runtime" CONFIRM_PROVISION_SECRETS=yes
export PATH="$fixture/bin:$PATH"
script="$fixture/deploy/scripts/27-provision-client-secrets.sh"

# A fresh targeted provision touches exactly its RP secret and the IdP hash.
bash "$script" --ruyin-desktop-only > "$fixture/output" 2>&1
grep -q '^RUYIN_DESKTOP_OIDC_CLIENT_SECRET=fixture_secret_' "$fixture/runtime/.env.workbench-bff"
grep -qx 'OIDC_CLIENT_SECRET=fixture-keep-browser' "$fixture/runtime/.env.workbench-bff"
grep -q '^OIDC_CLIENT_SECRET_HASH_RUYIN_DESKTOP=' "$fixture/runtime/.env.auth-bff"
grep -qx 'OPERATOR_TOTP_ENC_KEY=fixture-keep-totp' "$fixture/runtime/.env.auth-bff"
cmp "$fixture/api-before" "$fixture/runtime/.env.platform-api"
cmp "$fixture/opera-before" "$fixture/runtime/.env.opera-bff"
! grep -q 'fixture_secret_\|\$2b\$12\$\|UNEXPECTED_GLOBAL' "$fixture/output"
printf 'PASS: targeted provision preserves global keys and never logs synthetic credentials\n'

# Idempotence performs only catalog validation, with no generation/write.
cp "$fixture/runtime/.env.workbench-bff" "$fixture/desktop-before"
cp "$fixture/runtime/.env.auth-bff" "$fixture/auth-before"
: > "$RUYIN_PROVISION_TEST_LOG"
bash "$script" --ruyin-desktop-only > "$fixture/output" 2>&1
! grep -q 'CLIENTS=' "$RUYIN_PROVISION_TEST_LOG"
cmp "$fixture/desktop-before" "$fixture/runtime/.env.workbench-bff"
cmp "$fixture/auth-before" "$fixture/runtime/.env.auth-bff"
printf 'PASS: repeated targeted provisioning leaves both runtime files unchanged\n'

# Catalog rejection and unexpected generator clients fail before env writes.
if RUYIN_TEST_REGISTRATION=missing bash "$script" --ruyin-desktop-only > "$fixture/output" 2>&1; then exit 1; fi
cmp "$fixture/auth-before" "$fixture/runtime/.env.auth-bff"
if FORCE_PROVISION_SECRETS=1 RUYIN_TEST_PAIR_CLIENT=console bash "$script" --ruyin-desktop-only > "$fixture/output" 2>&1; then exit 1; fi
cmp "$fixture/desktop-before" "$fixture/runtime/.env.workbench-bff"
cmp "$fixture/auth-before" "$fixture/runtime/.env.auth-bff"
printf 'PASS: unavailable registration and unexpected clients cannot change runtime files\n'

: > "$RUYIN_PROVISION_TEST_LOG"
if bash "$script" --unknown > "$fixture/output" 2>&1; then exit 1; fi
test ! -s "$RUYIN_PROVISION_TEST_LOG"
printf 'PASS: unknown options are rejected before any Docker operation\n'

# An env-file override must not turn this into Console/IdP provisioning.
printf 'OIDC_CLIENT_ID=console\n' > "$fixture/runtime/.env.console-bff"
if WORKBENCH_BFF_ENV_FILE="$fixture/runtime/.env.console-bff" bash "$script" --ruyin-desktop-only > "$fixture/output" 2>&1; then exit 1; fi
if WORKBENCH_BFF_ENV_FILE="$fixture/runtime/.env.auth-bff" bash "$script" --ruyin-desktop-only > "$fixture/output" 2>&1; then exit 1; fi
test ! -s "$RUYIN_PROVISION_TEST_LOG"
cmp "$fixture/auth-before" "$fixture/runtime/.env.auth-bff"
grep -qx 'OIDC_CLIENT_ID=console' "$fixture/runtime/.env.console-bff"
printf 'PASS: Console and IdP env-file overrides are rejected without mutations\n'
