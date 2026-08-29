#!/usr/bin/env bash
# deploy/scripts/31-regular-upgrade-platform.sh
# 聚合常规升级发布流程。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-06-07
#
# 运行：bash scripts/31-regular-upgrade-platform.sh
# 约束：常规升级只检查数据库可用性，不执行 migration 或 seed。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# 统一变量入口：compose 里的 ${VX_*} 在调用方进程环境求值，tailnet 地址既不能
# 空默认（会绑定全网卡）也不能缺值即炸（排障脚本正是最需要能跑的时候）。
. "$COMPOSE_DIR/scripts/lib/compose-env.sh"
. "$COMPOSE_DIR/scripts/lib/prune-images.sh"
load_compose_env
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"
NGINX_COMPOSE_FILE="/srv/vxture/data/nginx/compose.yml"

run_step() {
  local label="$1"
  shift
  echo ""
  echo "==> $label"
  "$@"
}

check_auth_runtime_contract() {
  local auth_env="$RUNTIME_DIR/.env.auth-bff"
  local turnstile_hosts

  if [ ! -f "$auth_env" ]; then
    echo "错误：缺少 runtime auth env：$auth_env" >&2
    exit 1
  fi

  if ! grep -qE '^COOKIE_DOMAIN_PLATFORM=.+$' "$auth_env"; then
    echo "错误：$auth_env 缺少 COOKIE_DOMAIN_PLATFORM。" >&2
    echo "runtime config 由人工维护，请补齐后再部署。" >&2
    exit 1
  fi

  turnstile_hosts="$(grep -E '^CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES=' "$auth_env" | tail -n 1 | cut -d= -f2- || true)"
  if [ -z "$turnstile_hosts" ]; then
    echo "错误：$auth_env 缺少 CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES。" >&2
    exit 1
  fi

  # 这一条守的是"widget 在哪个页面上被解开"：Turnstile 校验拿 siteverify 回的
  # hostname 比这张白名单。2026-08-29 核实：全仓渲染 widget 的只有 accounts
  # （OidcLoginForm / BindPhonePanel），所以必须在的是 accounts.vxture.com；
  # 此前这里要求 console.vxture.com，那是登录面还内嵌在 console 时的事实，
  # 早已不成立——留着它只会逼人把一个从不解 widget 的域名保留在白名单里。
  case ",$turnstile_hosts," in
    *,accounts.vxture.com,*) ;;
    *)
      echo "错误：CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES 必须包含 accounts.vxture.com（登录 widget 实际渲染的页面）。" >&2
      echo "runtime config 由人工维护，请补齐后再部署。" >&2
      exit 1
      ;;
  esac
}

cd "$COMPOSE_DIR"
echo "=== Vxture Regular Upgrade Platform ==="
echo "流程：13 -> 20 -> 21 -> 30 -> 40"

run_step "13 准备 runtime env" bash "$SCRIPT_DIR/13-prepare-runtime-env.sh"
run_step "检查 Auth runtime 契约" check_auth_runtime_contract
run_step "20 同步 Nginx 配置" bash "$SCRIPT_DIR/20-sync-nginx-config.sh"
run_step "启动或更新 Nginx" docker compose -f "$NGINX_COMPOSE_FILE" up -d
run_step "21 检查平台数据库" bash "$SCRIPT_DIR/21-prepare-platform-database.sh"
run_step "30 更新平台栈" bash "$SCRIPT_DIR/30-deploy-platform-stack.sh"
run_step "40 验证平台运行态" bash "$SCRIPT_DIR/40-verify-platform-runtime.sh"
# 新栈验证健康后，回收上一版本遗留的平台镜像，避免根盘随每次部署累积撑满。
# 只回收 platform_* 的旧版本 + dangling 层；**不再 `prune -a`**——那会把 21-prepare
# 的 postgres 工具镜像一起删掉，让下一次部署先去 Docker Hub 拉 5 分钟（见
# lib/prune-images.sh 头注里的三次实测）。清理失败不阻断本次已成功的部署。
prune_stale_platform_images() {
  docker image prune -f >/dev/null 2>&1 || true
  local inuse_file stale
  inuse_file="$(mktemp)"
  docker ps -a --format '{{.Image}}' > "$inuse_file" 2>/dev/null || true
  stale="$(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null     | select_stale_platform_images "${VX_IMAGE_TAG:-}" "$inuse_file")"
  rm -f "$inuse_file"
  if [ -z "$stale" ]; then
    echo "  没有可回收的平台旧镜像。"
    return 0
  fi
  echo "  回收（当前 tag ${VX_IMAGE_TAG:-?} 与在用镜像已排除）："
  printf '    %s
' $stale
  # shellcheck disable=SC2086
  docker rmi $stale >/dev/null 2>&1 || true
}
run_step "41 回收平台旧镜像（控制根盘占用；工具镜像不动）" prune_stale_platform_images

echo ""
echo "=== Regular upgrade flow done ==="
echo "提示：基线/证书/防火墙等常态漂移巡检由 platform-alerts 定时 workflow 负责（51-check-platform-alerts.sh），不在部署链内重复执行。"
