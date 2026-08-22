#!/usr/bin/env bash
# deploy/scripts/lib/compose-env.sh
# 供所有 docker compose 调用方 source 的统一变量入口。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
#
# 用法（在调用 docker compose 之前）：
#   . "$(dirname "$0")/lib/compose-env.sh"   # 或 lib 相对本脚本的正确路径
#   load_compose_env
#
# 为什么要有这个文件：
# compose 文件里的 ${VX_*} 由 docker compose 在**调用方的进程环境**里求值。
# 镜像三变量原本靠 compose 内的 `:-` 默认值兜底（ghcr.io/<org>/latest），所以
# 只有少数脚本显式导出它们，其余裸跑也能解析。tailnet 地址不能这么办：
#   - 用 `:-` 空默认，`":3061:3061"` 会退化成绑定**所有网卡**，把仅 tailnet 可达
#     的内部端口暴露到公网——比不参数化更糟；
#   - 用 `:?` 缺值即失败，则任何忘记导出的调用方（排障/重置脚本正是最需要能跑的
#     时候）会直接炸。
# 两难的出路是让**每个**调用方都拿到值，于是有了这个共用加载器。
set -o pipefail

# 主机运行时目录（真实值只存在于主机，公开仓只留占位符）。
COMPOSE_ENV_RUNTIME_DIR="${RUNTIME_DIR:-${COMPOSE_ENV_RUNTIME_DIR:-/srv/vxture/runtime}}"

# 读取顺序：已导出的环境变量 > runtime/.env > 默认值。
# 与 30-deploy-platform-stack.sh 原有 read_compose_env 行为一致（含去引号）。
read_compose_env() {
  local key="$1"
  local default_value="${2-}"
  local value=""

  if [ "${!key+x}" = "x" ]; then
    value="${!key}"
  elif [ -f "$COMPOSE_ENV_RUNTIME_DIR/.env" ]; then
    value="$(grep -E "^${key}=" "$COMPOSE_ENV_RUNTIME_DIR/.env" | tail -n 1 | cut -d= -f2- || true)"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
  fi

  printf "%s" "${value:-$default_value}"
}

# 导出 compose 插值所需的全部变量。幂等，可重复 source。
load_compose_env() {
  # namespace 兜底随拆仓改 vxture → vxture-platform（2026-08-22）：镜像自
  # v0.21.x 起发布在 ghcr.io/vxture-platform/ 下，旧默认值会让忘记导出该变量的
  # 手工 compose 去拉一个已停更的命名空间——拉得到旧 tag，症状是「部署成功但跑的
  # 是老代码」，比拉不到更难发现。常规 CD 路径不受影响：deploy.yml 显式传三变量。
  export VX_IMAGE_REGISTRY="$(read_compose_env VX_IMAGE_REGISTRY ghcr.io)"
  export VX_IMAGE_NAMESPACE="$(read_compose_env VX_IMAGE_NAMESPACE vxture-platform)"
  export VX_IMAGE_TAG="$(read_compose_env VX_IMAGE_TAG latest)"

  # tailnet 地址无默认值：缺失时 compose 里的 `:?` 会带着下面这句提示中止，
  # 而不是静默把端口发布到 0.0.0.0。
  export VX_WORKER01_TAILNET_IP="$(read_compose_env VX_WORKER01_TAILNET_IP "")"
  export VX_WORKER02_TAILNET_IP="$(read_compose_env VX_WORKER02_TAILNET_IP "")"

  if [ -z "$VX_WORKER01_TAILNET_IP" ] || [ -z "$VX_WORKER02_TAILNET_IP" ]; then
    echo "警告：$COMPOSE_ENV_RUNTIME_DIR/.env 缺少 VX_WORKER01_TAILNET_IP / VX_WORKER02_TAILNET_IP。" >&2
    echo "      涉及端口绑定的 compose 命令会中止（这是有意的：空值会绑定全网卡）。" >&2
    echo "      补法：把两行写进该文件，键名已在 39-audit-env.mjs 白名单内。" >&2
  fi
}
