#!/usr/bin/env bash
# deploy/scripts/lib/nginx-idp-port.test.sh
# tailnet :8081 从 auth-bff 直通交接给 nginx 别名的离线证明。PATH 上放一个假 docker + 假 ss，
# 让 20-sync 的 idp_alias_sync 与 30-deploy 的 idp_alias_handover **真跑**，按 31 的真实顺序
# （20-sync → nginx `up -d` → 30 逐服务 `up -d --no-deps`）走两种主机现场，断言的是假 docker
# 记录下来的宿主口状态与调用序列，不是读源码判断。
#
# 假 docker 的真值是**结构化的端口绑定**（每容器每绑定一行：宿主 IP / 宿主口 / 容器口），`inspect`
# 按库里那份模板吐行；`ps --format '{{.Names}}\t{{.Ports}}'` 的 Ports 列按 docker 自己的
# DisplayablePorts 规则渲染——同一 IP、宿主口 == 容器口、连号 → 折成 `IP:a-b->a-b/tcp`。nginx 的
# compose（`${IP}:8080:8080` + `${IP}:8081:8081`）正是这个形状。第一版库按 Ports 列子串 `:8081->` 找
# 发布者，对着真 docker 把已交接的主机判成「没人发布」；这里把那段解析留作失败控制组，并把真 docker
# 29.7.2 吐出来的字符串原样当夹具（见「真 docker 的样子」），假 docker 的渲染必须逐字等于它。
#   · 切换中的主机（auth-bff 还直接发布 :8081）：20 延后、31 不重建 nginx、30 在 auth-bff 之后
#     一次交接；nginx 一次都没掉；第二次 deploy 一个动作都不多（幂等）——交接后 nginx 的 Ports 列
#     就是折叠形状，断言在它上面成立
#   · 新主机（空）：20 直接落终态，31 第一次 `up -d` 就带 :8081，30 的交接是无变化
#   · 失败控制组①：把 20-sync 换回裸 cp（改动前的行为）→ 假 docker 报 port is already allocated、
#     nginx 下线——证明碰撞是真的、假 docker 看得见
#   · 失败控制组②：第一版的 Ports 列子串解析对着折叠形状 → 空（判成 free）；新库 → vxture-nginx
#   · 响亮失败：别的容器占着 / 宿主进程在听 / auth-bff 重建后仍占着 / docker 坏了 / up -d 后
#     nginx 没接上 / 没同步过 nginx → 都是非零退出，且**一个 compose 动作都没做**
#   · 33 的前置门（idp_alias_guard_recreate）：auth-bff 还占着 + compose 已无 ports: → 拒绝、指向 31；
#     compose 仍带 ports:（旧 bundle）/ nginx 已接 / 没人占 → 放行
#   · 回滚：按正常 deploy 走一个 PR D 之前的 tag（旧 20 裸 cp 旧 compose → 31 重建 nginx 摘掉 :8081 →
#     旧 30 给 auth-bff 带 ports: 重建）→ :8081 回到 auth-bff，nginx 没掉；只跑旧 30 不走 20 → auth-bff
#     撞口下线（这就是回滚要走整条 31 的原因）
#   · 纯函数：绑定行解析（真 docker 的输出原样喂；:18081 与容器侧 3081 都不算）、五格分类、渲染
#     （标记 0 行 / 2 行拒绝）、compose 的 auth-bff 段有没有 ports:
#   · 接线：20-sync 不再裸 cp、30-deploy 的交接紧跟 auth-bff 的 up -d、31 的顺序仍是 20 → nginx up → 30、
#     库里没有任何代码行读 `{{.Ports}}`、runbook 不再教人 grep `:8081->`、idp-internal.conf 的路由面与
#     写法约束、00-hardening 的 8081 豁免、compose.platform.yml 不再发布 :8081；负例喂一份删掉交接的 30 副本
# 运行：bash deploy/scripts/lib/nginx-idp-port.test.sh
#       NGINX_IDP_PORT_LIVE=1 bash …   额外对**真 docker** 起两个一次性容器（折叠形状 + 对照）跑同一条判据
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-10-04
set -euo pipefail
LIB_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$LIB_DIR/../.." && pwd)"
. "$LIB_DIR/nginx-idp-port.sh"

SRC="$DEPLOY_DIR/compose.nginx.yml"
PLATFORM="$DEPLOY_DIR/compose.platform.yml"
S20="$DEPLOY_DIR/scripts/20-sync-nginx-config.sh"
S30="$DEPLOY_DIR/scripts/30-deploy-platform-stack.sh"
S31="$DEPLOY_DIR/scripts/31-regular-upgrade-platform.sh"
S40="$DEPLOY_DIR/scripts/40-verify-platform-runtime.sh"
S51="$DEPLOY_DIR/scripts/51-check-platform-alerts.sh"
IDP_CONF="$DEPLOY_DIR/nginx/sites-enabled/idp-internal.conf"
HARDENING="$DEPLOY_DIR/nginx/conf.d/00-hardening.conf"
RUNBOOK="$DEPLOY_DIR/../docs/50-deployment/15-idp-internal-token-cutover.md"
for f in "$SRC" "$PLATFORM" "$S20" "$S30" "$S31" "$S40" "$S51" "$IDP_CONF" "$HARDENING"; do
  [ -f "$f" ] || { echo "FAIL - 缺 $f" >&2; exit 1; }
done

fail=0
ok()  { echo "ok   - $1"; }
bad() { echo "FAIL - $1" >&2; fail=1; }

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"
export VX_WORKER01_TAILNET_IP=203.0.113.1   # 文档保留段，不是任何真机

# ── 真 docker 的样子（docker 29.7.2，2026-10-04 本机实录，逐字）──────────────────────────────
# 一个容器 `-p 127.0.0.1:18080:18080 -p 127.0.0.1:18081:18081 -p 127.0.0.1:18443:18443`：
REAL_PS_PROBE='127.0.0.1:18080-18081->18080-18081/tcp, 127.0.0.1:18443->18443/tcp'
# 一个容器 `-p 127.0.0.1:18082:18082 -p 127.0.0.1:18083:18083`（对照：连号区间，但不含 18081）：
REAL_PS_CTRL='127.0.0.1:18082-18083->18082-18083/tcp'
# 一个容器 `-p 127.0.0.1:18085:3081`（切换前 auth-bff 的形状：宿主口 ≠ 容器口，不折叠）：
REAL_PS_LEGACY='127.0.0.1:18085->3081/tcp'
# 一个容器 `-p 19080:19080 -p 19443:19443 -p 127.0.0.1:19090:19090 -p 127.0.0.1:19091:19091 -p 127.0.0.1:19095:3081`
# （生产 nginx 的形状：80/443 双栈、tailnet 口连号折叠、宿主口≠容器口的排最后）：
REAL_PS_DUAL='0.0.0.0:19080->19080/tcp, [::]:19080->19080/tcp, 0.0.0.0:19443->19443/tcp, [::]:19443->19443/tcp, 127.0.0.1:19090-19091->19090-19091/tcp, 127.0.0.1:19095->3081/tcp'
# `docker inspect --format <库里的模板> fix-e1d-probe fix-e1d-legacy fix-e1d-noport fix-e1d-ctrl`（noport 只 --expose 80、
# 不发布）：每容器之后一个空行，没发布的容器只有那个空行：
REAL_INSPECT="$(printf '/fix-e1d-probe\t127.0.0.1\t18080\t18080/tcp\n/fix-e1d-probe\t127.0.0.1\t18081\t18081/tcp\n/fix-e1d-probe\t127.0.0.1\t18443\t18443/tcp\n\n/fix-e1d-legacy\t127.0.0.1\t18085\t3081/tcp\n\n\n/fix-e1d-ctrl\t127.0.0.1\t18082\t18082/tcp\n/fix-e1d-ctrl\t127.0.0.1\t18083\t18083/tcp\n')"

