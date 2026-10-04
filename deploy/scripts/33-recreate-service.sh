#!/usr/bin/env bash
# deploy/scripts/33-recreate-service.sh
# 安全重建一个或多个平台服务以重载其 env（不走全量部署）。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-07-14
#
# 用途：改 secrets/*.env 或 .env.{svc} 后，只想让受影响的服务重载新值时用本脚本。
#   TD-037：裸跑 `docker compose up -d <svc>` 有两个坑，第二个会拆掉在跑的容器：
#     ① registry 默认值陷阱——compose 用 ${VX_IMAGE_REGISTRY:-ghcr.io}，但生产跑阿里云 ACR，
#        registry/namespace/tag 三变量在 /srv/vxture/runtime/.env（不在 compose 目录）。裸跑 →
#        解析成 ghcr.io/…:latest → 私有仓 denied。
#     ② tag 注入陷阱——VX_IMAGE_TAG 由晋升流水线注入具体版本号，runtime/.env 里是 latest，
#        本地无 :latest 镜像 → --force-recreate 拉取失败前可能已停容器 → 单服务重建反致其下线。
#   本脚本 = load_compose_env 带全变量 + 对每个目标写一份 pinned 覆盖，把 image 钉到其**当前在跑
#   容器的 Config.Image**（与 30-deploy 的 compose.pinned.yml 同一机制：后一个 -f 的 image 覆盖
#   前一个）+ --pull never --no-deps + 前置校验该镜像本地存在（不存在则拒绝，绝不 --force-recreate
#   拆容器）。
#
#   2026-09-01（#112）起 30-deploy 把每个服务钉到 amd64 内容 digest，容器跑的是
#   `registry/ns/img@sha256:<hex>`——引用里没有 tag。旧版从引用里 `##*:` 拆 tag、再要求多服务
#   tag 一致：对 digest 引用拆出裸 hex 当 tag → compose 解析成本地没有的 `img:<hex>`；多服务
#   digest 各不相同 → 「拒绝混批」。现在不解析引用、不比一致性：Config.Image 是什么就原样钉什么
#   （tag 形态 / digest 形态都认），每个服务各钉各的。lib/recreate-service.test.sh 用假 docker
#   喂两种形态证明。
#
# 运行：bash 33-recreate-service.sh <service> [<service> ...]
#   service = compose 服务名（不是容器名），只认 compose.platform.yml 里在册的 14 个：
#     auth-bff  admin-bff  console-bff  website-bff  gateway-bff  opera-bff  arche-bff
#     platform-api  website  console  admin  accounts  opera  arche
#   （册外名字一律拒绝；pg / redis 已上云，不在 compose 里。）
#
# 注意：本脚本只重载 env / 重建容器，**不拉新镜像、不改代码版本**——钉的是容器此刻在跑的那个
#   镜像，重建后代码一字不变、只重读 env。要上新代码走晋升 → deploy（31 → 30）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="${COMPOSE_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
COMPOSE_FILE="$COMPOSE_DIR/compose.platform.yml"
# 先定 RUNTIME_DIR 再 source：compose-env.sh 以它为 runtime/.env 的位置。
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"
# 统一变量入口：compose 里的 ${VX_*} 在调用方进程环境求值，tailnet 地址既不能
# 空默认（会绑定全网卡）也不能缺值即炸（排障脚本正是最需要能跑的时候）。
# 镜像三变量也由它从 runtime/.env 读出——目标服务的 image 随后被覆盖钉死，这三个值只用来让
# compose 把其余（不动的）服务的 image 串解析出来。
. "$COMPOSE_DIR/scripts/lib/compose-env.sh"
load_compose_env

# compose 服务名 → 容器名（按在跑容器取 Config.Image 用）。与 compose.platform.yml 的 14 个
# service / container_name 一一对应，lib/recreate-service.test.sh 对账——加服务忘了登记即红。
declare -A CONTAINER_OF=(
  [auth-bff]=vx-platform-auth-bff
  [admin-bff]=vx-platform-admin-bff
  [console-bff]=vx-platform-console-bff
  [website-bff]=vx-platform-website-bff
  [gateway-bff]=vx-platform-gateway-bff
  [opera-bff]=vx-platform-opera-bff
  [arche-bff]=vx-platform-arche-bff
  [platform-api]=vx-platform-api
  [website]=vx-platform-website
  [console]=vx-platform-console
  [admin]=vx-platform-admin
  [accounts]=vx-platform-accounts
  [opera]=vx-platform-opera
  [arche]=vx-platform-arche
)

