#!/usr/bin/env bash
# deploy/scripts/lib/provision-idp-internal.test.sh
# 34-provision 的三种现场，每种都在临时目录里真跑一遍脚本（不是读源码判断）：
#   · 文件不存在            → 铸：32 位 hex、≠ AUTH_INTERNAL_TOKEN、只打印路径
#   · 12-generate 落的占位  → 视同不存在：不要 FORCE 也铸（切换日「先 deploy 后 34」落在这一格；
#                             此前这里是 `exists:` exit 1，owner 被卡在审计拒占位与脚本拒覆盖之间）
#   · 已有真值              → 拒绝（exit 1、文件一个字节不动）；FORCE 才覆盖，且覆盖后值变了
# 运行：bash deploy/scripts/lib/provision-idp-internal.test.sh
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-10-04
set -euo pipefail
LIB_DIR="$(cd "$(dirname "$0")" && pwd)"
# PROVISION_SCRIPT 只给对照用：指向改动前的 34（`git show <rev>:…`）时第 4 组「占位 → 铸」要红。
SCRIPT="${PROVISION_SCRIPT:-$LIB_DIR/../34-provision-idp-internal-secret.sh}"
EXAMPLE="$LIB_DIR/../../secrets/platform-idp-internal.env.example"

command -v openssl >/dev/null 2>&1 || { echo "FAIL - openssl 不在 PATH（34 靠它铸值；没有它这组测试证明不了任何事）" >&2; exit 1; }
[ -f "$EXAMPLE" ] || { echo "FAIL - 缺 $EXAMPLE" >&2; exit 1; }

fail=0
ok()  { echo "ok   - $1"; }
bad() { echo "FAIL - $1" >&2; fail=1; }

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/secrets"
# 产品面的值只需「与铸出的值不同」，形状无所谓——不写成 32 位 hex，免得 gitleaks 把它当真凭证。
AUTH_VALUE="fake-product-face-token-for-this-test-only"
printf 'AUTH_INTERNAL_TOKEN=%s\n' "$AUTH_VALUE" > "$T/secrets/platform.env"
TARGET="$T/secrets/platform-idp-internal.env"

# run34 [extra VAR=val …] → stdout+stderr 进 $OUT，退出码进 $RC（脚本 exit 1 不让本测试死）
OUT=""; RC=0
run34() {
  set +e
  OUT="$(env CONFIRM_PROVISION_IDP_INTERNAL=yes RUNTIME_DIR="$T" SECRETS_DIR="$T/secrets" \
            PLATFORM_ENV_FILE="$T/secrets/platform.env" IDP_INTERNAL_ENV_FILE="$TARGET" \
            "$@" bash "$SCRIPT" 2>&1)"
  RC=$?
  set -e
}
value_of() { grep -E '^IDP_INTERNAL_TOKEN=' "$TARGET" | tail -n 1 | cut -d= -f2-; }
is_hex32() { printf '%s' "$1" | grep -qE '^[0-9a-f]{32}$'; }

# 0. 没 CONFIRM → 拒、不落盘
set +e
out0="$(env RUNTIME_DIR="$T" SECRETS_DIR="$T/secrets" PLATFORM_ENV_FILE="$T/secrets/platform.env" \
          IDP_INTERNAL_ENV_FILE="$TARGET" bash "$SCRIPT" 2>&1)"; rc0=$?
set -e
[ "$rc0" -ne 0 ] && [ ! -e "$TARGET" ] && ok "无 CONFIRM → exit $rc0、不落盘" || bad "无 CONFIRM：rc=$rc0 exists=$([ -e "$TARGET" ] && echo y || echo n)"

# 1. 文件不存在 → 铸
run34
v1="$(value_of || true)"
[ "$RC" -eq 0 ] && is_hex32 "$v1" && [ "$v1" != "$AUTH_VALUE" ] && ok "不存在 → 铸出 32 位 hex 且 ≠ AUTH_INTERNAL_TOKEN" || bad "不存在：rc=$RC value=[$v1]"
printf '%s' "$OUT" | grep -q "^ok: " && ok "不存在 → 打印 ok: <path>" || bad "不存在：输出里没有 ok:"
printf '%s' "$OUT" | grep -q "$v1" && bad "值被打印到了终端" || ok "值不进终端输出"

