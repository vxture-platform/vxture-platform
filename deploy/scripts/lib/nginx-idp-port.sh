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
#   · 33-recreate-service（idp_alias_guard_recreate）：重建 auth-bff **之前**调用。auth-bff 还直接
#     发布着 :8081、而要用的 compose 已经不给它 ports:（PR D 的 bundle 上了机、31 却没走到 30 的
#     auth-bff 那步）→ 拒绝：此刻重建会把口放掉而 nginx 没接，产品换票口无人服务直到重跑 31。
#   往后每次 deploy：20-sync 判到 nginx 已占 → 终态；30 的交接判到 nginx 已占 → `up -d` 无变化。
#   新主机：没人占 → 20-sync 直接落终态，31 的 `up -d` 第一次就带 :8081。
# :8081 的不可用窗口 = 旧 auth-bff 停 → nginx 重建完成，几秒；nginx 重建也会让 80/443/8080 闪断
# 同一个量级（与此前每次改 compose.nginx.yml 的重建同一类）。
#
# ── 判据从哪读 ──
# 「谁发布了宿主口 :8081」读 `docker inspect` 的 `.NetworkSettings.Ports`（每个绑定一行：容器名、
# 宿主 IP、宿主口、容器口），宿主口按整串精确比较。**不读 `docker ps` 的 Ports 列**：那一列是给人看的
# 渲染——同一 IP 上宿主口 == 容器口且连号的会被折成一个区间，nginx 的 compose 正好是这个形状
# （`${IP}:8080:8080` + `${IP}:8081:8081`），docker 29.7 实测打印 `IP:8080-8081->8080-8081/tcp`，
# 子串 `:8081->` 根本不出现——按子串找会把已交接的主机判成「没人发布」：30 的交接后断言红、
# 之后每次 20-sync 又被 `ss` 里 nginx 自己的 docker-proxy 判成「宿主进程在听」而拒绝。第一版就是
# 这样写的，离线证明全绿、真 docker 上全红。也不用 `--filter publish=`：它按宿主口还是容器口匹配
# 在不同版本里不一样。
# 「宿主上有没有非 docker 的进程在听」读 `ss -ltnH '( sport = :8081 )'`（docker 发布本身也会以
# docker-proxy 出现在这里，所以它只在 docker 侧零发布者时才有判别力）。
#
# 纯函数（_from_bindings / classify / render / compose_publishes_port）零依赖，可被
# nginx-idp-port.test.sh 直接喂文本；带副作用的入口（sync / handover / guard_recreate）在同一测试里
# 用 PATH 上的假 docker / 假 ss 真跑，假 docker 的 Ports 列按 docker 的 DisplayablePorts 规则渲染
# （区间折叠），第一版的子串解析对着它是红的。NGINX_IDP_PORT_LIVE=1 时测试还会对真 docker 跑一遍。
set -o pipefail

IDP_ALIAS_PORT="${IDP_ALIAS_PORT:-8081}"
IDP_ALIAS_MARKER='# @vx-idp-alias-8081'
IDP_ALIAS_NGINX_CONTAINER="${IDP_ALIAS_NGINX_CONTAINER:-vxture-nginx}"
IDP_ALIAS_LEGACY_PUBLISHER="${IDP_ALIAS_LEGACY_PUBLISHER:-vx-platform-auth-bff}"
# docker inspect 模板：每个宿主口绑定一行 `/<容器名>\t<宿主 IP>\t<宿主口>\t<容器口/协议>`。
# 没发布任何口的容器一行不出（exposed-but-unpublished 的 `80/tcp: null` 在 range 里是零次）。
# shellcheck disable=SC2016  # 这是 Go 模板，$n / $cp / $bs 不是 shell 变量
IDP_ALIAS_INSPECT_FORMAT='{{$n := .Name}}{{range $cp, $bs := .NetworkSettings.Ports}}{{range $bs}}{{$n}}{{"\t"}}{{.HostIp}}{{"\t"}}{{.HostPort}}{{"\t"}}{{$cp}}{{"\n"}}{{end}}{{end}}'

