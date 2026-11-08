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
  local captcha_enabled captcha_customer captcha_workforce captcha_key
  if [ ! -f "$auth_env" ]; then
    echo "错误：缺少 runtime auth env：$auth_env" >&2
    exit 1
  fi
  if [ -z "$(env_value "$auth_env" COOKIE_DOMAIN_PLATFORM)" ]; then
    echo "错误：$auth_env 缺少 COOKIE_DOMAIN_PLATFORM。" >&2
    echo "runtime config 由人工维护，请补齐后再部署。" >&2
    exit 1
  fi
  # Validate runtime Aliyun scenes before any stack mutation. Never print secret values.
  captcha_enabled="$(env_value "$auth_env" ALIYUN_CAPTCHA_ENABLED)"
  if [ "$captcha_enabled" != "true" ]; then
    echo "错误：生产环境要求 ALIYUN_CAPTCHA_ENABLED=true。" >&2
    exit 1
  fi
  for captcha_key in ALIYUN_CAPTCHA_ACCESS_KEY_ID ALIYUN_CAPTCHA_ACCESS_KEY_SECRET ALIYUN_CAPTCHA_PREFIX ALIYUN_CAPTCHA_CUSTOMER_SCENE_ID ALIYUN_CAPTCHA_WORKFORCE_SCENE_ID; do
    if [ -z "$(env_value "$auth_env" "$captcha_key")" ]; then
      echo "错误：auth-bff 缺少 $captcha_key。" >&2
      exit 1
    fi
  done
  captcha_customer="$(env_value "$auth_env" ALIYUN_CAPTCHA_CUSTOMER_SCENE_ID)"
  captcha_workforce="$(env_value "$auth_env" ALIYUN_CAPTCHA_WORKFORCE_SCENE_ID)"
  if [ "$captcha_customer" = "$captcha_workforce" ]; then
    echo "错误：customer/workforce 人机验证场景必须不同。" >&2
    exit 1
  fi
  case "$(env_value "$auth_env" ALIYUN_CAPTCHA_REGION)" in
    cn|sgp) ;;
    *) echo "错误：ALIYUN_CAPTCHA_REGION 必须是 cn 或 sgp。" >&2; exit 1 ;;
  esac
  # Every OTP purpose must resolve to an explicit, distinct provider scheme.
  local sms_env="$RUNTIME_DIR/secrets/platform-sms.env"
  local sms_key sms_value existing
  local -a sms_schemes=()
  if [ ! -f "$sms_env" ]; then
    echo "错误：缺少短信凭据配置文件。" >&2
    exit 1
  fi
  for sms_key in ALIYUN_SMS_SCHEME_NAME ALIYUN_SMS_CUSTOMER_LOGIN_SCHEME_NAME ALIYUN_SMS_CUSTOMER_REGISTER_SCHEME_NAME ALIYUN_SMS_CUSTOMER_SOCIAL_BIND_SCHEME_NAME ALIYUN_SMS_WORKFORCE_LOGIN_SCHEME_NAME ALIYUN_SMS_WORKFORCE_PHONE_CHANGE_SCHEME_NAME ALIYUN_SMS_CUSTOMER_SECURITY_SCHEME_NAME ALIYUN_SMS_CUSTOMER_PHONE_CHANGE_SCHEME_NAME; do
    sms_value="$(env_value "$sms_env" "$sms_key")"
    if [ -z "$sms_value" ]; then
      echo "错误：短信配置缺少 $sms_key。" >&2
      exit 1
    fi
    if [ "${#sms_value}" -gt 20 ]; then
      echo "错误：$sms_key 不能超过 20 个字符。" >&2
      exit 1
    fi
    for existing in "${sms_schemes[@]}"; do
      if [ "$sms_value" = "$existing" ]; then
        echo "错误：短信验证码方案必须按用途隔离。" >&2
        exit 1
      fi
    done
    sms_schemes+=("$sms_value")
  done
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
