#!/usr/bin/env bash
# deploy/scripts/35-site-takeover.sh
# 切换某个域的「站点接管」档位：正常 / 平台维护 / 临时门户。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-09-24
#
# 用法：
#   sudo bash 35-site-takeover.sh                        查看当前各域档位
#   sudo bash 35-site-takeover.sh vxture.com maintenance 整域进维护（每条路径 503）
#   sudo bash 35-site-takeover.sh vxture.com portal      只接管根路径，站内其余不变
#   sudo bash 35-site-takeover.sh vxture.com off         恢复正常站点
#
# 秒级生效：只重渲一份 map + 投放接管页 + nginx -s reload。**不重建任何容器**、
# 不动镜像、不碰数据库。维护窗口靠它开合，不靠发版。
#
# 幂等：重复设同一档位没有副作用。
#
# 档位写进 /srv/vxture/runtime/site-takeover.state（人工维护区，deploy 不覆盖），
# 所以它活过下一次发版——20-sync-nginx-config.sh 每次同步都会把它重新读进来。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
. "$SCRIPT_DIR/lib/site-takeover.sh"

SRC="$COMPOSE_DIR/nginx"
DST="${TAKEOVER_CONF_DIR:-/srv/vxture/data/nginx/conf}"
HTML_ROOT="${TAKEOVER_HTML_ROOT:-/srv/vxture/data/nginx/html}"
STATE_FILE="${TAKEOVER_STATE_FILE:-/srv/vxture/runtime/site-takeover.state}"
DEFAULTS_FILE="$SRC/site-takeover.defaults"

if [ ! -f "$DEFAULTS_FILE" ]; then
  echo "错误：找不到 $DEFAULTS_FILE（部署包不完整？）" >&2
  exit 1
fi

defaults_text="$(cat "$DEFAULTS_FILE")"
state_text="$(takeover_read_file "$STATE_FILE")"

# 档位的可读说明只写在这一处（`--show` 与切档回执共用），免得两处各说各的。
describe_mode() {
  case "$1" in
    off) echo "正常站点" ;;
    maintenance) echo "平台维护（整域 503 + 维护页）" ;;
    portal) echo "临时门户（只接管根路径）" ;;
  esac
}

show() {
  local resolved host m
  resolved="$(takeover_resolve "$defaults_text" "$state_text")"
  echo "站点接管档位（现场）"
  while read -r host m; do
    [ -n "${host:-}" ] || continue
    printf '  %-16s %-12s %s\n' "$host" "$m" "$(describe_mode "$m")"
  done <<<"$resolved"
  echo ""
  if [ -f "$STATE_FILE" ]; then
    echo "  现场文件：$STATE_FILE"
  else
    echo "  现场文件尚未建立，以上为仓内默认（$DEFAULTS_FILE）"
  fi
}

if [ "$#" -eq 0 ]; then
  show
  exit 0
fi

if [ "$#" -ne 2 ]; then
  echo "用法：$(basename "$0") [<域名> <off|maintenance|portal>]" >&2
  echo "      不带参数 = 查看当前档位" >&2
  exit 2
fi

host_arg="$1"
mode_arg="$2"

if ! takeover_valid_mode "$mode_arg"; then
  echo "错误：档位「$mode_arg」不在 $TAKEOVER_MODES 之内" >&2
  exit 2
fi

# 先验一遍「这个域登记过吗」：拼错域名的表现是改了没生效，不是报错。
if ! takeover_resolve "$defaults_text" "$host_arg $mode_arg" >/dev/null; then
  exit 2
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "错误：请用 sudo 运行（要写 $STATE_FILE 与 $HTML_ROOT）" >&2
  exit 1
fi

# 现场文件整份重写：只保留仓内默认登记过的域，且每域一行。
# 「追加一行」的写法会让同一个域出现多行，而哪一行说了算只能靠读代码才知道。
new_state="$(
  {
    while read -r h m; do
      [ -n "${h:-}" ] || continue
      if [ "$h" = "$host_arg" ]; then m="$mode_arg"; fi
      printf '%s %s\n' "$h" "$m"
    done <<<"$(takeover_resolve "$defaults_text" "$state_text")"
  }
)"

mkdir -p "$(dirname "$STATE_FILE")"
{
  echo "# /srv/vxture/runtime/site-takeover.state —— 站点接管档位的**现场**状态。"
  echo "# 由 deploy/scripts/35-site-takeover.sh 写入；deploy 不覆盖本文件。"
  echo "# 档位：off（正常）/ maintenance（整域 503）/ portal（只接管根路径）。"
  echo "# 最后一次改动：$(date -u '+%Y-%m-%dT%H:%M:%SZ') by ${SUDO_USER:-$(id -un)}"
  printf '%s\n' "$new_state"
} >"$STATE_FILE"

resolved="$(takeover_resolve "$defaults_text" "$(cat "$STATE_FILE")")"
mkdir -p "$DST/conf.d" "$HTML_ROOT"
takeover_render_map "$resolved" "$DST/conf.d/$TAKEOVER_MAP_BASENAME"
takeover_sync_pages "$SRC/html" "$HTML_ROOT" "$resolved"

if docker inspect vxture-nginx >/dev/null 2>&1; then
  docker exec vxture-nginx nginx -t
  docker exec vxture-nginx nginx -s reload
  echo "已热重载 nginx"
else
  echo "  提示：vxture-nginx 未运行，档位将在它启动时生效"
fi

echo ""
echo "「$host_arg」→ $mode_arg（$(describe_mode "$mode_arg")）"
echo ""
state_text="$(cat "$STATE_FILE")"
show
