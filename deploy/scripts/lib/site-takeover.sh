#!/usr/bin/env bash
# deploy/scripts/lib/site-takeover.sh
# 站点接管档位：合并「仓内默认 + 主机现场」，渲染 nginx map，投放接管页。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-09-24
#
# 被两处 source：
#   · 20-sync-nginx-config.sh   —— 每次发版重算一遍（现场档位活过发版靠的就是这里）
#   · 35-site-takeover.sh       —— 运维切档，秒级，不重建容器
# 两处共用同一个渲染函数，不是各写一遍——两个渲染器迟早会渲出两个不同的答案。
#
# 纯文本函数（takeover_resolve）单独可测：deploy/scripts/lib/site-takeover.test.sh。

TAKEOVER_MAP_BASENAME="site-takeover.map"
TAKEOVER_HTML_SUBDIR="__takeover"
TAKEOVER_MODES="off maintenance portal"

takeover_valid_mode() {
  case "${1:-}" in
    off | maintenance | portal) return 0 ;;
    *) return 1 ;;
  esac
}

# takeover_resolve "<默认档位文本>" "<现场档位文本>"
#   输出 `域名 档位`，按默认文件里的顺序。现场逐域覆盖默认。
#
# 两条**故意不宽容**的判定：
#   · 档位不在三档之内 → 报错退出。宽容的后果是渲出一个 nginx 认得、而人以为是别的
#     意思的值，或者干脆让 try_files 去找一个不存在的文件（表现为 404，不是报错）。
#   · 现场登记了默认文件里没有的域 → 报错退出。把域名拼错不会有任何症状，只会「改了
#     但没生效」，而那正是最难查的一类。
#     **例外**：第三个参数传 `prune` 时改为丢弃并提示，给 deploy 路径用——见下方注释。
takeover_resolve() {
  local defaults_text="${1:-}" state_text="${2:-}" unknown_host="${3:-reject}"
  local -A mode=()
  local -a order=()
  local line host m extra

  while IFS= read -r line; do
    line="${line%%#*}"
    read -r host m extra <<<"$line" || true
    [ -n "${host:-}" ] || continue
    if [ -n "${extra:-}" ]; then
      echo "错误：默认档位这一行多出了内容：$line" >&2
      return 1
    fi
    if [ -z "${m:-}" ]; then
      echo "错误：默认档位「$host」没写档位（应为 $TAKEOVER_MODES 之一）" >&2
      return 1
    fi
    if ! takeover_valid_mode "$m"; then
      echo "错误：默认档位「$host」写的是「$m」，不在 $TAKEOVER_MODES 之内" >&2
      return 1
    fi
    if [ -n "${mode[$host]+x}" ]; then
      echo "错误：默认档位里「$host」出现了两次，哪一行说了算无从判断" >&2
      return 1
    fi
    mode[$host]="$m"
    order+=("$host")
  done <<<"$defaults_text"

  if [ "${#order[@]}" -eq 0 ]; then
    echo "错误：默认档位一条都没读到（文件空或全是注释）" >&2
    return 1
  fi

  while IFS= read -r line; do
    line="${line%%#*}"
    read -r host m extra <<<"$line" || true
    [ -n "${host:-}" ] || continue
    if [ -n "${extra:-}" ]; then
      echo "错误：现场档位这一行多出了内容：$line" >&2
      return 1
    fi
    if [ -z "${mode[$host]+x}" ]; then
      # 两种调用方，两种正确答案：
      #
      #   reject（默认，`35-site-takeover.sh` 用）—— 人在敲命令，域名不在登记表里只可能
      #     是敲错了。悄悄不生效是这一类最难查的故障，所以当场拦下。
      #   prune（`20-sync-nginx-config.sh` 用）—— 一个域从登记表里退役是**正常的仓内
      #     改动**，而主机上那份现场状态还留着它。这时候报错会让 deploy 整个失败
      #     （20- 是 set -e），等于「退役一个域」这件事做不成。丢掉并且说出来。
      if [ "$unknown_host" = "prune" ]; then
        echo "  提示：现场档位里的「$host」已不在 site-takeover.defaults，按退役丢弃。" >&2
        continue
      fi
      echo "错误：现场档位登记了「$host」，而 site-takeover.defaults 里没有这个域。" >&2
      echo "      域名拼错不会报错、只会悄悄不生效，所以这里直接拦下。" >&2
      return 1
    fi
    if ! takeover_valid_mode "${m:-}"; then
      echo "错误：现场档位「$host」写的是「${m:-（空）}」，不在 $TAKEOVER_MODES 之内" >&2
      return 1
    fi
    mode[$host]="$m"
  done <<<"$state_text"

  for host in "${order[@]}"; do
    printf '%s %s\n' "$host" "${mode[$host]}"
  done
}

# takeover_read_file <路径> —— 文件不存在就当空文本（现场档位文件允许不存在）。
takeover_read_file() {
  [ -f "${1:-}" ] && cat "$1" || true
}

# takeover_render_map "<已解析的 host mode 行>" <目标 .map 路径>
takeover_render_map() {
  local resolved="${1:-}" dst="${2:?}" host m
  {
    echo "# 由 deploy/scripts/lib/site-takeover.sh 渲染，勿手工编辑（下次发版会重写）。"
    echo "# 权威：deploy/nginx/site-takeover.defaults + /srv/vxture/runtime/site-takeover.state"
    while read -r host m; do
      [ -n "${host:-}" ] || continue
      printf '%s "%s";\n' "$host" "$m"
    done <<<"$resolved"
  } >"$dst"
}

# takeover_sync_pages <仓内 html 目录> <主机 html 根> "<已解析的 host mode 行>"
#   投放接管页，并断言每个在用的档位都有页可发。
#   断言放在 reload **之前**：少一张页的表现是 404 或 500，不是报错——那种故障发生在
#   站点已经被接管之后，正是最没有回旋余地的时刻。
takeover_sync_pages() {
  local src_root="${1:?}" dst_root="${2:?}" resolved="${3:-}"
  local src="$src_root/$TAKEOVER_HTML_SUBDIR" dst="$dst_root/$TAKEOVER_HTML_SUBDIR"
  local host m

  if [ ! -d "$src" ]; then
    echo "错误：找不到接管页目录 $src" >&2
    return 1
  fi
  if [ -f "$src/off.html" ]; then
    echo "错误：$src/off.html 不该存在——off 的含义是「不接管」，有这张页就意味着" >&2
    echo "      正常站点会被它顶掉，而档位面板上看不出任何异常。" >&2
    return 1
  fi

  rm -rf "$dst"
  mkdir -p "$dst"
  cp -f "$src"/*.html "$dst"/

  while read -r host m; do
    [ -n "${host:-}" ] || continue
    [ "$m" = "off" ] && continue
    if [ ! -f "$dst/$m.html" ]; then
      echo "错误：「$host」档位是 $m，而 $dst/$m.html 不存在。" >&2
      return 1
    fi
  done <<<"$resolved"
}
