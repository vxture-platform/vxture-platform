#!/usr/bin/env bash
# deploy/scripts/lib/registry-retry.test.sh
# 纯文本单测：认得的网络错才重试，其余立刻失败（TD-050）。
# 运行：bash deploy/scripts/lib/registry-retry.test.sh
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-09-22
#
# **两面都测**：只测「网络错会重试」的话，一个恒重试的实现也会绿；只测「凭据错不
# 重试」的话，一个恒不重试的实现也会绿。所以分类函数正反各一组，重试行为也正反各一条。
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/registry-retry.sh"

fail=0
assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "ok   - $name"
  else
    echo "FAIL - $name" >&2
    echo "  expected: $expected" >&2
    echo "  actual:   $actual" >&2
    fail=1
  fi
}

classify() {
  if registry_error_is_retryable "$1"; then echo retry; else echo stop; fi
}

# ── 分类：实测报文 ────────────────────────────────────────────────────────
# 七次实测里的两种，逐字取自 2026-09-21 的 CI 日志。
LOGIN_FLAKE='Error response from daemon: Get "https://crpi-x.cn-beijing.personal.cr.aliyuncs.com/v2/": Get "https://dockerauth.cn-hangzhou.aliyuncs.com/auth?account=x": read tcp 10.1.0.148:47412->47.97.242.13:443: read: connection reset by peer'
RETAG_FLAKE='ERROR: failed to authorize: failed to fetch oauth token: Post "https://dockerauth.cn-hangzhou.aliyuncs.com/auth": read tcp 10.1.0.188:55580->120.55.35.38:443: read: connection reset by peer'

assert_eq "登录被重置 → 重试" "retry" "$(classify "$LOGIN_FLAKE")"
# 这一条**同时含 `failed to authorize`**：听起来像鉴权失败，其实是取票时被重置。
# 判据落在传输层证据上，不落在 authorize 这个词上——否则这条会被误判成凭据错。
assert_eq "retag 取票被重置 → 重试（虽然报文里有 failed to authorize）" \
  "retry" "$(classify "$RETAG_FLAKE")"

assert_eq "读超时 → 重试" "retry" "$(classify 'dial tcp: i/o timeout')"
assert_eq "TLS 握手超时 → 重试" "retry" "$(classify 'net/http: TLS handshake timeout')"
assert_eq "502 → 重试" "retry" "$(classify 'received unexpected HTTP status: 502 Bad Gateway')"

# ── 分类：凭据 / 权限错必须立刻失败 ────────────────────────────────────────
assert_eq "凭据错 → 不重试" "stop" \
  "$(classify 'Error response from daemon: Get "https://x/v2/": unauthorized: authentication required')"
assert_eq "权限被拒 → 不重试" "stop" \
  "$(classify 'denied: requested access to the resource is denied')"
assert_eq "密码错 → 不重试" "stop" \
  "$(classify 'Error response from daemon: login attempt failed with status: 401 Unauthorized')"
assert_eq "镜像不存在 → 不重试" "stop" \
  "$(classify 'ERROR: failed to resolve reference: manifest unknown')"
assert_eq "认不得的错 → 不重试（白名单，不是黑名单）" "stop" \
  "$(classify 'something nobody has seen before')"

# ── 重试行为：两面 ────────────────────────────────────────────────────────
# 用计数文件模拟「前两次抖、第三次好」。
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

flaky_then_ok() {
  local n
  n="$(cat "$tmp/n" 2>/dev/null || echo 0)"
  n=$((n + 1))
  printf '%s' "$n" > "$tmp/n"
  if [ "$n" -lt 3 ]; then
    echo "$LOGIN_FLAKE" >&2
    return 1
  fi
  echo "Login Succeeded"
}

always_unauthorized() {
  local n
  n="$(cat "$tmp/m" 2>/dev/null || echo 0)"
  printf '%s' "$((n + 1))" > "$tmp/m"
  echo 'unauthorized: authentication required' >&2
  return 1
}

# 退避会真 sleep（2s + 4s）。测试里把它短路掉，只验次数与结果。
sleep() { :; }

printf '0' > "$tmp/n"
set +e
with_registry_retry "登录" flaky_then_ok > "$tmp/out1" 2>&1
rc1=$?
set -e
assert_eq "网络错：第三次成功，退出码 0" "0" "$rc1"
assert_eq "网络错：确实调用了 3 次" "3" "$(cat "$tmp/n")"

printf '0' > "$tmp/m"
set +e
with_registry_retry "登录" always_unauthorized > "$tmp/out2" 2>&1
rc2=$?
set -e
assert_eq "凭据错：非 0 退出" "1" "$rc2"
# 这一条是这份测试的重点：**只调用一次**。凭据错被重试的话，真问题会被拖成
# 三次超时，看起来和网络抖动一模一样。
assert_eq "凭据错：只调用了 1 次，没有重试" "1" "$(cat "$tmp/m")"

exit "$fail"