# 第一版库的解析（改动前）：按 Ports 列子串 `:<port>->` 找发布者。留在这里当失败控制组。
old_publishers_from_ps() {
  printf '%s\n' "${1:-}" | awk -F'\t' -v port="$IDP_ALIAS_PORT" '
    NF >= 2 { n = split($2, m, /, /); for (i = 1; i <= n; i++) if (index(m[i], ":" port "->") > 0) { print $1; break } }'
}

# ── L. 真 docker（可选）：同一条判据对着真的折叠形状 ───────────────────────────────────────
# 放在假 docker 进 PATH 之前。两个一次性容器：A 发布 18080+18081（折叠成区间），B 发布 18082+18083（对照）。
if [ "${NGINX_IDP_PORT_LIVE:-}" = "1" ]; then
  echo "== 真 docker（NGINX_IDP_PORT_LIVE=1）"
  LIVE_A="nginx-idp-port-live-a-$$"; LIVE_B="nginx-idp-port-live-b-$$"
  live_cleanup() { docker rm -f "$LIVE_A" "$LIVE_B" >/dev/null 2>&1 || true; }
  trap 'live_cleanup; rm -rf "$T"' EXIT
  if docker run -d --name "$LIVE_A" -p 127.0.0.1:18080:18080 -p 127.0.0.1:18081:18081 alpine sleep 120 >/dev/null \
     && docker run -d --name "$LIVE_B" -p 127.0.0.1:18082:18082 -p 127.0.0.1:18083:18083 alpine sleep 120 >/dev/null; then
    col="$(docker ps --format '{{.Names}}\t{{.Ports}}' | awk -F'\t' -v n="$LIVE_A" '$1 == n { print $2 }')"
    case "$col" in *"18080-18081->18080-18081/tcp"*) ok "真 docker：Ports 列把 18080+18081 折成区间（$col）——前提是真的" ;; *) bad "真 docker 的 Ports 列不是折叠形状：[$col]（docker 版本变了？下面的断言仍有效，但失败控制组的意义变了）" ;; esac
    live_pub="$(IDP_ALIAS_PORT=18081 idp_alias_publishers | tr '\n' ' ' | sed 's/ $//')"
    [ "$live_pub" = "$LIVE_A" ] && ok "真 docker：新库判 :18081 的发布者恰是 A（对照 B 的 18082-18083 不算）" || bad "真 docker：新库判 :18081 的发布者=[$live_pub]，期望 $LIVE_A"
    live_old="$(IDP_ALIAS_PORT=18081 old_publishers_from_ps "$(docker ps --format '{{.Names}}\t{{.Ports}}')")"
    [ -z "$live_old" ] && ok "真 docker：第一版的子串解析对着同一现场 → 空（失败控制组：它会把 A 判成没发布）" || bad "真 docker：第一版解析居然找到了 [$live_old]——Ports 列不再折叠？"
  else
    bad "真 docker：起不了一次性容器（端口 18080-18083 被占？docker 不可用？）"
  fi
  live_cleanup
fi

# ── 0. 纯函数 ─────────────────────────────────────────────────────────────────────────
echo "== 纯函数"
got="$(IDP_ALIAS_PORT=18081 idp_alias_publishers_from_bindings "$REAL_INSPECT" | tr '\n' ' ' | sed 's/ $//')"
[ "$got" = "fix-e1d-probe" ] && ok "绑定行解析（真 docker 输出原样）：:18081 的发布者恰是 probe——同容器多行只报一次、legacy 的 18085→3081 不算、ctrl 的 18082-18083 不算、空行不算" || bad "绑定行解析：[$got]"
[ -z "$(IDP_ALIAS_PORT=3081 idp_alias_publishers_from_bindings "$REAL_INSPECT")" ] && ok "绑定行解析：容器侧 3081 不算（只看宿主口列）" || bad "绑定行解析：容器侧 3081 被当成宿主口"
[ -z "$(IDP_ALIAS_PORT=1808 idp_alias_publishers_from_bindings "$REAL_INSPECT")" ] && [ -z "$(IDP_ALIAS_PORT=8081 idp_alias_publishers_from_bindings "$REAL_INSPECT")" ] && ok "绑定行解析：宿主口整串精确比较（1808 / 8081 都不匹配 18081）" || bad "绑定行解析：前缀 / 后缀匹配了"
[ -z "$(idp_alias_publishers_from_bindings "")" ] && ok "空输入 → 空" || bad "空输入"
# 生产形状：nginx 六个绑定（含 :8081→8081）+ 切换前的 auth-bff（:8081→3081）同时在场
prod_bind="$(printf '/vxture-nginx\t0.0.0.0\t80\t80/tcp\n/vxture-nginx\t::\t80\t80/tcp\n/vxture-nginx\t0.0.0.0\t443\t443/tcp\n/vxture-nginx\t::\t443\t443/tcp\n/vxture-nginx\t203.0.113.1\t8080\t8080/tcp\n/vxture-nginx\t203.0.113.1\t8081\t8081/tcp\n\n/vx-platform-auth-bff\t203.0.113.1\t8081\t3081/tcp\n\n/vx-platform-website\n\n')"
[ "$(idp_alias_publishers_from_bindings "$prod_bind" | tr '\n' ' ')" = "vxture-nginx vx-platform-auth-bff " ] && ok "生产形状：两个发布者都列出、按输入顺序、名字去掉前导 /" || bad "生产形状：[$(idp_alias_publishers_from_bindings "$prod_bind" | tr '\n' ' ')]"

[ "$(idp_alias_classify "" "")" = "free" ] && ok "classify：无人 → free" || bad "classify free"
[ "$(idp_alias_classify "" "LISTEN 0 4096 203.0.113.1:8081 0.0.0.0:*")" = "host-listener" ] && ok "classify：docker 零发布 + ss 有人听 → host-listener" || bad "classify host-listener"
[ "$(idp_alias_classify "vxture-nginx" "LISTEN 0 4096 203.0.113.1:8081 0.0.0.0:*")" = "nginx" ] && ok "classify：nginx 占（ss 里的 docker-proxy 不算外人）→ nginx" || bad "classify nginx"
[ "$(idp_alias_classify "vx-platform-auth-bff" "")" = "legacy" ] && ok "classify：只有 auth-bff → legacy" || bad "classify legacy"
[ "$(idp_alias_classify "rogue" "")" = "foreign rogue" ] && ok "classify：别的容器 → foreign <name>" || bad "classify foreign: [$(idp_alias_classify "rogue" "")]"
[ "$(idp_alias_classify "$(printf 'vxture-nginx\nvx-platform-auth-bff\n')" "")" = "foreign vxture-nginx vx-platform-auth-bff" ] && ok "classify：两个一起占 → foreign（不猜哪个对）" || bad "classify both: [$(idp_alias_classify "$(printf 'vxture-nginx\nvx-platform-auth-bff\n')" "")]"

# 渲染
idp_alias_render_compose "$SRC" "$T/inc.yml" include && cmp -s "$SRC" "$T/inc.yml" && ok "render include → 与仓内 compose.nginx.yml 逐字节相同" || bad "render include"
idp_alias_render_compose "$SRC" "$T/strip.yml" strip
if ! grep -q ':8081:8081' "$T/strip.yml" && grep -q ':8080:8080' "$T/strip.yml" && [ "$(wc -l < "$T/strip.yml")" = "$(( $(wc -l < "$SRC") - 1 ))" ]; then
  ok "render strip → 恰少那一行 :8081 发布，:8080 与其余原样"