if [ "$#" -eq 0 ]; then
  echo "用法：bash 33-recreate-service.sh <service> [<service> ...]" >&2
  echo "可选服务：${!CONTAINER_OF[*]}" >&2
  exit 2
fi

# ── 参数校验（先全量校验再动手，任一非法即整体拒绝；重复的只算一次）────────────
TARGETS=()
for svc in "$@"; do
  if [ -z "${CONTAINER_OF[$svc]+x}" ]; then
    echo "错误：未知服务 '$svc'（只认 compose.platform.yml 里在册的平台服务）。" >&2
    echo "可选：${!CONTAINER_OF[*]}" >&2
    exit 2
  fi
  case " ${TARGETS[*]:-} " in
    *" $svc "*) ;;
    *) TARGETS+=("$svc") ;;
  esac
done

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "错误：缺少 $COMPOSE_FILE" >&2
  exit 1
fi
if [ ! -f "$RUNTIME_DIR/.env" ]; then
  echo "错误：缺少 $RUNTIME_DIR/.env（registry/namespace/tailnet 变量来源）" >&2
  exit 1
fi

echo "==> [1/3] 逐服务读在跑镜像 + 前置校验本地镜像存在"
declare -A IMAGE_OF
for svc in "${TARGETS[@]}"; do
  cname="${CONTAINER_OF[$svc]}"
  if ! docker inspect "$cname" >/dev/null 2>&1; then
    echo "  错误：容器 $cname（服务 $svc）当前未运行——本脚本只重建在跑服务，拒绝执行。" >&2
    exit 1
  fi
  # 该容器实际在跑的镜像引用，原样取、不解析：
  #   digest 钉死后（30-deploy，2026-09-01 起）形如 registry/ns/platform_bff-auth@sha256:<hex>；
  #   钉死前 / 别的主机形如 registry/ns/platform_bff-auth:v0.26.20。两种都直接当 image 用。
  running_image="$(docker inspect --format '{{.Config.Image}}' "$cname")"
  if [ -z "$running_image" ]; then
    echo "  错误：读不到容器 $cname 的 Config.Image。" >&2
    exit 1
  fi
  # 前置校验：本地必须能按这个引用找到镜像（digest 引用 docker image inspect 也认）；否则
  # --pull never 会失败，但先在这里挡住，绝不进 up。
  if ! docker image inspect "$running_image" >/dev/null 2>&1; then
    echo "  错误：本地缺少镜像 $running_image——拒绝重建（避免拆掉在跑容器后拉取失败致其下线）。" >&2
    exit 1
  fi
  IMAGE_OF[$svc]="$running_image"
  echo "  [OK] $svc → $cname，image=$running_image（本地镜像在册）"
done

# ── 写 pinned 覆盖：只含本次目标，image 原样 = 在跑值；用完即删，不与 30 的 compose.pinned.yml 混 ──
PIN_DIR="$(mktemp -d)"
trap 'rm -rf "$PIN_DIR"' EXIT
PINNED_FILE="$PIN_DIR/compose.recreate-pinned.yml"
{
  echo "# 自动生成（33-recreate-service.sh）——只钉本次目标服务到其在跑的 Config.Image，用完即删。"
  echo "services:"
  for svc in "${TARGETS[@]}"; do
    printf '  %s:\n    image: %s\n' "$svc" "${IMAGE_OF[$svc]}"
  done
} > "$PINNED_FILE"
echo "  pinned 覆盖（$PINNED_FILE）："
sed 's/^/    /' "$PINNED_FILE"

echo ""
echo "==> [2/3] 重建（--pull never --no-deps --force-recreate，image 钉在跑值，仅目标服务）"
cd "$COMPOSE_DIR"
docker compose -f compose.platform.yml -f "$PINNED_FILE" \
  up -d --pull never --no-deps --force-recreate "${TARGETS[@]}"

echo ""
echo "==> [3/3] 等待目标容器就绪（最多 ${VX_READINESS_TIMEOUT:-90}s）"
deadline=$(( $(date +%s) + ${VX_READINESS_TIMEOUT:-90} ))
for svc in "${TARGETS[@]}"; do
  cname="${CONTAINER_OF[$svc]}"
  while :; do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cname" 2>/dev/null || echo missing)"
    case "$status" in
      healthy|running) echo "  [OK] $cname → $status"; break ;;
    esac
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "  !! $cname 超时未就绪（当前=$status）——请查 docker logs $cname" >&2
      exit 1
    fi
    sleep 3
  done
done

echo ""
echo "完成：${TARGETS[*]} 已按各自在跑镜像重建并就绪，env 已重载（代码版本未变）。"
