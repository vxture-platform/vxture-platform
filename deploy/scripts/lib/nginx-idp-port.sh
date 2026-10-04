#!/usr/bin/env bash
# deploy/scripts/lib/nginx-idp-port.sh
# tailnet :8081（IdP 换票口）从 auth-bff 直接发布改为 vx-nginx 别名承接——端口交接的全部判据住在这里。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-10-04
#
# ── 要解决的事（E1 PR D）──
# 此前 compose.platform.yml 把 auth-bff **整个容器**发布在 `${VX_WORKER01_TAILNET_IP}:8081`，
# 任何 tailnet 对端都能打到 `/internal/*`（运营账号 / 客户账号管理的写动作面）。产品只合法地
# 用这个口做三件事：`/oidc/*`（换票、JWKS）、`/.well-known/*`、`/healthz`。现在 :8081 由 nginx
# 发布（compose.nginx.yml）、`sites-enabled/idp-internal.conf` 只转这三组路径、其余 404，
# auth-bff 不再有 `ports:`。产品侧地址一个字不变。
#
# ── 为什么不能「直接改两份 compose 然后 deploy」──
# 31-regular-upgrade 的顺序是 20-sync（渲 nginx 配置）→ `compose up -d` nginx → 30-deploy（逐服务
# 重建平台栈）。在一台还在跑旧 auth-bff 的主机上，nginx 的 compose 一加 `:8081` 发布，`up -d`
# 就会重建 nginx 容器去绑一个 auth-bff 还占着的宿主口 → `port is already allocated`。compose 的
# 重建是先停旧、再起新：新容器起不来，旧的已经停了——**全站 80/443 一起下线**，不只是 :8081。
# 注意碰撞发生在 **docker 发布宿主口**那一层，不在 nginx 配置：`listen 8081` 只是容器网络命名空间
# 里的事，随时可以写进配置、随时可以 reload；而宿主口只有重建容器才能多发布一个。
#
# ── 机制 ──
# 仓内 compose.nginx.yml 写的是**终态**（含 :8081 发布），那一行尾部带标记 `# @vx-idp-alias-8081`。
# 落到主机 /srv/vxture/data/nginx/compose.yml 时由本库按现场决定要不要那一行：
#   · 20-sync（idp_alias_sync）：没人占 :8081 / nginx 已占 → 原样落（终态）；
#     **auth-bff 还占着** → 去掉那一行落下（与主机现有 compose 等价，31 的 `up -d` 不会重建 nginx），
#     打印「延后到 30-deploy 交接」；别的容器 / 宿主进程占着 → 报错退出（不是跳过）。
#   · 30-deploy（idp_alias_handover）：紧跟 auth-bff 的 `up -d --no-deps`（新 compose 无 ports，
#     旧容器一停 :8081 即空出）之后调用：原样落终态 compose → `compose up -d` 重建 nginx（一次）→
#     再读一遍现场，发布者必须恰是 vxture-nginx，否则退出 1。auth-bff 重建后**仍**占着 :8081 →
#     退出 1，一个 compose 动作都不做（那意味着主机上的 compose.platform.yml 还带 ports:，
#     bundle 过旧；此时去重建 nginx 等于把全站打下线）。
#   往后每次 deploy：20-sync 判到 nginx 已占 → 终态；30 的交接判到 nginx 已占 → `up -d` 无变化。
#   新主机：没人占 → 20-sync 直接落终态，31 的 `up -d` 第一次就带 :8081。
# :8081 的不可用窗口 = 旧 auth-bff 停 → nginx 重建完成，几秒；nginx 重建也会让 80/443/8080 闪断
# 同一个量级（与此前每次改 compose.nginx.yml 的重建同一类）。
#
# ── 判据从哪读 ──
# 「谁发布了宿主口 :8081」读 `docker ps --format '{{.Names}}\t{{.Ports}}'` 的 Ports 列（形如
# `100.64.0.1:8081->3081/tcp`），不用 `--filter publish=`：那个过滤器按宿主口还是容器口匹配
# 在不同版本里不一样，本机 29.7 实测按宿主口，但 Ports 列的 `:8081->` 在哪个版本都只有一个意思。
# 「宿主上有没有非 docker 的进程在听」读 `ss -ltnH '( sport = :8081 )'`（docker 发布本身也会以
# docker-proxy 出现在这里，所以它只在 docker 侧零发布者时才有判别力）。
#
# 纯函数（_from_ps / classify / render）零依赖，可被 nginx-idp-port.test.sh 直接喂文本；
# 带副作用的两个入口（sync / handover）在同一测试里用 PATH 上的假 docker / 假 ss 真跑。
set -o pipefail

IDP_ALIAS_PORT="${IDP_ALIAS_PORT:-8081}"
IDP_ALIAS_MARKER='# @vx-idp-alias-8081'
IDP_ALIAS_NGINX_CONTAINER="${IDP_ALIAS_NGINX_CONTAINER:-vxture-nginx}"
IDP_ALIAS_LEGACY_PUBLISHER="${IDP_ALIAS_LEGACY_PUBLISHER:-vx-platform-auth-bff}"