else
  bad "render strip：$(grep -c ':8081:8081' "$T/strip.yml") 行 8081，$(wc -l < "$T/strip.yml") 行（源 $(wc -l < "$SRC")）"
fi
grep -v -F -- "$IDP_ALIAS_MARKER" "$SRC" > "$T/nomarker.yml"
idp_alias_render_compose "$T/nomarker.yml" "$T/x.yml" include 2>/dev/null && bad "源里没有标记却渲染成功" || ok "源里没有标记 → 拒绝（没标记就无法延后，31 会撞口）"
{ cat "$SRC"; grep -F -- "$IDP_ALIAS_MARKER" "$SRC"; } > "$T/twomarker.yml"
idp_alias_render_compose "$T/twomarker.yml" "$T/x.yml" strip 2>/dev/null && bad "源里两行标记却渲染成功" || ok "源里两行标记 → 拒绝"
[ "$(grep -c -F -- "$IDP_ALIAS_MARKER" "$SRC")" = "1" ] && grep -F -- "$IDP_ALIAS_MARKER" "$SRC" | grep -q '"${VX_WORKER01_TAILNET_IP:?[^}]*}:8081:8081"' \
  && ok "仓内 compose.nginx.yml：标记恰一行，且那一行把 tailnet :8081 发到容器 8081" || bad "仓内 compose.nginx.yml 的标记行不对"

# compose.platform.yml 的 auth-bff 段有没有 ports:（33 的门用）。旧形状 = 在 container_name 之后插回那两行。
OLD_PLATFORM="$T/old-compose.platform.yml"
awk '{ print } /^    container_name: vx-platform-auth-bff$/ { print "    ports:"; print "      - \"${VX_WORKER01_TAILNET_IP:?set it in runtime/.env}:8081:3081\"" }' "$PLATFORM" > "$OLD_PLATFORM"
idp_alias_compose_publishes_port "$PLATFORM" && bad "compose_publishes_port：仓内 compose 被判成仍发布 :8081" || ok "compose_publishes_port：仓内 compose（PR D 之后）→ 不发布"
idp_alias_compose_publishes_port "$OLD_PLATFORM" && ok "compose_publishes_port：插回 ports: 的旧形状 → 发布" || bad "compose_publishes_port：旧形状没认出来"
sed 's/^      - "\${VX_WORKER01_TAILNET_IP:?set it in runtime\/.env}:8081:3081"/      # - "x:8081:3081"/' "$OLD_PLATFORM" > "$T/commented.yml"
idp_alias_compose_publishes_port "$T/commented.yml" && bad "compose_publishes_port：注释掉的 ports 行被当真" || ok "compose_publishes_port：注释行不算"
awk '{ print } /^    container_name: vx-platform-admin-bff$/ { print "    ports:"; print "      - \"203.0.113.1:8081:3081\"" }' "$PLATFORM" > "$T/otherservice.yml"
idp_alias_compose_publishes_port "$T/otherservice.yml" && bad "compose_publishes_port：别的服务段里的 :8081 被算到 auth-bff 头上" || ok "compose_publishes_port：只看 auth-bff 段"

