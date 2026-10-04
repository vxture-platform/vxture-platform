#!/usr/bin/env bash
# deploy/scripts/40-verify-platform-runtime.sh
# 验证平台运行态：env 审计、Compose、容器、健康检查、Nginx、公网 HTTPS。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-06-02
#
# 运行：bash 40-verify-platform-runtime.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# 统一变量入口：compose 里的 ${VX_*} 在调用方进程环境求值，tailnet 地址既不能
# 空默认（会绑定全网卡）也不能缺值即炸（排障脚本正是最需要能跑的时候）。
. "$COMPOSE_DIR/scripts/lib/compose-env.sh"
. "$COMPOSE_DIR/scripts/lib/nginx-idp-port.sh"
load_compose_env
COMPOSE_FILE="$COMPOSE_DIR/compose.platform.yml"
RUNTIME_DIR="${RUNTIME_DIR:-/srv/vxture/runtime}"

FAILED=0

mark_fail() {
  FAILED=1
}

run_check() {
  local label="$1"
  shift

  echo "==> $label"
  if "$@"; then
    echo "  [OK] $label"
  else
    echo "  [FAIL] $label"
    mark_fail
  fi
  echo ""
}

check_file() {
  local file="$1"
  if [ -f "$file" ]; then
    echo "  [OK]   $file"
  else
    echo "  [MISS] $file"
    mark_fail
  fi
}

check_required_files() {
  check_file "$COMPOSE_FILE"
  check_file "$RUNTIME_DIR/.env"
  check_file "$RUNTIME_DIR/.env.auth-bff"
  check_file "$RUNTIME_DIR/.env.gateway-bff"
  check_file "$RUNTIME_DIR/.env.website-bff"
  check_file "$RUNTIME_DIR/.env.console-bff"
  check_file "$RUNTIME_DIR/.env.admin-bff"
  # 2026-10-04 补齐：这份清单此前停在五个 RP 时代。30-deploy [1/4] 要的每一份这里都要有，
  # 否则「40-verify 全 OK」对缺 .env.arche-bff / 新 secrets 文件的主机是盲的，要到下次 deploy
  # 才被 30 拦下。三处清单（30 / 40 / 51）由 lib/runtime-file-lists.test.sh 钉成一致。
  check_file "$RUNTIME_DIR/.env.opera-bff"
  check_file "$RUNTIME_DIR/.env.arche-bff"
  check_file "$RUNTIME_DIR/.env.platform-api"
  check_file "$RUNTIME_DIR/secrets/tair-pw-default"
  check_file "$RUNTIME_DIR/secrets/platform.env"
  check_file "$RUNTIME_DIR/secrets/platform-mail.env"
  check_file "$RUNTIME_DIR/secrets/platform-sms.env"
  check_file "$RUNTIME_DIR/secrets/platform-identity.env"
  check_file "$RUNTIME_DIR/secrets/platform-app.env"
  check_file "$RUNTIME_DIR/secrets/platform-idp-internal.env"
}

compose_cmd() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

check_service_health() {
  local service="$1"
  local url="$2"

  echo -n "  $service $url -> "
  if compose_cmd exec -T "$service" curl -sf --max-time 10 "$url" >/dev/null; then
    echo "OK"
  else
    echo "FAIL"
    mark_fail
  fi
}

check_platform_health() {
  # 端口以 compose.platform.yml 的 healthcheck 为准（那是唯一被容器自己持续验证的一份）。
  #
  # L0 端口重排后这份清单过时了三处：`admin` 3040→3030、`auth-bff` 3061→3081、
  # `admin-bff` 3043→3031（最后一条方向还是反的，见 15-migrate-runtime-ports.sh）。
  # 三条在 v0.20.28 的部署里同时 FAIL，而那时 14/14 容器自身的 healthcheck 全绿、
  # 四个公网端点也全通——**报警的是这份清单，不是平台**。
  #
  # 探测走 `compose exec -T <service>`，在各自容器内 curl，所以端口写错只会连不上、
  # 不会打到别的服务上（一度以为 `admin` 探 3040 会命中 opera 而形成假绿，实测三条
  # 全是 FAIL，那个担心不成立）。
  #
  # 另外补上原先完全漏掉的四个：opera / opera-bff / accounts / platform-api。
  # **platform-api 正是上一版唯一真出问题的那个**——它 unhealthy 了整整一轮，而这份
  # 清单里根本没有它，是靠 `docker ps` 的 STATUS 才被发现的。
  check_service_health "website" "http://localhost:3000/"
  check_service_health "console" "http://localhost:3020/"
  check_service_health "admin" "http://localhost:3030/"
  check_service_health "opera" "http://localhost:3040/"
  check_service_health "accounts" "http://localhost:3080/"
  check_service_health "gateway-bff" "http://localhost:8000/healthz"
  check_service_health "auth-bff" "http://localhost:3081/healthz"
  check_service_health "website-bff" "http://localhost:3001/healthz"
  check_service_health "console-bff" "http://localhost:3021/healthz"
  check_service_health "admin-bff" "http://localhost:3031/healthz"
  check_service_health "opera-bff" "http://localhost:3041/healthz"
  # arche-bff（治理平面 BFF，内部面的第三个发送方）此前不在清单里：切换日「全 healthy」
  # 对它是盲的。端口按 compose 自己的 healthcheck（3051）。
  check_service_health "arche-bff" "http://localhost:3051/healthz"
  check_service_health "platform-api" "http://localhost:8080/healthz"
}