# 2. 已有真值、无 FORCE → 拒绝且文件不动
before="$(cat "$TARGET")"
run34
[ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q "^exists: " && ok "真值 + 无 FORCE → exists: exit $RC" || bad "真值无 FORCE：rc=$RC out=[$OUT]"
[ "$(cat "$TARGET")" = "$before" ] && ok "真值 + 无 FORCE → 文件一个字节不动" || bad "真值无 FORCE：文件被改了"

# 3. 已有真值、FORCE → 覆盖，值变了
run34 FORCE_PROVISION_IDP_INTERNAL=1
v3="$(value_of || true)"
[ "$RC" -eq 0 ] && is_hex32 "$v3" && [ "$v3" != "$v1" ] && ok "真值 + FORCE → 覆盖为新的 32 位 hex" || bad "真值 FORCE：rc=$RC v3=[$v3] v1=[$v1]"
printf '%s' "$OUT" | grep -q "^rotate: " && ok "真值 + FORCE → 打印 rotate:" || bad "真值 FORCE：输出里没有 rotate:"

# 4. 12-generate 落的占位（原样拷 example）→ 视同不存在，不要 FORCE 也铸
cp "$EXAMPLE" "$TARGET"
grep -q 'CHANGEME' "$TARGET" || bad "对照组失真：example 里没有 CHANGEME 占位"
run34
v4="$(value_of || true)"
[ "$RC" -eq 0 ] && is_hex32 "$v4" && ok "example 占位 → 不要 FORCE 也铸（rc=0、值为 32 位 hex）" || bad "example 占位：rc=$RC value=[$v4] out=[$OUT]"
printf '%s' "$OUT" | grep -q "^placeholder: " && ok "example 占位 → 打印 placeholder:" || bad "example 占位：输出里没有 placeholder:"
grep -q 'CHANGEME' "$TARGET" && bad "example 占位：铸完文件里还有 CHANGEME" || ok "example 占位 → 文件里不再有 CHANGEME"

# 5. 占位的其它写法：空值 / 带引号的 CHANGEME_* / CHANGE_ME —— 都视同不存在
for raw in '' '"CHANGEME_RANDOM_TOKEN"' "CHANGE_ME" "'change-me-now'" "your-token-here"; do
  printf 'IDP_INTERNAL_TOKEN=%s\n' "$raw" > "$TARGET"
  run34
  v5="$(value_of || true)"
  [ "$RC" -eq 0 ] && is_hex32 "$v5" && ok "占位写法 [$raw] → 铸" || bad "占位写法 [$raw]：rc=$RC value=[$v5]"
done

# 6. 对照组：像真值但不是占位的东西（任意非占位字符串）不许被当占位覆盖
printf 'IDP_INTERNAL_TOKEN=%s\n' "not-a-placeholder-but-a-real-looking-value" > "$TARGET"
run34
[ "$RC" -ne 0 ] && [ "$(value_of)" = "not-a-placeholder-but-a-real-looking-value" ] && ok "对照组：非占位的真值不被覆盖（exists: exit $RC）" || bad "对照组：非占位真值被当占位覆盖了 rc=$RC value=[$(value_of || true)]"

# 7. 缺 platform.env → 拒（断言不了「≠ AUTH_INTERNAL_TOKEN」）
rm -f "$TARGET"
mv "$T/secrets/platform.env" "$T/secrets/platform.env.off"
run34
[ "$RC" -ne 0 ] && [ ! -e "$TARGET" ] && ok "缺 platform.env → exit $RC、不落盘" || bad "缺 platform.env：rc=$RC exists=$([ -e "$TARGET" ] && echo y || echo n)"
mv "$T/secrets/platform.env.off" "$T/secrets/platform.env"

exit $fail
