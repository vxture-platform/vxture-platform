#!/usr/bin/env bash
# deploy/scripts/20-sync-nginx-config.sh
# 将部署包 nginx/ 配置同步到 /srv/vxture/data/nginx/conf/
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-06-02
#
# 运行：sudo bash 20-sync-nginx-config.sh
# 幂等：重复运行安全；Nginx 容器运行中时会执行 nginx -t + reload
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$COMPOSE_DIR/nginx"
COMPOSE_SRC="$COMPOSE_DIR/compose.nginx.yml"
DST=/srv/vxture/data/nginx/conf
COMPOSE_DST=/srv/vxture/data/nginx/compose.yml

if [ ! -f "$SRC/nginx.conf" ]; then
  echo "错误：找不到 $SRC/nginx.conf，请确认部署包包含 nginx 配置（当前: $COMPOSE_DIR）"
  exit 1
fi
if [ ! -f "$COMPOSE_SRC" ]; then
  echo "错误：找不到 $COMPOSE_SRC，请确认部署包包含 compose.nginx.yml（当前: $COMPOSE_DIR）"
  exit 1
fi

echo "==> 同步 Nginx 配置：$SRC → $DST"
mkdir -p "$DST/conf.d" "$DST/sites-enabled" "$DST/snippets"
mkdir -p /srv/vxture/data/nginx/html
mkdir -p /srv/vxture/data/nginx/logs/nginx
mkdir -p /srv/vxture/data/nginx/ssl/live/vxture.com

cp -v "$SRC/nginx.conf"                     "$DST/nginx.conf"
cp -v "$SRC/conf.d/"*.conf                  "$DST/conf.d/"
cp -v "$SRC/snippets/"*.conf                "$DST/snippets/"
cp -v "$SRC/sites-enabled/"*.conf           "$DST/sites-enabled/"
cp -v "$COMPOSE_SRC"                        "$COMPOSE_DST"

# ── 模板渲染：admin vhost（2026-07-28 加固决策追加，与 opera 同一性质）──────
# 真实域名不入仓：从主机 runtime env 的 ADMIN_BASE_URL 取主机名渲染模板。
# admin 是既有长期生产服务，渲染为必选步骤 —— env 缺失或仍是占位符即报错退出，
# 不像 opera（尚未上产，可选跳过）；一旦这一步被静默跳过，admin 的公网路由
# 在下次同步时就会消失。
ADMIN_ENV_FILE="${ADMIN_ENV_FILE:-/srv/vxture/runtime/.env.admin-bff}"
ADMIN_TEMPLATE="$SRC/templates/admin.vhost.template"
if [ ! -f "$ADMIN_TEMPLATE" ]; then
  echo "错误：找不到 $ADMIN_TEMPLATE" >&2
  exit 1
fi
admin_base="$(grep -E '^ADMIN_BASE_URL=' "$ADMIN_ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true)"
admin_host="${admin_base#https://}"; admin_host="${admin_host#http://}"; admin_host="${admin_host%%/*}"
if [ -z "$admin_host" ] || [ "$admin_host" = "y.vxture.com" ]; then
  echo "错误：未在 $ADMIN_ENV_FILE 找到有效 ADMIN_BASE_URL（admin 是生产必选服务，不可跳过）" >&2
  exit 1
fi
VX_ADMIN_HOST="$admin_host" envsubst '${VX_ADMIN_HOST}' \
  <"$ADMIN_TEMPLATE" >"$DST/sites-enabled/admin.conf"
echo "==> 已渲染 admin vhost → $DST/sites-enabled/admin.conf"

# ── 模板渲染：能力控制台 vhost（product_250 批C）─────────────────────────────
# 真实域名不入仓（加固决策）：从主机 runtime env 的 OPERA_BASE_URL 取
# 主机名渲染模板。envsubst 只替换 ${VX_OPERA_HOST}，nginx 自身变量不受影响。
# env 缺失时跳过（该 vhost 未启用），不影响其余站点同步。
OPERA_ENV_FILE="${OPERA_ENV_FILE:-/srv/vxture/runtime/.env.opera-bff}"
OPERA_TEMPLATE="$SRC/templates/opera.vhost.template"
if [ -f "$OPERA_TEMPLATE" ]; then
  op_base="$(grep -E '^OPERA_BASE_URL=' "$OPERA_ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true)"
  op_host="${op_base#https://}"; op_host="${op_host#http://}"; op_host="${op_host%%/*}"
  if [ -n "$op_host" ] && [ "$op_host" != "x.vxture.com" ]; then
    VX_OPERA_HOST="$op_host" envsubst '${VX_OPERA_HOST}' \
      <"$OPERA_TEMPLATE" >"$DST/sites-enabled/opera.conf"
    echo "==> 已渲染能力控制台 vhost → $DST/sites-enabled/opera.conf"
  else
    rm -f "$DST/sites-enabled/opera.conf"
    echo "  提示：未在 $OPERA_ENV_FILE 找到有效 OPERA_BASE_URL，跳过能力控制台 vhost"
  fi
fi

echo ""
echo "同步完成，目录内容："
find "$DST" -type f | sort
echo "$COMPOSE_DST"

# 如果 nginx 容器正在运行，测试配置并热重载
if docker inspect vxture-nginx &>/dev/null 2>&1; then
  echo ""
  echo "==> 检测到 vxture-nginx 容器运行中，执行配置测试..."
  docker exec vxture-nginx nginx -t
  docker exec vxture-nginx nginx -s reload
  echo "Nginx 已热重载"
else
  echo ""
  echo "  提示：vxture-nginx 容器未运行，配置将在 compose up 时生效"
fi

echo ""
echo "  !! 检查 SSL 证书是否已放置（compose up 前必须）："
echo "     ls -la /srv/vxture/data/nginx/ssl/live/vxture.com/"
echo ""
echo "  启动 nginx（首次或更新）："
echo "     docker compose -f /srv/vxture/data/nginx/compose.yml up -d"
