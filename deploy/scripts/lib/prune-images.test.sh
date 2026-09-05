#!/usr/bin/env bash
# deploy/scripts/lib/prune-images.test.sh
# 纯文本单测:select_stale_platform_images 只能挑出「本平台、无容器引用」的镜像 ID。
# 运行:bash deploy/scripts/lib/prune-images.test.sh
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

ACR="registry.example.test/vx-platform"
GHCR="ghcr.io/vxture-platform"

# `docker images --no-trunc --format '{{.Repository}} {{.ID}}'` 的样子:按摘要拉的镜像
# 只有仓库名没有 tag(2026-09-05 之后线上全是这种);同一 ID 可因多 tag 出现多行。
images="$(cat <<EOF
$ACR/platform_bff-auth sha256:aaaa
$ACR/platform_bff-auth sha256:bbbb
$ACR/platform_bff-auth sha256:cccc
$ACR/platform_accounts sha256:dddd
$ACR/platform_accounts sha256:eeee
$GHCR/platform_admin sha256:ffff
$ACR/platform_website sha256:1111
$ACR/platform_website sha256:1111
postgres sha256:2222
nginx sha256:3333
alpine/socat sha256:4444
ghcr.io/vxture/karda-app sha256:5555
EOF
)"

# 在用:全长 ID(`docker inspect --format '{{.Image}}'`)。aaaa / dddd 在跑;eeee 被一个
# 已停止的容器引用,也要保住;website 的 1111 此刻正好没起来,但它没被引用就该回收——
# 回收只看引用,不看"当前版本",当前版本的镜像一定被刚起的容器引用着。
inuse="$(mktemp)"
cat > "$inuse" <<EOF
sha256:aaaa
sha256:dddd
sha256:eeee
sha256:3333
EOF

actual="$(printf '%s\n' "$images" | select_stale_platform_images "$inuse")"
expected="$(cat <<EOF
sha256:bbbb
sha256:cccc
sha256:ffff
sha256:1111
EOF
)"
assert_eq "picks platform_* image IDs not referenced by any container, once each" "$expected" "$actual"

# 工具镜像绝不出现在结果里——2026-08-29 修的东西。
case "$actual" in
  *2222*|*4444*|*5555*) echo "FAIL - tool/third-party image selected" >&2; fail=1 ;;
  *) echo "ok   - tool images (postgres/socat/karda) untouched" ;;
esac

# 在用的绝不出现(含已停止容器引用的)。
case "$actual" in
  *aaaa*|*dddd*|*eeee*) echo "FAIL - in-use image selected" >&2; fail=1 ;;
  *) echo "ok   - in-use images (running or stopped container) never selected" ;;
esac

# 在用清单为空 = docker ps 没跑成,一个都不能选。
empty="$(mktemp)"
: > "$empty"
none="$(printf '%s\n' "$images" | select_stale_platform_images "$empty" 2>/dev/null)"
assert_eq "empty in-use list selects nothing" "" "$none"
rm -f "$inuse" "$empty"

exit "$fail"
