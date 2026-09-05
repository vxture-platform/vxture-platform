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
. "$COMPOSE_DIR/scripts/lib/env-values.sh"
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
  local turnstile_hosts raw_line
  if [ ! -f "$auth_env" ]; then
    echo "错误：缺少 runtime auth env：$auth_env" >&2
    exit 1
  fi
  if [ -z "$(env_value "$auth_env" COOKIE_DOMAIN_PLATFORM)" ]; then
    echo "错误：$auth_env 缺少 COOKIE_DOMAIN_PLATFORM。" >&2
    echo "runtime config 由人工维护，请补齐后再部署。" >&2
    exit 1
  fi
  # 这一条守的是"widget 在哪个页面上被解开"：Turnstile 校验拿 siteverify 回的
  # hostname 比这张白名单。2026-08-29 核实：全仓渲染 widget 的只有 accounts
  # （OidcLoginForm / BindPhonePanel），所以必须在的是 accounts.vxture.com；
  # 此前这里要求 console.vxture.com，那是登录面还内嵌在 console 时的事实。
  #
  # 值用 env_value / csv_contains 读（lib/env-values.sh）：引号、`= ` 后的空格、
  # 行尾 CR、逗号两侧空格都不算数。v0.26.3 的部署就死在这里——值是对的，
  # 只是写法不合一个 `case` 模式的口味；守卫读值必须按语义读。
  turnstile_hosts="$(env_value "$auth_env" CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES)"
  if [ -z "$turnstile_hosts" ]; then
    echo "错误：$auth_env 缺少 CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES。" >&2
    exit 1
  fi
  # 判据与校验器的 isAllowedHostname 完全一致：精确命中，或 apex/父域按后缀覆盖。
  # v0.26.4 的部署曾因"字面上没有 accounts.vxture.com"被拦，而当时线上的值
  # `vxture.com,console.vxture.com,ruyin.ai` 靠 apex 后缀覆盖着 accounts、登录一直是通的
  # ——一条契约检查拦下一个能工作的配置，是检查在撒谎，不是配置错了。
  # 靠 apex 兜住只 warn：apex 会放开整个子域，该收窄，但那是运维决定，不是部署失败。
  local hit
  if ! hit="$(csv_covers_host "$turnstile_hosts" accounts.vxture.com)"; then
    raw_line="$(grep -nE '^[[:space:]]*CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES[[:space:]]*=' "$auth_env" | tail -n 1 | cat -A)"
    echo "错误：CF_TURNSTILE_TENANT_ALLOWED_HOSTNAMES 没有覆盖 accounts.vxture.com（登录 widget 实际渲染的页面）。" >&2
    echo "  读到的值：[$turnstile_hosts]" >&2
    echo "  原始行（cat -A）：$raw_line" >&2
    echo "runtime config 由人工维护，请补齐后再部署。" >&2
    exit 1
  fi
  if [ "$hit" != "accounts.vxture.com" ]; then
    echo "警告：accounts.vxture.com 只靠 apex/父域 '$hit' 的后缀匹配覆盖。apex 会放开整个子域，建议收窄为 accounts.vxture.com。" >&2
  fi
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
# 只回收 platform_* 且没有任何容器引用的镜像；**不再 `prune -a`**——那会把 21-prepare
# 的 postgres 工具镜像一起删掉，让下一次部署先去 Docker Hub 拉 5 分钟（见
# lib/prune-images.sh 头注）。清理失败不阻断本次已成功的部署。
#
# 2026-09-05 改为按**镜像 ID** 比对：按摘要拉取的镜像没有 tag，旧逻辑按 repo:tag 挑、
# 又跳过 <none>，对它们一个都不删，366 个版本堆满了 40 GB 根盘（见 lib 头注）。
prune_stale_platform_images() {
  docker image prune -f >/dev/null 2>&1 || true
  local inuse_file stale
  inuse_file="$(mktemp)"
  # 容器引用统一解析成全长镜像 ID（tag / repo@digest / 短 ID 三种形态都归一）。
  docker ps -aq 2>/dev/null | xargs -r docker inspect --format '{{.Image}}' > "$inuse_file" 2>/dev/null || true
  stale="$(docker images --no-trunc --format '{{.Repository}} {{.ID}}' 2>/dev/null     | select_stale_platform_images "$inuse_file")"
  rm -f "$inuse_file"
  if [ -z "$stale" ]; then
    echo "  没有可回收的平台旧镜像。"
  else
    echo "  回收 $(printf '%s
' $stale | wc -l | tr -d ' ') 个未被任何容器引用的平台镜像："
    printf '    %s
' $stale
    # shellcheck disable=SC2086
    docker rmi $stale >/dev/null 2>&1 || true
  fi
  echo "  根盘：$(df -h / | awk 'NR==2 {print $3 " 已用 / " $4 " 可用（" $5 "）"}')"
}
run_step "41 回收平台旧镜像（控制根盘占用；工具镜像不动）" prune_stale_platform_images

echo ""
echo "=== Regular upgrade flow done ==="
echo "提示：基线/证书/防火墙等常态漂移巡检由 platform-alerts 定时 workflow 负责（51-check-platform-alerts.sh），不在部署链内重复执行。"
