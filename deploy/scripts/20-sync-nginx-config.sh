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
# 统一变量入口：compose 里的 ${VX_*} 在调用方进程环境求值，tailnet 地址既不能
# 空默认（会绑定全网卡）也不能缺值即炸（排障脚本正是最需要能跑的时候）。
. "$COMPOSE_DIR/scripts/lib/compose-env.sh"
load_compose_env
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

# tailnet 地址不入公开仓：仓内配置写 ${VX_WORKER0x_TAILNET_IP} 占位，同步时渲染。
# envsubst 给了**显式变量列表**，所以 nginx 自己的 $host / $request_uri /
# $proxy_add_x_forwarded_for 等一概不受影响——与下方 admin / opera vhost 模板同一手法。
if [ -z "${VX_WORKER01_TAILNET_IP:-}" ] || [ -z "${VX_WORKER02_TAILNET_IP:-}" ]; then
  echo "错误：缺少 VX_WORKER01_TAILNET_IP / VX_WORKER02_TAILNET_IP，无法渲染 nginx 配置。" >&2
  echo "      请在 ${COMPOSE_ENV_RUNTIME_DIR:-/srv/vxture/runtime}/.env 中设置这两个键。" >&2
  echo "      （不允许留空：proxy_pass 会指向空主机，nginx -t 必然失败。）" >&2
  exit 1
fi

render_nginx() {
  local src="$1" dst="$2"
  envsubst '${VX_WORKER01_TAILNET_IP} ${VX_WORKER02_TAILNET_IP}' < "$src" > "$dst"
  echo "  渲染 $(basename "$src") → $dst"
}

render_nginx "$SRC/nginx.conf" "$DST/nginx.conf"
for f in "$SRC/conf.d/"*.conf;        do render_nginx "$f" "$DST/conf.d/$(basename "$f")"; done
for f in "$SRC/snippets/"*.conf;      do render_nginx "$f" "$DST/snippets/$(basename "$f")"; done
# 先清后渲：sites-enabled 的每一份都由本脚本产出（仓内 conf + 下方 admin/opera
# 模板），"只拷不删"会让改名/退役的旧文件永远活着——2026-08-18 实查线上就躺着
# 一份前模板时代的 admin 域名 vhost 残留（文件名即真实域名，按 product_250 §2
# 此处以 y.vxture.com 占位指代），与渲出的 admin.conf 同名 server_name 冲突，
# 且把 /varda/ 指向 3080（如今是 accounts 的 UI 口）。宁可整目录重建。
# 失败安全：脚本 set -e，渲染中途失败则不会走到下方 reload，运行中的 nginx
# 不受影响；下次成功运行即完整重建。
rm -f "$DST/sites-enabled/"*.conf
for f in "$SRC/sites-enabled/"*.conf; do render_nginx "$f" "$DST/sites-enabled/$(basename "$f")"; done
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
VX_ADMIN_HOST="$admin_host" envsubst '${VX_ADMIN_HOST} ${VX_WORKER01_TAILNET_IP} ${VX_WORKER02_TAILNET_IP}' \
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
    VX_OPERA_HOST="$op_host" envsubst '${VX_OPERA_HOST} ${VX_WORKER01_TAILNET_IP} ${VX_WORKER02_TAILNET_IP}' \
      <"$OPERA_TEMPLATE" >"$DST/sites-enabled/opera.conf"
    echo "==> 已渲染能力控制台 vhost → $DST/sites-enabled/opera.conf"
  else
    rm -f "$DST/sites-enabled/opera.conf"
    echo "  提示：未在 $OPERA_ENV_FILE 找到有效 OPERA_BASE_URL，跳过能力控制台 vhost"
  fi
fi