# idp_alias_publishers_from_ps "<docker ps --format '{{.Names}}\t{{.Ports}}' 的输出>"
#   输出：发布了宿主口 :$IDP_ALIAS_PORT 的容器名，一行一个（按输入顺序）。
#   只认 `:<port>->`（宿主侧），`:18081->` 不算、容器侧 `->8081/tcp` 不算。
idp_alias_publishers_from_ps() {
  printf '%s\n' "${1:-}" | awk -F'\t' -v port="$IDP_ALIAS_PORT" '
    NF >= 2 {
      n = split($2, m, /, /)
      for (i = 1; i <= n; i++) {
        if (index(m[i], ":" port "->") > 0) { print $1; break }
      }
    }'
}

# idp_alias_publishers → 现场：谁发布了宿主口。docker 本身失败则函数失败（不能判就不判）。
idp_alias_publishers() {
  local ps_out
  ps_out="$(docker ps --format '{{.Names}}\t{{.Ports}}')" || return 1
  idp_alias_publishers_from_ps "$ps_out"
}

# idp_alias_host_listeners → 宿主上在听 :$IDP_ALIAS_PORT 的 socket（ss 一行一个）；没有 ss 则输出空。
idp_alias_host_listeners() {
  command -v ss >/dev/null 2>&1 || return 0
  ss -ltnH "( sport = :$IDP_ALIAS_PORT )" 2>/dev/null || true
}

# idp_alias_classify "<publishers 文本>" "<ss 文本>"
#   输出一行：
#     free            没人占——可以落终态
#     nginx           vxture-nginx 已占——已交接
#     legacy          只有 vx-platform-auth-bff 占——切换中
#     foreign <names> 别的容器（或 auth-bff 与别人一起）占——不认识的现场
#     host-listener   docker 侧零发布者，但宿主上有进程在听——不是 docker 管的口
idp_alias_classify() {
  local publishers="${1:-}" listeners="${2:-}"
  local names n
  names="$(printf '%s\n' "$publishers" | sed '/^$/d')"
  n="$(printf '%s\n' "$names" | sed '/^$/d' | wc -l | tr -d ' ')"
  if [ "$n" -eq 0 ]; then
    if [ -n "$(printf '%s' "$listeners" | tr -d '[:space:]')" ]; then
      echo "host-listener"
    else
      echo "free"
    fi
    return 0
  fi
  if [ "$n" -eq 1 ]; then
    case "$names" in
      "$IDP_ALIAS_NGINX_CONTAINER")  echo "nginx";  return 0 ;;
      "$IDP_ALIAS_LEGACY_PUBLISHER") echo "legacy"; return 0 ;;
    esac
  fi
  echo "foreign $(printf '%s\n' "$names" | tr '\n' ' ' | sed 's/ $//')"
}

# idp_alias_render_compose <仓内 compose.nginx.yml> <主机 compose.yml> <include|strip>
#   include：原样落（终态）。strip：去掉带标记的那一行。
#   源文件里标记行必须**恰好一行**——没有标记就无法延后（31 会撞口），两行则会连删，都算坏源。
idp_alias_render_compose() {
  local src="$1" dst="$2" mode="$3" n
  [ -f "$src" ] || { echo "错误：找不到 $src" >&2; return 1; }
  n="$(grep -c -F -- "$IDP_ALIAS_MARKER" "$src" || true)"
  if [ "$n" != "1" ]; then
    echo "错误：$src 里带 '$IDP_ALIAS_MARKER' 标记的行应恰好 1 行，实际 $n 行——交接无法按现场延后，拒绝落盘。" >&2
    return 1
  fi
  case "$mode" in
    include) cp "$src" "$dst" ;;
    strip)   grep -v -F -- "$IDP_ALIAS_MARKER" "$src" > "$dst" ;;
    *) echo "错误：render 模式只认 include|strip，收到 '$mode'" >&2; return 1 ;;
  esac
}

# idp_alias_explain_foreign <classification> → 给 foreign / host-listener 两种现场的统一报错文案
idp_alias_explain_foreign() {
  local cls="$1"
  case "$cls" in
    "foreign "*)
      echo "错误：宿主口 :$IDP_ALIAS_PORT 被不认识的容器发布着：${cls#foreign }" >&2
      echo "      这个口按设计只能由 $IDP_ALIAS_NGINX_CONTAINER（终态）或 $IDP_ALIAS_LEGACY_PUBLISHER（切换前）发布。" >&2
      echo "      不猜、不跳过：先弄清那个容器是什么，再重跑。" >&2
      ;;
    host-listener)
      echo "错误：docker 侧没有容器发布 :$IDP_ALIAS_PORT，但宿主上有进程在听这个口（ss）。" >&2
      echo "      nginx 一旦去发布它就会 'port is already allocated'，而 compose 重建是先停旧再起新——全站会一起下线。" >&2
      echo "      先找出那个进程（ss -ltnp '( sport = :$IDP_ALIAS_PORT )'），再重跑。" >&2
      ;;
  esac
}