# ── 1. 假 docker / 假 ss ───────────────────────────────────────────────────────────────
# 夹具目录 $FX：
#   containers.txt    在跑容器名，一行一个（`docker ps --format '{{.Names}}'` 的输出）
#   bindings.txt      宿主口绑定：<容器名>\t<宿主 IP>\t<宿主口>\t<容器口/协议>，一绑定一行（宿主口状态的唯一真值）
#   ss.txt            当前 `ss -ltnH …` 会吐的内容
#   calls.log         每次 docker 调用的 argv
#   nginx.recreates / nginx.creates   计数
#   nginx.down        nginx 起不来时留下（compose 先停旧再起新：新的失败，旧的已经没了）
#   authbff.down      auth-bff 起不来时留下（同理）
# `inspect --format <库里的模板> <名>…`：按 bindings.txt 吐模板行（每容器之后一个空行；没的名报错 exit 1）。
# `ps --format '{{.Names}}\t{{.Ports}}'`：Ports 列按 docker 的 DisplayablePorts 渲染（见 render_ports_column）。
# `compose -f <file> up -d`：
#   nginx 项目（文件里有 container_name: vxture-nginx）：文件要不要发布 :8081 与现场比——要发布而现场
#   别的容器占着 → 报 port is already allocated、nginx 下线、exit 1；要发布且空着 → 重建（或首次创建）
#   带上 8081；不要发布而现场带着 → 重建去掉；其余无变化。FAKE_NGINX_IGNORE_8081=1 时假装起来了但没发布
#   （模拟 up -d 绿、口却没接上）。
#   平台项目 `up -d --no-deps <svc>`：auth-bff → 看 compose 文件的 auth-bff 段给不给 ports:：给（切换前的
#   文件）→ 重建后发布 :8081→3081，别人占着则撞口下线；不给（PR D 之后）→ 重建后不发布任何宿主口。
#   其余服务无变化。
cat > "$T/bin/docker" <<'EOF'
#!/usr/bin/env bash
D="${FAKE_DOCKER_DIR:?}"
printf '%s\n' "$*" >> "$D/calls.log"
touch "$D/containers.txt" "$D/bindings.txt"
NGINX_BASE=$'0.0.0.0\t80\t80/tcp\n::\t80\t80/tcp\n0.0.0.0\t443\t443/tcp\n::\t443\t443/tcp\n203.0.113.1\t8080\t8080/tcp'
NGINX_8081=$'203.0.113.1\t8081\t8081/tcp'
AUTH_LEGACY=$'203.0.113.1\t8081\t3081/tcp'
has_container() { grep -Fxq -- "$1" "$D/containers.txt"; }
add_container() { has_container "$1" || printf '%s\n' "$1" >> "$D/containers.txt"; }
clear_bindings() { awk -F'\t' -v n="$1" '$1 != n' "$D/bindings.txt" > "$D/b.tmp"; mv "$D/b.tmp" "$D/bindings.txt"; }
rm_container() { grep -Fxv -- "$1" "$D/containers.txt" > "$D/c.tmp" || true; mv "$D/c.tmp" "$D/containers.txt"; clear_bindings "$1"; }
set_bindings() { # set_bindings <name> "<ip\tport\tcport 行>"
  clear_bindings "$1"; add_container "$1"
  [ -n "$2" ] && printf '%s\n' "$2" | awk -F'\t' -v OFS='\t' -v n="$1" 'NF >= 3 { print n, $1, $2, $3 }' >> "$D/bindings.txt"
  return 0
}
holders() { awk -F'\t' -v p="$1" '$3 == p { print $1 }' "$D/bindings.txt" | sort -u; }
# docker/cli formatter/container.go 的 DisplayablePorts：按 (容器口, IP, 宿主口) 排序；宿主口 ≠ 容器口的
# 单列排最后；其余按 IP/协议分组，连号折成 a-b；组在「下一个不连号」时或收尾时按首见顺序输出。IPv6 加 []。
render_ports_column() {
  awk -F'\t' -v n="$1" '$1 == n { print $2 "\t" $3 "\t" $4 }' "$D/bindings.txt" | awk -F'\t' '
    function fmtip(ip) { return (index(ip, ":") > 0) ? "[" ip "]" : ip }
    function formgroup(key, s, e,   parts, m, ip, type, g) {
      m = split(key, parts, "/")
      if (m > 1) { ip = parts[1]; type = parts[2] } else { ip = ""; type = parts[1] }
      g = (s == e) ? s "" : s "-" e
      if (ip != "") g = fmtip(ip) ":" g "->" g
      return g "/" type
    }
    function less(a, b) {
      if (P[a] != P[b]) return P[a] < P[b]
      if (I[a] != I[b]) return I[a] < I[b]
      if (U[a] != U[b]) return U[a] < U[b]
      return T[a] < T[b]
    }
    function swap(a, b,   t) { t = P[a]; P[a] = P[b]; P[b] = t; t = I[a]; I[a] = I[b]; I[b] = t; t = U[a]; U[a] = U[b]; U[b] = t; t = T[a]; T[a] = T[b]; T[b] = t }
    { split($3, a, "/"); n++; P[n] = a[1] + 0; T[n] = a[2]; I[n] = $1; U[n] = $2 + 0 }
    END {
      for (i = 2; i <= n; i++) { j = i; while (j > 1 && less(j, j - 1)) { swap(j, j - 1); j-- } }
      nres = 0; nhost = 0; nkeys = 0
      for (i = 1; i <= n; i++) {
        cur = P[i]; key = T[i]
        if (I[i] != "") {
          if (U[i] != cur) { host[++nhost] = fmtip(I[i]) ":" U[i] "->" cur "/" T[i]; continue }
          key = I[i] "/" T[i]
        }
        if (!(key in gfirst)) { gfirst[key] = cur; glast[key] = cur; keys[++nkeys] = key; continue }
        if (cur == glast[key] + 1) { glast[key] = cur; continue }
        res[++nres] = formgroup(key, gfirst[key], glast[key]); gfirst[key] = cur; glast[key] = cur
      }
      for (k = 1; k <= nkeys; k++) res[++nres] = formgroup(keys[k], gfirst[keys[k]], glast[keys[k]])
      for (h = 1; h <= nhost; h++) res[++nres] = host[h]
      out = ""; for (r = 1; r <= nres; r++) out = out (r > 1 ? ", " : "") res[r]
      print out
    }'
}
case "${1:-}" in
  ps)
    [ -n "${FAKE_DOCKER_PS_FAIL:-}" ] && { echo "Cannot connect to the Docker daemon" >&2; exit 1; }
    case "$*" in
      *Ports*) while IFS= read -r c; do [ -n "$c" ] && printf '%s\t%s\n' "$c" "$(render_ports_column "$c")"; done < "$D/containers.txt" ;;
      *) cat "$D/containers.txt" ;;
    esac
    exit 0
    ;;
  inspect)
    [ -n "${FAKE_DOCKER_PS_FAIL:-}" ] && { echo "Cannot connect to the Docker daemon" >&2; exit 1; }
    shift; fmt=""
    if [ "${1:-}" = "--format" ]; then fmt="$2"; shift 2; fi
    case "$fmt" in *NetworkSettings.Ports*) ;; *) echo "fake docker: 未预期的 inspect --format $fmt" >&2; exit 99 ;; esac
    rc=0
    for c in "$@"; do
      # ghosts.txt 里的名：ps 还列着、inspect 已不认识（容器在两次调用之间没了）
      if ! has_container "$c" || grep -Fxq -- "$c" "$D/ghosts.txt" 2>/dev/null; then echo "Error response from daemon: No such object: $c" >&2; rc=1; continue; fi
      awk -F'\t' -v OFS='\t' -v n="$c" '$1 == n { print "/" $1, $2, $3, $4 }' "$D/bindings.txt"
      echo
    done
    exit $rc
    ;;
  compose)
    shift
    file=""; args=()
    while [ $# -gt 0 ]; do
      if [ "$1" = "-f" ]; then file="$2"; shift 2; continue; fi
      args+=("$1"); shift
    done
    [ "${args[0]:-}" = "up" ] || { echo "fake docker: 未预期的 compose 子命令 ${args[*]}" >&2; exit 99; }
    if grep -q 'container_name: vxture-nginx' "$file"; then
      want=0; grep -vE '^[[:space:]]*#' "$file" | grep -q ':8081:8081' && want=1
      has=0; holders 8081 | grep -Fxq vxture-nginx && has=1
      exists=0; has_container vxture-nginx && exists=1
      if [ "$want" = 1 ] && [ "$has" = 0 ]; then
        if [ -n "$(holders 8081)" ]; then
          echo "Error response from daemon: driver failed programming external connectivity on endpoint vxture-nginx: Bind for 203.0.113.1:8081 failed: port is already allocated" >&2
          rm_container vxture-nginx; touch "$D/nginx.down"
          exit 1
        fi
        if [ -n "${FAKE_NGINX_IGNORE_8081:-}" ]; then set_bindings vxture-nginx "$NGINX_BASE"; else set_bindings vxture-nginx "$NGINX_BASE"$'\n'"$NGINX_8081"; fi
        if [ "$exists" = 1 ]; then echo 1 >> "$D/nginx.recreates"; echo " Container vxture-nginx Recreated"; else echo 1 >> "$D/nginx.creates"; echo " Container vxture-nginx Created"; fi
      elif [ "$want" = 0 ] && [ "$has" = 1 ]; then
        set_bindings vxture-nginx "$NGINX_BASE"
        echo 1 >> "$D/nginx.recreates"; echo " Container vxture-nginx Recreated"
      elif [ "$exists" = 0 ]; then
        set_bindings vxture-nginx "$NGINX_BASE"
        echo 1 >> "$D/nginx.creates"; echo " Container vxture-nginx Created"
      else
        echo " Container vxture-nginx Running"
      fi
      exit 0
    fi
    # 平台项目
    svc="${args[${#args[@]}-1]}"
    case "$svc" in
      auth-bff)
        want=0
        awk '/^  [a-z][a-z0-9-]*:[[:space:]]*$/ { f = ($1 == "auth-bff:") } f && !/^[[:space:]]*#/ && index($0, ":8081:") > 0 { hit = 1 } END { exit !hit }' "$file" && want=1
        if [ "$want" = 1 ]; then
          if holders 8081 | grep -Fxv -- vx-platform-auth-bff | grep -q .; then
            echo "Error response from daemon: driver failed programming external connectivity on endpoint vx-platform-auth-bff: Bind for 203.0.113.1:8081 failed: port is already allocated" >&2
            rm_container vx-platform-auth-bff; touch "$D/authbff.down"
            exit 1
          fi
          set_bindings vx-platform-auth-bff "$AUTH_LEGACY"
        else
          set_bindings vx-platform-auth-bff ""
        fi
        echo " Container vx-platform-auth-bff Recreated"
        ;;
      *) echo " Container $svc Running" ;;
    esac
    exit 0
    ;;
  *) echo "fake docker: 未预期的子命令 ${1:-}" >&2; exit 99 ;;
esac
EOF
cat > "$T/bin/ss" <<'EOF'
#!/usr/bin/env bash
cat "${FAKE_DOCKER_DIR:?}/ss.txt"
EOF
chmod +x "$T/bin/docker" "$T/bin/ss"
export PATH="$T/bin:$PATH"