# ── 模板渲染：平台治理平面 vhost（Arche）────────────────────────────────────
# 真实域名不入仓（加固决策）：从主机 runtime env 的 ARCHE_BASE_URL 取主机名渲染。
# env 缺失或仍是占位符时跳过（该 vhost 未启用），不影响其余站点同步。
ARCHE_ENV_FILE="${ARCHE_ENV_FILE:-/srv/vxture/runtime/.env.arche-bff}"
ARCHE_TEMPLATE="$SRC/templates/arche.vhost.template"
if [ -f "$ARCHE_TEMPLATE" ]; then
  ar_base="$(grep -E '^ARCHE_BASE_URL=' "$ARCHE_ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true)"
  ar_host="${ar_base#https://}"; ar_host="${ar_host#http://}"; ar_host="${ar_host%%/*}"
  if [ -n "$ar_host" ] && [ "$ar_host" != "g.vxture.com" ]; then
    VX_ARCHE_HOST="$ar_host" envsubst '${VX_ARCHE_HOST} ${VX_WORKER01_TAILNET_IP} ${VX_WORKER02_TAILNET_IP}' \
      <"$ARCHE_TEMPLATE" >"$DST/sites-enabled/arche.conf"
    echo "==> 已渲染平台治理平面 vhost → $DST/sites-enabled/arche.conf"
  else
    rm -f "$DST/sites-enabled/arche.conf"
    echo "  提示：未在 $ARCHE_ENV_FILE 找到有效 ARCHE_BASE_URL，跳过平台治理平面 vhost"
  fi
fi

# ── 模板渲染：L3 智能体通配兜底 vhost + 路由表（owner 2026-09-10）────────────
# 此前每接一个智能体都要手写一份 vhost 进仓再发版。智能体持续上线，这条路每次都走
# 一遍。现在改成：一份 `*.vxture.com` 兜底 + 一张从**产品登记**生成的 map，运营者在
# opera 填「边缘上游」即可，仓里一个字不用改。
#
# 精确 server_name 的 vhost（arda/atlas/karda/runos/vxtpl 与平台自己那几个面）按
# nginx 的匹配优先级照旧压过通配，**一个都不用迁**。
#
# 顺序要紧：路由表必须在下面 `nginx -t` **之前**产出——snippets/agent-upstream.conf
# 里的 map include 了它，文件不存在则 nginx -t 直接失败。
AGENT_MAP="$DST/snippets/agents-upstream.map"
AGENT_RENDERER="$SRC/render-agent-map.mjs"
DB_ENV="${DB_ENV:-/srv/vxture/runtime/.env.db}"
if [ -f "$AGENT_RENDERER" ]; then
  echo "==> 渲染智能体边缘路由表（从产品登记）"
  # 与 seed 同一手法：宿主上没有 node，借一次性 node 容器跑，pg 装在共享缓存里。
  # 渲染器自己保证「无论如何都产出这个文件」并且失败不中断（读不到库时保留上一版），
  # 所以这里 `|| true` 只兜住容器本身起不来的情况，不吞它的业务判断。
  DB_TOOL_CACHE_DIR="${DB_TOOL_CACHE_DIR:-/srv/vxture/data/db-tool-cache}"
  mkdir -p "$DB_TOOL_CACHE_DIR"
  if [ -f "$DB_ENV" ]; then
    docker run --rm \
      --network vxture-prod \
      --env-file "$DB_ENV" \
      -v "$SRC:/edge:ro" \
      -v "$DST/snippets:/out" \
      -v "$DB_TOOL_CACHE_DIR:/tmp/vxture-db" \
      node:24-alpine \
      sh -lc '
        set -e
        if [ ! -d /tmp/vxture-db/node_modules/pg ]; then
          npm install --prefix /tmp/vxture-db pg@8.20.0 >/dev/null 2>&1 || true
        fi
        export NODE_PATH="/tmp/vxture-db/node_modules"
        node /edge/render-agent-map.mjs /out/agents-upstream.map
      ' || true
  else
    echo "  提示：$DB_ENV 不存在，跳过路由表渲染"
  fi
  # 兜底：无论上面走哪条分支，include 的文件必须存在，否则 nginx -t 必失败。
  if [ ! -f "$AGENT_MAP" ]; then
    echo "# 未渲染（见上方提示），空表占位" > "$AGENT_MAP"
    echo "  已写出空的智能体路由表占位 → $AGENT_MAP"
  fi

  AGENT_TEMPLATE="$SRC/templates/agents.vhost.template"
  if [ -f "$AGENT_TEMPLATE" ]; then
    render_nginx "$AGENT_TEMPLATE" "$DST/sites-enabled/agents.conf"
    echo "==> 已渲染智能体通配兜底 vhost → $DST/sites-enabled/agents.conf"
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