# idp_alias_publishers_from_bindings "<上面模板的输出>"
#   输出：发布了宿主口 :$IDP_ALIAS_PORT 的容器名，一行一个（按输入顺序，同一容器只一次）。
#   宿主口整串精确比较：`18081` 不算、容器侧 `3081/tcp` 或 `8081/tcp` 不算；只看第 3 列。
idp_alias_publishers_from_bindings() {
  printf '%s\n' "${1:-}" | awk -F'\t' -v port="$IDP_ALIAS_PORT" '
    NF >= 4 && $3 == port {
      name = $1; sub(/^\//, "", name)
      if (!(name in seen)) { seen[name] = 1; print name }
    }'
}

# idp_alias_bindings → 现场：所有在跑容器的宿主口绑定（模板行）。docker 本身失败则函数失败（不能判就不判）。
idp_alias_bindings() {
  local names
  names="$(docker ps --format '{{.Names}}')" || return 1
  [ -n "$names" ] || return 0
  # shellcheck disable=SC2086  # 容器名不含空白；按行展开成多个参数正是要的
  docker inspect --format "$IDP_ALIAS_INSPECT_FORMAT" $names || return 1
}

# idp_alias_publishers → 现场：谁发布了宿主口。
idp_alias_publishers() {
  local bindings
  bindings="$(idp_alias_bindings)" || return 1
  idp_alias_publishers_from_bindings "$bindings"
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

# idp_alias_compose_publishes_port <compose.platform.yml>
#   0 = 该文件里 auth-bff 服务段仍有一行把宿主口 :$IDP_ALIAS_PORT 发布出去（切换前的 compose）；
#   1 = 没有（PR D 之后的 compose）。注释行不算。只看 auth-bff 段，别的服务段里的 :8081 不算。
idp_alias_compose_publishes_port() {
  local f="$1"
  [ -f "$f" ] || return 1
  tr -d '\r' < "$f" | awk -v port="$IDP_ALIAS_PORT" '
    /^  [a-z][a-z0-9-]*:[[:space:]]*$/ { in_auth = ($1 == "auth-bff:") }
    in_auth && /^[[:space:]]*#/ { next }
    in_auth && index($0, ":" port ":") > 0 { found = 1 }
    END { exit !found }'
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
  publishers="$(idp_alias_publishers)" || { echo "错误：读不到 docker 的端口绑定（docker ps / inspect），无法判断 :$IDP_ALIAS_PORT 现场，不落 compose。" >&2; return 1; }
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
  publishers="$(idp_alias_publishers)" || { echo "错误：读不到 docker 的端口绑定（docker ps / inspect），无法判断 :$IDP_ALIAS_PORT 现场。" >&2; return 1; }
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
    echo "      产品的换票口此刻可能无人服务：docker port $IDP_ALIAS_NGINX_CONTAINER $IDP_ALIAS_PORT 看它有没有真的发布。" >&2
    return 1
  fi
  echo "  交接完成：:$IDP_ALIAS_PORT 由 $IDP_ALIAS_NGINX_CONTAINER 发布，auth-bff 不再直接发布宿主口。"
}

# idp_alias_guard_recreate <将要用的 compose.platform.yml>
#   33-recreate-service 在重建 auth-bff **之前**调用（任何 compose 动作之前）。拒绝的只有一种现场：
#   auth-bff 此刻还直接发布着 :$IDP_ALIAS_PORT（legacy）**且**这份 compose 已不给它 ports:——重建会把
#   宿主口放掉，而 33 不做 nginx 交接（它不带 compose.nginx.yml、db-init 的同步也不带），产品换票口
#   从此无人服务直到有人重跑 31。其余现场（nginx 已接 / compose 仍带 ports: 的旧 bundle / 没人占）
#   重建 auth-bff 都不改变这个口归谁，放行。读不到现场 → 拒绝（不能判就不判）。
idp_alias_guard_recreate() {
  local compose="$1" publishers cls
  publishers="$(idp_alias_publishers)" || { echo "错误：读不到 docker 的端口绑定（docker ps / inspect），无法判断 :$IDP_ALIAS_PORT 现场，不重建 auth-bff。" >&2; return 1; }
  cls="$(idp_alias_classify "$publishers" "")"
  if [ "$cls" = "legacy" ] && ! idp_alias_compose_publishes_port "$compose"; then
    echo "错误：auth-bff 此刻还直接发布着宿主口 :$IDP_ALIAS_PORT，而 $compose 已不再给它 ports:（PR D 的端口交接还没做）。" >&2
    echo "      现在重建它会把 :$IDP_ALIAS_PORT 放掉而 nginx 没有接上——产品换票口无人服务，直到重跑 31。" >&2
    echo "      先跑 31-regular-upgrade-platform.sh 完成交接（30-deploy 在 auth-bff 重建后立刻让 nginx 接 :$IDP_ALIAS_PORT），再回来重载 env。" >&2
    return 1
  fi
  echo "  :$IDP_ALIAS_PORT 现场：$cls——重建 auth-bff 不改变这个口归谁"
}