# idp_alias_sync <仓内 compose.nginx.yml> <主机 compose.yml>
#   20-sync 用。决定落终态还是延后，并落盘；不动任何容器。
idp_alias_sync() {
  local src="$1" dst="$2" publishers cls
  publishers="$(idp_alias_publishers)" || { echo "错误：docker ps 失败，无法判断 :$IDP_ALIAS_PORT 现场，不落 compose。" >&2; return 1; }
  cls="$(idp_alias_classify "$publishers" "$(idp_alias_host_listeners)")"
  case "$cls" in
    free)
      idp_alias_render_compose "$src" "$dst" include || return 1
      echo "  :$IDP_ALIAS_PORT 没人发布 → nginx compose 带 IdP 别名发布落盘（新主机 / 已摘掉直通）：$dst"
      ;;
    nginx)
      idp_alias_render_compose "$src" "$dst" include || return 1
      echo "  :$IDP_ALIAS_PORT 已由 $IDP_ALIAS_NGINX_CONTAINER 发布 → 终态 compose 落盘（已交接）：$dst"
      ;;
    legacy)
      idp_alias_render_compose "$src" "$dst" strip || return 1
      echo "  :$IDP_ALIAS_PORT 仍由 $IDP_ALIAS_LEGACY_PUBLISHER 直接发布（切换中）→ 本次落盘**不带**别名发布，"
      echo "    避免 31 的 'compose up -d' 重建 nginx 去绑一个还被占着的口；"
      echo "    交接由 30-deploy 在 auth-bff 重建之后立刻执行（idp_alias_handover）。"
      ;;
    *)
      idp_alias_explain_foreign "$cls"
      return 1
      ;;
  esac
}

# idp_alias_handover <仓内 compose.nginx.yml> <主机 compose.yml>
#   30-deploy 用，紧跟 auth-bff 的 up -d 之后。完成交接或退出 1；绝不静默跳过。
idp_alias_handover() {
  local src="$1" dst="$2" publishers cls after
  [ -f "$src" ] || { echo "错误：找不到 $src（deploy bundle 不完整）" >&2; return 1; }
  [ -d "$(dirname "$dst")" ] || { echo "错误：找不到 $(dirname "$dst")——nginx 从没同步过，先跑 20-sync-nginx-config.sh" >&2; return 1; }
  publishers="$(idp_alias_publishers)" || { echo "错误：docker ps 失败，无法判断 :$IDP_ALIAS_PORT 现场。" >&2; return 1; }
  cls="$(idp_alias_classify "$publishers" "$(idp_alias_host_listeners)")"
  case "$cls" in
    nginx)
      idp_alias_render_compose "$src" "$dst" include || return 1
      echo "  :$IDP_ALIAS_PORT 已由 $IDP_ALIAS_NGINX_CONTAINER 发布 → 终态 compose 落盘，up -d 应无变化"
      docker compose -f "$dst" up -d || { echo "错误：nginx compose up -d 失败" >&2; return 1; }
      ;;
    free)
      idp_alias_render_compose "$src" "$dst" include || return 1
      echo "  :$IDP_ALIAS_PORT 已空出 → 落终态 compose 并重建 nginx 以发布 IdP 别名（80/443/8080 同时闪断数秒）"
      docker compose -f "$dst" up -d || { echo "错误：nginx compose up -d 失败——IdP 别名没有接上，:$IDP_ALIAS_PORT 现在无人服务。" >&2; return 1; }
      ;;
    legacy)
      echo "错误：auth-bff 刚重建完，宿主口 :$IDP_ALIAS_PORT 却仍由 $IDP_ALIAS_LEGACY_PUBLISHER 发布。" >&2
      echo "      说明主机上生效的 compose.platform.yml 还带着 auth-bff 的 ports:（deploy bundle 过旧？）。" >&2
      echo "      本次不动 nginx（此刻重建它会让全站下线），部署中止；同步正确的 compose.platform.yml 后重跑 31。" >&2
      return 1
      ;;
    *)
      idp_alias_explain_foreign "$cls"
      return 1
      ;;
  esac
  after="$(idp_alias_classify "$(idp_alias_publishers || true)" "")"
  if [ "$after" != "nginx" ]; then
    echo "错误：交接后 :$IDP_ALIAS_PORT 的发布者应恰是 $IDP_ALIAS_NGINX_CONTAINER，实际判为 '$after'。" >&2
    echo "      产品的换票口此刻可能无人服务：docker ps 看 $IDP_ALIAS_NGINX_CONTAINER 的 PORTS 列。" >&2
    return 1
  fi
  echo "  交接完成：:$IDP_ALIAS_PORT 由 $IDP_ALIAS_NGINX_CONTAINER 发布，auth-bff 不再直接发布宿主口。"
}