check_nginx_runtime() {
  if ! docker inspect vxture-nginx >/dev/null 2>&1; then
    echo "  [FAIL] vxture-nginx container not found"
    return 1
  fi

  docker exec vxture-nginx nginx -t
}

check_public_https() {
  local url="$1"

  echo -n "  $url -> "
  if curl -fsS --max-time 15 -o /dev/null "$url"; then
    echo "OK"
  else
    echo "FAIL"
    mark_fail
  fi
}

# tailnet 边缘带的两个别名都由 vxture-nginx 发布、只绑 tailnet 接口、按路径只放产品面。
# 从宿主机打自己的 tailnet 地址（宿主能连到自己发布的口）：
#   :8080/healthz                      → 200  platform-api 别名（此前没有任何运行态检查）
#   :8081/healthz                      → 200  IdP 别名，经 nginx 到 auth-bff（E1 PR D）
#   :8081/internal/operator/sessions   → 404  **必须是 nginx 的 404，不是 auth-bff 的 401**：401 意味着
#                                             auth-bff 又被直接发布了、或 nginx 把 /internal/ 转了过去——门回到路边
#   宿主口 :8081 的发布者                → 恰好 vxture-nginx（docker inspect 的端口绑定，lib/nginx-idp-port.sh；
#                                             不读 docker ps 的 PORTS 列——它把 nginx 的 8080+8081 折成一个区间）
check_tailnet_aliases() {
  local base url code publishers cls
  if [ -z "${VX_WORKER01_TAILNET_IP:-}" ]; then
    echo "  [FAIL] VX_WORKER01_TAILNET_IP 为空（runtime/.env）——别名探针无从打起"
    mark_fail
    return 0
  fi
  base="http://$VX_WORKER01_TAILNET_IP"
  check_public_https "$base:8080/healthz"
  check_public_https "$base:${IDP_ALIAS_PORT}/healthz"

  url="$base:${IDP_ALIAS_PORT}/internal/operator/sessions"
  echo -n "  $url -> "
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$url" || echo 000)"
  if [ "$code" = "404" ]; then
    echo "404 (nginx)"
  else
    echo "FAIL (got $code, want 404 —— 401 = auth-bff 又被直接发布 / nginx 转了 /internal/；000 = 别名没起来)"
    mark_fail
  fi

  echo -n "  host :${IDP_ALIAS_PORT} publisher -> "
  publishers="$(idp_alias_publishers 2>/dev/null || true)"
  cls="$(idp_alias_classify "$publishers" "")"
  if [ "$cls" = "nginx" ]; then
    echo "$IDP_ALIAS_NGINX_CONTAINER"
  else
    echo "FAIL ($cls; want exactly $IDP_ALIAS_NGINX_CONTAINER)"
    mark_fail
  fi
}

echo "=== Vxture Platform Runtime Verification ==="
echo ""

echo "==> Required files"
check_required_files
echo ""

# env 审计已由部署前 fail-fast 闸（30-deploy-platform-stack.sh）独占执行，部署中 env 不变，此处不再重复。

run_check "Docker Compose config" \
  compose_cmd config --quiet

run_check "Docker Compose service status" \
  compose_cmd ps

echo "==> Internal health endpoints"
check_platform_health
echo ""

run_check "Nginx config test" \
  check_nginx_runtime

echo "==> Tailnet aliases (nginx :8080 platform-api / :${IDP_ALIAS_PORT} IdP)"
check_tailnet_aliases
echo ""

echo "==> Public HTTPS endpoints"
check_public_https "https://vxture.com/"
# ruyin.work 与 vxture.com 指同一张占位页，但它是**另一个注册域**，靠共用证书 SAN
# 的后两项才成立。上面那个 check 用的 curl 没有 -k，证书名不匹配会直接 FAIL——所以
# 这一条是「SAN 扩了没扩」在公网侧唯一会变红的判据，vxture.com 那条对此永远是绿的。
check_public_https "https://ruyin.work/"
check_public_https "https://console.vxture.com/"
# admin's real hostname is not hardcoded here (hardening, same nature as
# opera): read from the runtime env this host already has.
admin_base="$(grep -E '^ADMIN_BASE_URL=' "$RUNTIME_DIR/.env.admin-bff" 2>/dev/null | head -1 | cut -d= -f2-)"
if [ -n "$admin_base" ]; then
  check_public_https "${admin_base%/}/"
else
  echo "  [skip] admin public endpoint — ADMIN_BASE_URL not found in $RUNTIME_DIR/.env.admin-bff"
fi
check_public_https "https://api.vxture.com/healthz"
echo ""

if [ "$FAILED" -eq 0 ]; then
  echo "=== Verification OK ==="
else
  echo "=== Verification FAILED ==="
  exit 1
fi
