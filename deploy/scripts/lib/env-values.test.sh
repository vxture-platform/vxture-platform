#!/usr/bin/env bash
# deploy/scripts/lib/env-values.test.sh
# env_value / csv_contains 要按人会怎么写 .env 来读：引号、空格、CR、大小写都不算数。
# 运行：bash deploy/scripts/lib/env-values.test.sh
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-08-29
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/env-values.sh"

fail=0
ok()   { echo "ok   - $1"; }
bad()  { echo "FAIL - $1" >&2; fail=1; }
check() { if "$@" >/dev/null 2>&1; then return 0; else return 1; fi; }

f="$(mktemp)"

# 每一种写法都是 runtime .env 里真会出现的形状。
printf 'CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES=accounts.vxture.com,console.vxture.com\n' > "$f"
[ "$(env_value "$f" CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES)" = "accounts.vxture.com,console.vxture.com" ] && ok "plain value" || bad "plain value"

printf 'CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES="accounts.vxture.com,console.vxture.com"\n' > "$f"
[ "$(env_value "$f" CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES)" = "accounts.vxture.com,console.vxture.com" ] && ok "double-quoted value" || bad "double-quoted value"

printf "CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES='accounts.vxture.com'\n" > "$f"
[ "$(env_value "$f" CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES)" = "accounts.vxture.com" ] && ok "single-quoted value" || bad "single-quoted value"

printf 'CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES = accounts.vxture.com , console.vxture.com \r\n' > "$f"
v="$(env_value "$f" CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES)"
[ "$v" = "accounts.vxture.com , console.vxture.com" ] && ok "spaces around = and CRLF stripped" || bad "spaces/CRLF (got: [$v])"
check csv_contains "$v" accounts.vxture.com && ok "csv_contains tolerates spaces around commas" || bad "csv_contains spaces"

# 最后一次出现的才算——人改配置常常是追加一行。
printf 'CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES=old.example\nCF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES=accounts.vxture.com\n' > "$f"
[ "$(env_value "$f" CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES)" = "accounts.vxture.com" ] && ok "last occurrence wins" || bad "last occurrence"

# 注释掉的行不算。
printf '# CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES=commented.example\n' > "$f"
[ -z "$(env_value "$f" CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES)" ] && ok "commented line ignored" || bad "commented line"

# 前缀相同的键不能串台（*_ADMIN_* 不能被当成 *_TENANT_*）。
printf 'CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES_X=wrong.example\nCF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES=right.example\n' > "$f"
[ "$(env_value "$f" CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES)" = "right.example" ] && ok "exact key match" || bad "exact key"

# csv_contains：整项匹配，不是子串——accounts.vxture.com 不能被 xaccounts.vxture.com 冒充。
check csv_contains "xaccounts.vxture.com,console.vxture.com" accounts.vxture.com && bad "csv_contains substring false positive" || ok "csv_contains is whole-item, not substring"
check csv_contains "Accounts.VXTURE.com" accounts.vxture.com && ok "csv_contains case-insensitive" || bad "csv_contains case"
check csv_contains "" accounts.vxture.com && bad "empty csv should not contain" || ok "empty csv contains nothing"

rm -f "$f"
exit $fail