FX=""
fixture() { # fixture <名> → 空夹具 + 独立的「主机 nginx 目录」
  FX="$T/fx/$1"; rm -rf "$FX"; mkdir -p "$FX/host/nginx"; : > "$FX/containers.txt"; : > "$FX/bindings.txt"; : > "$FX/ss.txt"; : > "$FX/calls.log"
  export FAKE_DOCKER_DIR="$FX"
  DST="$FX/host/nginx/compose.yml"
}
ctr() { # ctr <容器名> [<宿主 IP> <宿主口> <容器口/协议>]…
  local name="$1"; shift
  printf '%s\n' "$name" >> "$FX/containers.txt"
  while [ $# -ge 3 ]; do printf '%s\t%s\t%s\t%s\n' "$name" "$1" "$2" "$3" >> "$FX/bindings.txt"; shift 3; done
}
NGINX_BASE_ARGS=(0.0.0.0 80 80/tcp :: 80 80/tcp 0.0.0.0 443 443/tcp :: 443 443/tcp 203.0.113.1 8080 8080/tcp)
publishers_now() { idp_alias_publishers | tr '\n' ' ' | sed 's/ $//'; }
ports_column() { docker ps --format '{{.Names}}\t{{.Ports}}' | awk -F'\t' -v n="$1" '$1 == n { print $2 }'; }
count() { if [ -f "$FX/$1" ]; then grep -c . "$FX/$1"; else echo 0; fi; }
compose_calls() { grep -c '^compose ' "$FX/calls.log" || true; }
# 30-deploy 第 [4/4] 步的骨架：顺序钉死后 auth-bff 在首位；每个服务 up -d --no-deps；auth-bff 之后立刻交接。
run_30_loop() {
  local svc
  for svc in auth-bff admin-bff arche-bff opera-bff website console gateway-bff; do
    docker compose -f "$PLATFORM" up -d --no-deps "$svc" >/dev/null
    if [ "$svc" = "auth-bff" ]; then idp_alias_handover "$SRC" "$DST"; fi
  done
}
OUT=""; RC=0
capture() { set +e; OUT="$("$@" 2>&1)"; RC=$?; set -e; }

# ── 1a. 假 docker 的 Ports 列必须逐字等于真 docker ─────────────────────────────────────────
echo "== 假 docker 的渲染 == 真 docker 的实录"
fixture shapes
ctr fix-e1d-probe 127.0.0.1 18080 18080/tcp 127.0.0.1 18081 18081/tcp 127.0.0.1 18443 18443/tcp
ctr fix-e1d-ctrl 127.0.0.1 18082 18082/tcp 127.0.0.1 18083 18083/tcp
ctr fix-e1d-legacy 127.0.0.1 18085 3081/tcp
ctr fix-e1d-noport
ctr fix-e1d-dual 0.0.0.0 19080 19080/tcp :: 19080 19080/tcp 127.0.0.1 19090 19090/tcp 127.0.0.1 19091 19091/tcp 0.0.0.0 19443 19443/tcp :: 19443 19443/tcp 127.0.0.1 19095 3081/tcp
[ "$(ports_column fix-e1d-probe)" = "$REAL_PS_PROBE" ] && ok "Ports 列：18080+18081+18443 → 「$REAL_PS_PROBE」" || bad "Ports 列 probe：[$(ports_column fix-e1d-probe)]"
[ "$(ports_column fix-e1d-ctrl)" = "$REAL_PS_CTRL" ] && ok "Ports 列：18082+18083 → 「$REAL_PS_CTRL」" || bad "Ports 列 ctrl：[$(ports_column fix-e1d-ctrl)]"
[ "$(ports_column fix-e1d-legacy)" = "$REAL_PS_LEGACY" ] && ok "Ports 列：18085→3081 → 「$REAL_PS_LEGACY」（不折叠）" || bad "Ports 列 legacy：[$(ports_column fix-e1d-legacy)]"
[ "$(ports_column fix-e1d-dual)" = "$REAL_PS_DUAL" ] && ok "Ports 列：双栈 + 连号 + 异口 → 与实录逐字相同（分组顺序、[::]、异口排最后）" || bad "Ports 列 dual：[$(ports_column fix-e1d-dual)]"
# 同一夹具经 inspect 模板 → 与真 docker 的输出逐字相同（probe / legacy / noport / ctrl 四个容器，按这个顺序问）
[ "$(docker inspect --format "$IDP_ALIAS_INSPECT_FORMAT" fix-e1d-probe fix-e1d-legacy fix-e1d-noport fix-e1d-ctrl)" = "$REAL_INSPECT" ] && ok "inspect 模板输出：与真 docker 实录逐字相同（含每容器之后的空行、没发布的容器只有空行）" || bad "inspect 模板输出与实录不同：[$(docker inspect --format "$IDP_ALIAS_INSPECT_FORMAT" fix-e1d-probe fix-e1d-legacy fix-e1d-noport fix-e1d-ctrl | cat -A | tr '\n' '|')]"
[ "$(IDP_ALIAS_PORT=18081 publishers_now)" = "fix-e1d-probe" ] && ok "新库对假 docker：:18081 → probe" || bad "新库对假 docker：[$(IDP_ALIAS_PORT=18081 publishers_now)]"

echo "== 失败控制组②：第一版按 Ports 列子串解析"
fixture handed
ctr vxture-nginx "${NGINX_BASE_ARGS[@]}" 203.0.113.1 8081 8081/tcp
ctr vx-platform-auth-bff
col="$(ports_column vxture-nginx)"
case "$col" in *"203.0.113.1:8080-8081->8080-8081/tcp"*) ok "已交接的 nginx：Ports 列是折叠形状（$col）" ;; *) bad "已交接的 nginx 的 Ports 列没折叠：[$col]" ;; esac
case "$col" in *":8081->"*) bad "折叠形状里居然有 :8081-> 子串" ;; *) ok "折叠形状里没有 :8081-> 子串——第一版找的就是它" ;; esac
[ -z "$(old_publishers_from_ps "$(docker ps --format '{{.Names}}\t{{.Ports}}')")" ] && ok "第一版解析 → 空（会判 free：30 交接后断言红、下次 20-sync 被 ss 判成 host-listener）" || bad "第一版解析居然找到了"
[ "$(publishers_now)" = "vxture-nginx" ] && [ "$(idp_alias_classify "$(idp_alias_publishers)" "LISTEN 0 4096 203.0.113.1:8081 0.0.0.0:* users:((\"docker-proxy\",pid=1,fd=4))")" = "nginx" ] && ok "新库 → vxture-nginx，带着 ss 里的 docker-proxy 仍判 nginx" || bad "新库：[$(publishers_now)]"

# ── 2. 切换中的主机：按 31 的顺序走一遍，再走一遍 ──────────────────────────────────────────
echo "== 现场 A：切换中的主机（auth-bff 还直接发布 :8081）"
fixture mid
ctr vxture-nginx "${NGINX_BASE_ARGS[@]}"
ctr vx-platform-auth-bff 203.0.113.1 8081 3081/tcp
ctr vx-platform-admin-bff
ctr vx-platform-website
echo "LISTEN 0 4096 203.0.113.1:8081 0.0.0.0:* users:((\"docker-proxy\",pid=1,fd=4))" > "$FX/ss.txt"
[ "$(ports_column vx-platform-auth-bff)" = "203.0.113.1:8081->3081/tcp" ] && ok "A·起点：auth-bff 的 Ports 列是切换前的形状" || bad "A·起点：[$(ports_column vx-platform-auth-bff)]"

capture idp_alias_sync "$SRC" "$DST"                                           # 20-sync
[ "$RC" -eq 0 ] && ok "A·20-sync：exit 0" || bad "A·20-sync：rc=$RC out=[$OUT]"
printf '%s' "$OUT" | grep -q "切换中" && ok "A·20-sync：说了「切换中、延后到 30-deploy」" || bad "A·20-sync 输出：[$OUT]"
! grep -q ':8081:8081' "$DST" && grep -q ':8080:8080' "$DST" && ok "A·20-sync：主机 compose 不带 :8081 发布（与现有 nginx 容器等价）" || bad "A·20-sync 落盘内容"
[ "$(compose_calls)" = "0" ] && ok "A·20-sync：没碰任何容器" || bad "A·20-sync 调了 compose"

capture docker compose -f "$DST" up -d                                          # 31：启动或更新 Nginx
[ "$RC" -eq 0 ] && [ "$(count nginx.recreates)" = "0" ] && [ ! -e "$FX/nginx.down" ] && ok "A·31 nginx up -d：无变化、没重建、nginx 没掉" || bad "A·31：rc=$RC recreates=$(count nginx.recreates) down=$([ -e "$FX/nginx.down" ] && echo yes || echo no)"
[ "$(publishers_now)" = "vx-platform-auth-bff" ] && ok "A·31 之后 :8081 仍由 auth-bff 发布（产品此刻还在直通上，没断）" || bad "A·31 之后发布者：[$(publishers_now)]"

: > "$FX/ss.txt"                                                                 # auth-bff 一停，docker-proxy 也就没了
capture run_30_loop                                                             # 30：逐服务 + 交接
[ "$RC" -eq 0 ] && ok "A·30：exit 0" || bad "A·30：rc=$RC out=[$OUT]"
printf '%s' "$OUT" | grep -q "交接完成" && ok "A·30：打印「交接完成」" || bad "A·30 输出：[$OUT]"
[ "$(publishers_now)" = "vxture-nginx" ] && ok "A·30 之后 :8081 恰由 vxture-nginx 发布" || bad "A·30 之后发布者：[$(publishers_now)]"
case "$(ports_column vxture-nginx)" in *"8080-8081->8080-8081"*) ok "A·30 之后 nginx 的 Ports 列是折叠形状——上一条断言成立在真 docker 会给的形状上" ;; *) bad "A·30 之后 nginx 的 Ports 列：[$(ports_column vxture-nginx)]" ;; esac
[ "$(count nginx.recreates)" = "1" ] && ok "A·30：nginx 恰重建一次" || bad "A·30：nginx 重建 $(count nginx.recreates) 次"
[ ! -e "$FX/nginx.down" ] && ok "A·全程 nginx 一次都没起不来" || bad "A：nginx 掉过"
cmp -s "$SRC" "$DST" && ok "A·30 之后主机 compose == 仓内终态" || bad "A·30 之后主机 compose 与仓内不同"
# 交接紧跟 auth-bff：calls.log 里 auth-bff 的 up 之后下一条 compose 调用就是 nginx 的 up
seq="$(grep '^compose ' "$FX/calls.log" | awk '{ if ($0 ~ /--no-deps auth-bff$/) print "AUTH"; else if ($0 ~ /compose\.yml up -d$/) print "NGINX"; else print "OTHER" }' | tr '\n' ' ')"
case "$seq" in
  *"AUTH NGINX "*) ok "A·交接紧跟 auth-bff 的 up -d（调用序列：$seq）" ;;
  *) bad "A·交接没有紧跟 auth-bff（调用序列：$seq）" ;;
