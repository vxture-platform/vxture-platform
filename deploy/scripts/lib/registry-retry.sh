#!/usr/bin/env bash
# deploy/scripts/lib/registry-retry.sh
# 对镜像仓库的认证握手包一层退避重试（TD-050）。
# 运行：被 .github/workflows/docker-build.yml 的各步 source 后调用 `with_registry_retry`。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-09-22
#
# ── 为什么需要 ──
# 2026-09-21 一天内七次：docker-build 的腿挂在对 ACR 的认证握手上，报文固定
# `read: connection reset by peer`，对端 dockerauth.cn-hangzhou.aliyuncs.com，
# 重跑必过。不是凭据、不是权限，是上游网络抖动（TD-050）。
#
# ── 失败点不止 docker login ──
# retag 步骤的 `docker buildx imagetools create` **自己**去取 OAuth token，不经过
# 登录态，实测失败率与 login 相当：
#   docker login        → Error response from daemon: Get ".../v2/": … connection reset by peer
#   imagetools create   → failed to authorize: failed to fetch oauth token: Post "…": … connection reset by peer
# 所以只包 login 治不了一半。本函数两处都用。
#
# ── 判据用白名单，不用黑名单 ──
# **只有明确认得的网络错才重试，其余一律立刻失败。** 反过来（「认得的凭据错不重试，
# 其余都重试」）会把密码过期、权限被撤这类真问题拖成三次超时，看起来和这条抖动
# 一模一样——而那正是这个重试最不该掩盖的东西。
#
# 注意第二条报文里同时含 `failed to authorize`：它**听起来**像鉴权失败，其实是取票
# 时被重置。所以判据落在 `connection reset by peer` 这类**传输层**证据上，不落在
# 「authorize/authenticate」这类词上——后者两种情况都会出现，区分不开。

# 认得的、可重试的网络错。逐条都有实测来源或是标准瞬态。
REGISTRY_RETRYABLE_PATTERNS='connection reset by peer|i/o timeout|TLS handshake timeout|unexpected EOF|context deadline exceeded|502 Bad Gateway|503 Service Unavailable'

# 输出里有没有可重试的证据。`printf %s` 而不是 echo：报文里带反斜杠时 echo 会吃掉。
registry_error_is_retryable() {
  printf '%s' "$1" | grep -qiE "$REGISTRY_RETRYABLE_PATTERNS"
}

# registry_login_once <registry> <user> <装着密码的环境变量名>
#
# 登录**一次**，不含重试——管道没法直接当 `with_registry_retry` 的参数传，所以包成
# 函数由它调。密码走**环境变量名**间接引用（`${!3}`）而不是直接当参数：参数会出现
# 在进程表里，密码不该在那儿露脸。
registry_login_once() {
  printf '%s' "${!3}" | docker login "$1" -u "$2" --password-stdin
}

# with_registry_retry <描述> <命令...>
#
# 最多三次，退避 2/4 秒。重试次数与退避**写进日志**——不然日后「没再挂过」分不清
# 是治好了还是运气。
with_registry_retry() {
  local label="$1"
  shift
  local attempt=1 max=3 delay=2 output status

  # `set` 是**全局**的，不是函数作用域：无条件 `set -e` 会把调用方的 `set +e`
  # 覆盖掉，于是本函数 return 非零时整个脚本被 errexit 干掉（单测当场抓到）。
  # 所以先记住调用方的状态，用完原样还回去。
  local had_errexit=0
  case $- in *e*) had_errexit=1 ;; esac

  while :; do
    # 合并 stderr：两类报文都走 stderr，分开取会漏掉判据。
    set +e
    output="$("$@" 2>&1)"
    status=$?
    [ "$had_errexit" -eq 1 ] && set -e

    printf '%s\n' "$output"

    if [ "$status" -eq 0 ]; then
      if [ "$attempt" -gt 1 ]; then
        echo "[registry-retry] ${label}：第 ${attempt} 次成功（前 $((attempt - 1)) 次是网络抖动，TD-050）"
      fi
      return 0
    fi

    if ! registry_error_is_retryable "$output"; then
      echo "[registry-retry] ${label}：失败且**不是**认得的网络错，立即退出（不重试，免得把真问题拖成超时）" >&2
      return "$status"
    fi

    if [ "$attempt" -ge "$max" ]; then
      echo "[registry-retry] ${label}：网络错重试 ${max} 次仍失败，放弃（TD-050）" >&2
      return "$status"
    fi

    echo "[registry-retry] ${label}：第 ${attempt}/${max} 次撞到网络错，${delay}s 后重试（TD-050）" >&2
    sleep "$delay"
    attempt=$((attempt + 1))
    delay=$((delay * 2))
  done
}
