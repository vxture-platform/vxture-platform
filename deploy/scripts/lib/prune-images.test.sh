#!/usr/bin/env bash
# deploy/scripts/lib/prune-images.test.sh
# 纯文本单测：select_stale_platform_images 只能挑出「本平台、旧 tag、无容器引用」的镜像。
# 运行：bash deploy/scripts/lib/prune-images.test.sh
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-08-29
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/prune-images.sh"

fail=0
assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "ok   - $name"
  else
    echo "FAIL - $name" >&2
    echo "  expected: $(printf '%s' "$expected" | tr '\n' '|')" >&2
    echo "  actual:   $(printf '%s' "$actual" | tr '\n' '|')" >&2
    fail=1
  fi
}

ACR="crpi-xxx.cn-beijing.personal.cr.aliyuncs.com/vx-platform"
GHCR="ghcr.io/vxture-platform"

images="$(cat <<EOF
$ACR/platform_bff-auth:v0.26.2
$ACR/platform_bff-auth:v0.26.1
$ACR/platform_bff-auth:v0.26.0
$ACR/platform_accounts:v0.26.2
$ACR/platform_accounts:v0.26.1
$GHCR/platform_admin:v0.25.0
$ACR/platform_website:v0.26.2
$ACR/platform_website:<none>
postgres:18-alpine
nginx:1.29-alpine
alpine/socat:latest
ghcr.io/vxture/karda-app:local
EOF
)"

# 在用：当前版本在跑（website 例外——模拟它此刻正好没起来，当前 tag 也必须保住）；
# 另有一个已停止但仍引用 v0.26.1 accounts 的容器。
inuse="$(mktemp)"
cat > "$inuse" <<EOF
$ACR/platform_bff-auth:v0.26.2
$ACR/platform_accounts:v0.26.2
$ACR/platform_accounts:v0.26.1
nginx:1.29-alpine
EOF

actual="$(printf '%s\n' "$images" | select_stale_platform_images "v0.26.2" "$inuse")"
expected="$(cat <<EOF
$ACR/platform_bff-auth:v0.26.1
$ACR/platform_bff-auth:v0.26.0
$GHCR/platform_admin:v0.25.0
EOF
)"
assert_eq "picks only stale platform_* images not referenced by any container" "$expected" "$actual"

# 工具镜像绝不出现在结果里——这正是这次修的东西。
case "$actual" in
  *postgres*|*socat*|*karda*) echo "FAIL - tool/third-party image selected" >&2; fail=1 ;;
  *) echo "ok   - tool images (postgres/socat/karda) untouched" ;;
esac

# 当前 tag 绝不出现。
case "$actual" in
  *":v0.26.2"*) echo "FAIL - current tag selected" >&2; fail=1 ;;
  *) echo "ok   - current tag never selected" ;;
esac

# <none> 交给 prune -f，不在这里 rmi。
case "$actual" in
  *"<none>"*) echo "FAIL - <none> selected" >&2; fail=1 ;;
  *) echo "ok   - <none> left to docker image prune -f" ;;
esac

# keep_tag 为空：宁可什么都不删。
actual_empty="$(printf '%s\n' "$images" | select_stale_platform_images "" "$inuse" 2>/dev/null)"
assert_eq "empty keep_tag selects nothing" "" "$actual_empty"

# 在用清单为空文件：不能因此把所有旧版本都放行成"可删"之外，也不能误删当前。
: > "$inuse"
actual_noinuse="$(printf '%s\n' "$images" | select_stale_platform_images "v0.26.2" "$inuse")"
expected_noinuse="$(cat <<EOF
$ACR/platform_bff-auth:v0.26.1
$ACR/platform_bff-auth:v0.26.0
$ACR/platform_accounts:v0.26.1
$GHCR/platform_admin:v0.25.0
EOF
)"
assert_eq "empty in-use list: stale versions selectable, current tag still kept" "$expected_noinuse" "$actual_noinuse"

rm -f "$inuse"
exit $fail