esac

echo "== 现场 A'：同一台主机的下一次 deploy（幂等）"
: > "$FX/calls.log"
echo "LISTEN 0 4096 203.0.113.1:8081 0.0.0.0:* users:((\"docker-proxy\",pid=1,fd=4))" > "$FX/ss.txt"   # nginx 自己的 docker-proxy
capture idp_alias_sync "$SRC" "$DST"
[ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q "已交接" && cmp -s "$SRC" "$DST" && ok "A'·20-sync：判到已交接、落终态（ss 里 nginx 自己的 docker-proxy 不会被判成宿主进程）" || bad "A'·20-sync：rc=$RC out=[$OUT]"
capture docker compose -f "$DST" up -d
[ "$RC" -eq 0 ] && [ "$(count nginx.recreates)" = "1" ] && ok "A'·31 nginx up -d：无变化（累计重建仍是 1）" || bad "A'·31：rc=$RC recreates=$(count nginx.recreates)"
capture run_30_loop
[ "$RC" -eq 0 ] && [ "$(count nginx.recreates)" = "1" ] && [ "$(publishers_now)" = "vxture-nginx" ] && ok "A'·30：交接判到已占、up -d 无变化、发布者不变" || bad "A'·30：rc=$RC recreates=$(count nginx.recreates) pub=[$(publishers_now)] out=[$OUT]"

echo "== 失败控制组①：改动前的 20-sync 是裸 cp"
fixture naive
ctr vxture-nginx "${NGINX_BASE_ARGS[@]}"
ctr vx-platform-auth-bff 203.0.113.1 8081 3081/tcp
cp "$SRC" "$DST"                                                                 # 旧 20-sync 的那一行
capture docker compose -f "$DST" up -d                                          # 31
[ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q "port is already allocated" && [ -e "$FX/nginx.down" ] \
  && ok "控制组：裸 cp + 31 的 up -d → port is already allocated，nginx 下线（碰撞是真的，假 docker 看得见）" \
  || bad "控制组没红：rc=$RC down=$([ -e "$FX/nginx.down" ] && echo yes || echo no) out=[$OUT]"

# ── 3. 新主机 ─────────────────────────────────────────────────────────────────────────
echo "== 现场 B：新主机（没有任何容器）"
fixture fresh
capture idp_alias_sync "$SRC" "$DST"
[ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q "没人发布" && cmp -s "$SRC" "$DST" && ok "B·20-sync：没人占 → 直接落终态" || bad "B·20-sync：rc=$RC out=[$OUT]"
capture docker compose -f "$DST" up -d
[ "$RC" -eq 0 ] && [ "$(count nginx.creates)" = "1" ] && [ "$(count nginx.recreates)" = "0" ] && [ "$(publishers_now)" = "vxture-nginx" ] \
  && ok "B·31 nginx up -d：第一次创建就带 :8081，发布者 = vxture-nginx" || bad "B·31：rc=$RC creates=$(count nginx.creates) pub=[$(publishers_now)]"
capture run_30_loop
[ "$RC" -eq 0 ] && [ "$(count nginx.recreates)" = "0" ] && [ "$(publishers_now)" = "vxture-nginx" ] && ok "B·30：交接无变化、零重建" || bad "B·30：rc=$RC recreates=$(count nginx.recreates) out=[$OUT]"

# ── 4. 响亮失败：每条都非零退出，且一个 compose 动作都没做 ──────────────────────────────────
echo "== 响亮失败"
fixture rogue
ctr vxture-nginx "${NGINX_BASE_ARGS[@]}"
ctr rogue 203.0.113.1 8081 8081/tcp
capture idp_alias_sync "$SRC" "$DST"
[ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q "rogue" && [ ! -e "$DST" ] && ok "别的容器占着 → 20-sync 非零、点名 rogue、不落 compose" || bad "rogue·sync：rc=$RC dst=$([ -e "$DST" ] && echo yes || echo no) out=[$OUT]"
capture idp_alias_handover "$SRC" "$DST"
[ "$RC" -ne 0 ] && [ "$(compose_calls)" = "0" ] && ok "别的容器占着 → 交接非零、零 compose 动作" || bad "rogue·handover：rc=$RC compose=$(compose_calls)"

fixture hostproc
ctr vxture-nginx "${NGINX_BASE_ARGS[@]}"
echo "LISTEN 0 128 203.0.113.1:8081 0.0.0.0:* users:((\"python3\",pid=4242,fd=3))" > "$FX/ss.txt"
capture idp_alias_sync "$SRC" "$DST"
[ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q "ss" && [ ! -e "$DST" ] && ok "宿主进程在听 → 20-sync 非零、提到 ss、不落 compose" || bad "hostproc·sync：rc=$RC out=[$OUT]"
capture idp_alias_handover "$SRC" "$DST"
[ "$RC" -ne 0 ] && [ "$(compose_calls)" = "0" ] && ok "宿主进程在听 → 交接非零、零 compose 动作" || bad "hostproc·handover：rc=$RC compose=$(compose_calls)"

fixture stale
ctr vxture-nginx "${NGINX_BASE_ARGS[@]}"
ctr vx-platform-auth-bff 203.0.113.1 8081 3081/tcp
capture idp_alias_handover "$SRC" "$DST"
[ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q "仍由" && [ "$(compose_calls)" = "0" ] && [ ! -e "$DST" ] \
  && ok "auth-bff 重建后仍占着（主机 compose.platform.yml 过旧）→ 交接非零、零 compose 动作、不落 compose" || bad "stale：rc=$RC compose=$(compose_calls) out=[$OUT]"

fixture psfail
capture env FAKE_DOCKER_PS_FAIL=1 bash -c '. "$0"; idp_alias_sync "$1" "$2"' "$LIB_DIR/nginx-idp-port.sh" "$SRC" "$DST"
[ "$RC" -ne 0 ] && [ ! -e "$DST" ] && ok "docker 坏了 → 20-sync 非零、不落 compose（不能判就不判）" || bad "psfail：rc=$RC out=[$OUT]"

fixture inspectfail                                                              # ps 列出了一个 inspect 不认识的名（容器在两次调用之间没了）
ctr vxture-nginx "${NGINX_BASE_ARGS[@]}"
ctr ghost
printf 'ghost\n' > "$FX/ghosts.txt"
capture bash -c '. "$0"; b="$(idp_alias_bindings)"; echo "rc=$?"' "$LIB_DIR/nginx-idp-port.sh"
printf '%s' "$OUT" | grep -q "rc=1" && ok "inspect 对某个名报错 → bindings 整体失败（不拿半截现场当判据）" || bad "inspectfail：[$OUT]"
capture idp_alias_handover "$SRC" "$DST"
[ "$RC" -ne 0 ] && [ "$(compose_calls)" = "0" ] && ok "inspect 坏了 → 交接非零、零 compose 动作" || bad "inspectfail·handover：rc=$RC compose=$(compose_calls)"

fixture ignored
ctr vxture-nginx "${NGINX_BASE_ARGS[@]}"
capture env FAKE_NGINX_IGNORE_8081=1 bash -c '. "$0"; idp_alias_handover "$1" "$2"' "$LIB_DIR/nginx-idp-port.sh" "$SRC" "$DST"
[ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q "交接后" && ok "up -d 绿了但 nginx 没发布 :8081 → 交接非零（成功信号也要验）" || bad "ignored：rc=$RC out=[$OUT]"

fixture nodir
rm -rf "$FX/host"
capture idp_alias_handover "$SRC" "$DST"
[ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q "20-sync" && [ "$(compose_calls)" = "0" ] && ok "nginx 从没同步过 → 交接非零、指向 20-sync" || bad "nodir：rc=$RC out=[$OUT]"

# ── 5. 33 的前置门：idp_alias_guard_recreate ─────────────────────────────────────────────────
echo "== 33 的前置门（重建 auth-bff 之前）"
fixture guard_legacy
ctr vxture-nginx "${NGINX_BASE_ARGS[@]}"
ctr vx-platform-auth-bff 203.0.113.1 8081 3081/tcp
capture idp_alias_guard_recreate "$PLATFORM"
[ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q "31" && [ "$(compose_calls)" = "0" ] && ok "auth-bff 还占着 + compose 已无 ports: → 拒绝、指向 31、零 compose 动作" || bad "guard_legacy：rc=$RC out=[$OUT]"
capture idp_alias_guard_recreate "$OLD_PLATFORM"
[ "$RC" -eq 0 ] && ok "auth-bff 还占着 + compose 仍带 ports:（旧 bundle）→ 放行（重建后它自己再发布一次）" || bad "guard_legacy_oldcompose：rc=$RC out=[$OUT]"
fixture guard_nginx
ctr vxture-nginx "${NGINX_BASE_ARGS[@]}" 203.0.113.1 8081 8081/tcp
ctr vx-platform-auth-bff
capture idp_alias_guard_recreate "$PLATFORM"
[ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q "nginx" && ok "nginx 已接（折叠形状）→ 放行" || bad "guard_nginx：rc=$RC out=[$OUT]"
fixture guard_free
ctr vx-platform-auth-bff
capture idp_alias_guard_recreate "$PLATFORM"
[ "$RC" -eq 0 ] && ok "没人占 → 放行（33 不是修这个的地方，重建 auth-bff 也不改变它）" || bad "guard_free：rc=$RC out=[$OUT]"
fixture guard_psfail
capture env FAKE_DOCKER_PS_FAIL=1 bash -c '. "$0"; idp_alias_guard_recreate "$1"' "$LIB_DIR/nginx-idp-port.sh" "$PLATFORM"
[ "$RC" -ne 0 ] && ok "docker 坏了 → 拒绝（不能判就不判）" || bad "guard_psfail：rc=$RC"

# ── 6. 回滚到 PR D 之前的 tag ─────────────────────────────────────────────────────────────
# 旧 bundle = 旧 20-sync（裸 cp）+ 旧 compose.nginx.yml（没有那一行）+ 旧 compose.platform.yml（auth-bff 带 ports:）。
echo "== 回滚：按正常 deploy 走旧 tag（20 → nginx up → 30）"
OLD_NGINX="$T/old-compose.nginx.yml"; grep -v -F -- "$IDP_ALIAS_MARKER" "$SRC" > "$OLD_NGINX"
fixture rollback
ctr vxture-nginx "${NGINX_BASE_ARGS[@]}" 203.0.113.1 8081 8081/tcp
ctr vx-platform-auth-bff
cp "$OLD_NGINX" "$DST"                                                           # 旧 20-sync：裸 cp 旧文件
capture docker compose -f "$DST" up -d                                          # 31：nginx 重建、摘掉 :8081
[ "$RC" -eq 0 ] && [ "$(count nginx.recreates)" = "1" ] && [ ! -e "$FX/nginx.down" ] && [ -z "$(publishers_now)" ] && ok "回滚·31 nginx up -d：重建一次摘掉 :8081，nginx 没掉，此刻没人发布（窗口开始）" || bad "回滚·31：rc=$RC recreates=$(count nginx.recreates) pub=[$(publishers_now)] out=[$OUT]"
capture docker compose -f "$OLD_PLATFORM" up -d --no-deps auth-bff             # 旧 30：auth-bff 带 ports: 重建
[ "$RC" -eq 0 ] && [ "$(publishers_now)" = "vx-platform-auth-bff" ] && [ ! -e "$FX/authbff.down" ] && ok "回滚·旧 30：auth-bff 拿回 :8081（窗口结束），没撞口" || bad "回滚·旧 30：rc=$RC pub=[$(publishers_now)] out=[$OUT]"
echo "== 回滚的反例：只跑旧 30、不走 20 与 nginx up"
fixture rollback_30only
ctr vxture-nginx "${NGINX_BASE_ARGS[@]}" 203.0.113.1 8081 8081/tcp
ctr vx-platform-auth-bff
capture docker compose -f "$OLD_PLATFORM" up -d --no-deps auth-bff
[ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q "port is already allocated" && [ -e "$FX/authbff.down" ] && [ "$(publishers_now)" = "vxture-nginx" ] \
  && ok "反例：nginx 还发布着 :8081 时直接重建带 ports: 的 auth-bff → 撞口、auth-bff 下线（回滚必须走整条 31）" || bad "反例没红：rc=$RC down=$([ -e "$FX/authbff.down" ] && echo yes || echo no) out=[$OUT]"

# ── 7. 接线：机制在仓里真的接上了 ─────────────────────────────────────────────────────────
echo "== 接线"
grep -q 'lib/nginx-idp-port.sh' "$S20" && grep -qE '^idp_alias_sync "\$COMPOSE_SRC" "\$COMPOSE_DST"' "$S20" && ! grep -qE '^cp (-v )?"\$COMPOSE_SRC"' "$S20" \
  && ok "20-sync：source 了库、调 idp_alias_sync、不再裸 cp compose" || bad "20-sync 接线"
# 30：交接必须在 for 循环体内、紧跟 up -d --no-deps "$svc"、只对 auth-bff
check_30_wiring() { # check_30_wiring <30 脚本> → 0 接对 / 1 没接
  grep -q 'lib/nginx-idp-port.sh' "$1" || return 1
  awk '
    /^for svc in \$SERVICES; do/ { inloop = 1; next }
    inloop && /^done/            { inloop = 0 }
    inloop && /up -d --no-deps "\$svc"/ { seen_up = 1 }
    inloop && seen_up && /\[ "\$svc" = "auth-bff" \]/ { seen_cond = 1 }
    inloop && seen_cond && /idp_alias_handover "\$NGINX_COMPOSE_SRC" "\$NGINX_COMPOSE_FILE"/ { hit = 1 }
    END { exit !hit }
  ' "$1"
}
check_30_wiring "$S30" && ok "30-deploy：交接在逐服务循环体内、紧跟 up -d --no-deps、只对 auth-bff" || bad "30-deploy 接线"
grep -v 'idp_alias_handover' "$S30" > "$T/30-no-handover.sh"
check_30_wiring "$T/30-no-handover.sh" && bad "负例：删掉交接的 30 副本却绿" || ok "负例：删掉交接的 30 副本 → 红"
# 31：机制的前提是 20 → nginx up → 30 这个顺序
l20="$(grep -n '20-sync-nginx-config.sh' "$S31" | grep run_step | head -1 | cut -d: -f1)"
lup="$(grep -n 'NGINX_COMPOSE_FILE" up -d' "$S31" | head -1 | cut -d: -f1)"
l30="$(grep -n '30-deploy-platform-stack.sh' "$S31" | grep run_step | head -1 | cut -d: -f1)"
[ -n "$l20" ] && [ -n "$lup" ] && [ -n "$l30" ] && [ "$l20" -lt "$lup" ] && [ "$lup" -lt "$l30" ] \
  && ok "31：顺序仍是 20-sync（:$l20）→ nginx up -d（:$lup）→ 30-deploy（:$l30）——交接机制的前提" || bad "31 顺序变了：20=$l20 up=$lup 30=$l30（交接机制按此顺序设计，改序要重审）"
grep -q 'lib/nginx-idp-port.sh' "$S40" && grep -q 'check_tailnet_aliases' "$S40" && grep -q '/internal/operator/sessions' "$S40" && ok "40-verify：探 tailnet 别名（含 /internal/ → 404）" || bad "40-verify 接线"
grep -q 'lib/nginx-idp-port.sh' "$S51" && grep -q '^check_tailnet_alias_publisher$' "$S51" && ok "51-alerts：日巡检核 :8081 发布者" || bad "51-alerts 接线"
# 判据只许读结构化绑定：库里任何代码行都不得再读 Ports 列（第一版的坑）
grep -vE '^[[:space:]]*#' "$LIB_DIR/nginx-idp-port.sh" | grep -q '{{.Ports}}' && bad "库里有代码行读 docker ps 的 {{.Ports}} 列（折叠区间会让它瞎）" || ok "库：没有代码行读 {{.Ports}} 列；判据读 inspect 的 NetworkSettings.Ports"
grep -vE '^[[:space:]]*#' "$LIB_DIR/nginx-idp-port.sh" | grep -q 'NetworkSettings.Ports' && ok "库：判据读 inspect 的 NetworkSettings.Ports" || bad "库：没读 NetworkSettings.Ports"
if [ -f "$RUNBOOK" ]; then
  grep -q "grep ':8081->'" "$RUNBOOK" && bad "runbook 15 还在教人 grep ':8081->'（折叠形状下永远空）" || ok "runbook 15：不再教人 grep ':8081->'"
  grep -q 'docker port vxture-nginx 8081' "$RUNBOOK" && ok "runbook 15：用 docker port vxture-nginx 8081 看交接" || bad "runbook 15 缺 docker port vxture-nginx 8081"
  grep -qE '回滚' "$RUNBOOK" && ok "runbook 15：有回滚段" || bad "runbook 15 缺回滚段"
fi

# idp-internal.conf：路由面 + 写法约束（if / try_files / add_header 在 nginx 里会互相吃掉，禁用）
conf_body="$(grep -vE '^[[:space:]]*#' "$IDP_CONF")"
printf '%s\n' "$conf_body" | grep -qE '^\s*listen 8081;' && ok "idp-internal.conf：listen 8081" || bad "idp-internal.conf listen"
# 两个精确匹配 404 挡的是 nginx 的「前缀 location + proxy_pass 对去掉尾斜杠的请求回 301」（容器实测）。
for loc in 'location /oidc/ \{' 'location /\.well-known/ \{' 'location = /healthz \{' 'location / \{' 'location = /oidc \{' 'location = /\.well-known \{'; do
  printf '%s\n' "$conf_body" | grep -qE "^\s*$loc" && ok "idp-internal.conf：$loc" || bad "idp-internal.conf 缺 $loc"
done
[ "$(printf '%s\n' "$conf_body" | grep -c 'proxy_pass')" = "3" ] && ok "idp-internal.conf：恰三处 proxy_pass（三组放行路径）" || bad "idp-internal.conf proxy_pass 数：$(printf '%s\n' "$conf_body" | grep -c 'proxy_pass')"
printf '%s\n' "$conf_body" | grep -q 'return 404' && ok "idp-internal.conf：其余 return 404" || bad "idp-internal.conf 没有 return 404"
printf '%s\n' "$conf_body" | grep -qE '^\s*(if \(|try_files|add_header)' && bad "idp-internal.conf 用了 if / try_files / add_header" || ok "idp-internal.conf：没有 if / try_files / add_header"
printf '%s\n' "$conf_body" | grep -q 'internal' && bad "idp-internal.conf 的配置体里出现了 internal 路径（应由 location / 兜底 404，不单列）" || ok "idp-internal.conf：/internal/ 不单列，由 location / 的 404 兜底"
grep -qE '^\s*8081\s+"";' "$HARDENING" && ok "00-hardening：:8081 像 :8080 一样免限速（worker-02 全部产品一个来源 IP）" || bad "00-hardening 缺 8081 豁免"
! grep -vE '^\s*#' "$PLATFORM" | grep -q ':8081:' && ok "compose.platform.yml：不再发布 :8081（auth-bff 无宿主口）" || bad "compose.platform.yml 仍发布 :8081"
! grep -vE '^\s*#' "$PLATFORM" | awk '/^  auth-bff:/{f=1} /^  [a-z]/{if($0!~/^  auth-bff:/)f=0} f' | grep -q '^    ports:' && ok "compose.platform.yml：auth-bff 没有 ports: 段" || bad "auth-bff 仍有 ports:"

if [ "$fail" -eq 0 ]; then
  echo "nginx-idp-port.test: 全部通过"
else
  echo "nginx-idp-port.test: 有失败" >&2
  exit 1
fi
