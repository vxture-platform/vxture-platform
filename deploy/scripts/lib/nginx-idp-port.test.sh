#!/usr/bin/env bash
# deploy/scripts/lib/nginx-idp-port.test.sh
# tailnet :8081 从 auth-bff 直通交接给 nginx 别名的离线证明。PATH 上放一个假 docker + 假 ss，
# 让 20-sync 的 idp_alias_sync 与 30-deploy 的 idp_alias_handover **真跑**，按 31 的真实顺序
# （20-sync → nginx `up -d` → 30 逐服务 `up -d --no-deps`）走两种主机现场，断言的是假 docker
# 记录下来的宿主口状态与调用序列，不是读源码判断。
#   · 切换中的主机（auth-bff 还直接发布 :8081）：20 延后、31 不重建 nginx、30 在 auth-bff 之后
#     一次交接；nginx 一次都没掉；第二次 deploy 一个动作都不多（幂等）
#   · 新主机（空）：20 直接落终态，31 第一次 `up -d` 就带 :8081，30 的交接是无变化
#   · 失败控制组：把 20-sync 换回裸 cp（改动前的行为）→ 假 docker 报 port is already allocated、
#     nginx 下线——证明碰撞是真的、假 docker 看得见它
#   · 响亮失败：别的容器占着 / 宿主进程在听 / auth-bff 重建后仍占着 / docker ps 坏了 / up -d 后
#     nginx 没接上 / 没同步过 nginx → 都是非零退出，且**一个 compose 动作都没做**
#   · 纯函数：Ports 列解析（:18081-> 与容器侧 ->8081 都不算）、五格分类、渲染（标记 0 行 / 2 行拒绝）
#   · 接线：20-sync 不再裸 cp、30-deploy 的交接紧跟 auth-bff 的 up -d、31 的顺序仍是 20 → nginx up → 30、
#     idp-internal.conf 的路由面与写法约束、00-hardening 的 8081 豁免、compose.platform.yml 不再发布 :8081；
#     负例喂一份删掉交接的 30 副本
# 运行：bash deploy/scripts/lib/nginx-idp-port.test.sh
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

# ── 0. 纯函数 ─────────────────────────────────────────────────────────────────────────
echo "== 纯函数"
PS_NGINX_BASE='0.0.0.0:80->80/tcp, [::]:80->80/tcp, 0.0.0.0:443->443/tcp, [::]:443->443/tcp, 203.0.113.1:8080->8080/tcp'
PS_NGINX_FULL="$PS_NGINX_BASE, 203.0.113.1:8081->8081/tcp"
ps_mid="$(printf 'vxture-nginx\t%s\nvx-platform-auth-bff\t203.0.113.1:8081->3081/tcp\nother\t127.0.0.1:18081->80/tcp\nweird\t0.0.0.0:9000->8081/tcp\nvx-platform-website\t\n' "$PS_NGINX_BASE")"
[ "$(idp_alias_publishers_from_ps "$ps_mid")" = "vx-platform-auth-bff" ] && ok "Ports 列解析：只有 :8081-> 算（:18081-> 与容器侧 ->8081 不算，无端口的行不算）" || bad "Ports 列解析：[$(idp_alias_publishers_from_ps "$ps_mid")]"
ps_two="$(printf 'vxture-nginx\t%s\nvx-platform-auth-bff\t203.0.113.1:8081->3081/tcp\n' "$PS_NGINX_FULL")"
[ "$(idp_alias_publishers_from_ps "$ps_two" | tr '\n' ' ')" = "vxture-nginx vx-platform-auth-bff " ] && ok "两个发布者都列出、按输入顺序" || bad "两个发布者：[$(idp_alias_publishers_from_ps "$ps_two" | tr '\n' ' ')]"
[ -z "$(idp_alias_publishers_from_ps "")" ] && ok "空输入 → 空" || bad "空输入"

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

# ── 1. 假 docker / 假 ss ───────────────────────────────────────────────────────────────
# 夹具目录 $FX：
#   ps.txt            当前 `docker ps --format '{{.Names}}\t{{.Ports}}'` 会吐的内容（宿主口状态的唯一真值）
#   ss.txt            当前 `ss -ltnH …` 会吐的内容
#   calls.log         每次 docker 调用的 argv
#   nginx.recreates / nginx.creates   计数
#   nginx.down        nginx 起不来时留下（compose 先停旧再起新：新的失败，旧的已经没了）
# `compose -f <file> up -d`：
#   nginx 项目（文件里有 container_name: vxture-nginx）：文件要不要发布 :8081 与现场比——要发布而现场
#   别的容器占着 → 报 port is already allocated、nginx 下线、exit 1；要发布且空着 → 重建（或首次创建）
#   带上 8081；不要发布而现场带着 → 重建去掉；其余无变化。FAKE_NGINX_IGNORE_8081=1 时假装起来了但没发布
#   （模拟 up -d 绿、口却没接上）。
#   平台项目 `up -d --no-deps <svc>`：auth-bff → 新 compose 没 ports，重建后那一行不再带任何宿主口；
#   其余服务无变化。
cat > "$T/bin/docker" <<'EOF'
#!/usr/bin/env bash
D="${FAKE_DOCKER_DIR:?}"
printf '%s\n' "$*" >> "$D/calls.log"
NGINX_BASE='0.0.0.0:80->80/tcp, [::]:80->80/tcp, 0.0.0.0:443->443/tcp, [::]:443->443/tcp, 203.0.113.1:8080->8080/tcp'
set_line() { # set_line <name> <ports>
  local name="$1" ports="$2" tmp="$D/ps.tmp"
  awk -F'\t' -v OFS='\t' -v n="$name" '$1 != n' "$D/ps.txt" > "$tmp"
  printf '%s\t%s\n' "$name" "$ports" >> "$tmp"
  mv "$tmp" "$D/ps.txt"
}
has_line() { awk -F'\t' -v n="$1" '$1 == n { found = 1 } END { exit !found }' "$D/ps.txt"; }
case "${1:-}" in
  ps)
    [ -n "${FAKE_DOCKER_PS_FAIL:-}" ] && { echo "Cannot connect to the Docker daemon" >&2; exit 1; }
    cat "$D/ps.txt"
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
      want=0; grep -q ':8081:8081' "$file" && want=1
      has=0; awk -F'\t' '$1 == "vxture-nginx" && index($2, ":8081->") > 0 { f = 1 } END { exit !f }' "$D/ps.txt" && has=1
      exists=0; has_line vxture-nginx && exists=1
      if [ "$want" = 1 ] && [ "$has" = 0 ]; then
        if awk -F'\t' '$1 != "vxture-nginx" && index($2, ":8081->") > 0 { f = 1 } END { exit !f }' "$D/ps.txt"; then
          echo "Error response from daemon: driver failed programming external connectivity on endpoint vxture-nginx: Bind for 203.0.113.1:8081 failed: port is already allocated" >&2
          awk -F'\t' '$1 != "vxture-nginx"' "$D/ps.txt" > "$D/ps.tmp" && mv "$D/ps.tmp" "$D/ps.txt"
          touch "$D/nginx.down"
          exit 1
        fi
        if [ -n "${FAKE_NGINX_IGNORE_8081:-}" ]; then
          set_line vxture-nginx "$NGINX_BASE"
        else
          set_line vxture-nginx "$NGINX_BASE, 203.0.113.1:8081->8081/tcp"
        fi
        if [ "$exists" = 1 ]; then echo 1 >> "$D/nginx.recreates"; echo " Container vxture-nginx Recreated"; else echo 1 >> "$D/nginx.creates"; echo " Container vxture-nginx Created"; fi
      elif [ "$want" = 0 ] && [ "$has" = 1 ]; then
        set_line vxture-nginx "$NGINX_BASE"
        echo 1 >> "$D/nginx.recreates"; echo " Container vxture-nginx Recreated"
      elif [ "$exists" = 0 ]; then
        set_line vxture-nginx "$NGINX_BASE"
        echo 1 >> "$D/nginx.creates"; echo " Container vxture-nginx Created"
      else
        echo " Container vxture-nginx Running"
      fi
      exit 0
    fi
    # 平台项目
    svc="${args[${#args[@]}-1]}"
    case "$svc" in
      auth-bff) set_line vx-platform-auth-bff ""; echo " Container vx-platform-auth-bff Recreated" ;;
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
  FX="$T/fx/$1"; rm -rf "$FX"; mkdir -p "$FX/host/nginx"; : > "$FX/ps.txt"; : > "$FX/ss.txt"; : > "$FX/calls.log"
  export FAKE_DOCKER_DIR="$FX"
  DST="$FX/host/nginx/compose.yml"
}
ps_add() { printf '%s\t%s\n' "$1" "$2" >> "$FX/ps.txt"; }
publishers_now() { idp_alias_publishers | tr '\n' ' ' | sed 's/ $//'; }
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

# ── 2. 切换中的主机：按 31 的顺序走一遍，再走一遍 ──────────────────────────────────────────
echo "== 现场 A：切换中的主机（auth-bff 还直接发布 :8081）"
fixture mid
ps_add vxture-nginx "$PS_NGINX_BASE"
ps_add vx-platform-auth-bff "203.0.113.1:8081->3081/tcp"
ps_add vx-platform-admin-bff ""
ps_add vx-platform-website ""
echo "LISTEN 0 4096 203.0.113.1:8081 0.0.0.0:* users:((\"docker-proxy\",pid=1,fd=4))" > "$FX/ss.txt"

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
capture idp_alias_sync "$SRC" "$DST"
[ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q "已交接" && cmp -s "$SRC" "$DST" && ok "A'·20-sync：判到已交接、落终态" || bad "A'·20-sync：rc=$RC out=[$OUT]"
capture docker compose -f "$DST" up -d
[ "$RC" -eq 0 ] && [ "$(count nginx.recreates)" = "1" ] && ok "A'·31 nginx up -d：无变化（累计重建仍是 1）" || bad "A'·31：rc=$RC recreates=$(count nginx.recreates)"
capture run_30_loop
[ "$RC" -eq 0 ] && [ "$(count nginx.recreates)" = "1" ] && [ "$(publishers_now)" = "vxture-nginx" ] && ok "A'·30：交接判到已占、up -d 无变化、发布者不变" || bad "A'·30：rc=$RC recreates=$(count nginx.recreates) pub=[$(publishers_now)] out=[$OUT]"

echo "== 失败控制组：改动前的 20-sync 是裸 cp"
fixture naive
ps_add vxture-nginx "$PS_NGINX_BASE"
ps_add vx-platform-auth-bff "203.0.113.1:8081->3081/tcp"
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
ps_add vxture-nginx "$PS_NGINX_BASE"
ps_add rogue "203.0.113.1:8081->8081/tcp"
capture idp_alias_sync "$SRC" "$DST"
[ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q "rogue" && [ ! -e "$DST" ] && ok "别的容器占着 → 20-sync 非零、点名 rogue、不落 compose" || bad "rogue·sync：rc=$RC dst=$([ -e "$DST" ] && echo yes || echo no) out=[$OUT]"
capture idp_alias_handover "$SRC" "$DST"
[ "$RC" -ne 0 ] && [ "$(compose_calls)" = "0" ] && ok "别的容器占着 → 交接非零、零 compose 动作" || bad "rogue·handover：rc=$RC compose=$(compose_calls)"

fixture hostproc
ps_add vxture-nginx "$PS_NGINX_BASE"
echo "LISTEN 0 128 203.0.113.1:8081 0.0.0.0:* users:((\"python3\",pid=4242,fd=3))" > "$FX/ss.txt"
capture idp_alias_sync "$SRC" "$DST"
[ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q "ss" && [ ! -e "$DST" ] && ok "宿主进程在听 → 20-sync 非零、提到 ss、不落 compose" || bad "hostproc·sync：rc=$RC out=[$OUT]"
capture idp_alias_handover "$SRC" "$DST"
[ "$RC" -ne 0 ] && [ "$(compose_calls)" = "0" ] && ok "宿主进程在听 → 交接非零、零 compose 动作" || bad "hostproc·handover：rc=$RC compose=$(compose_calls)"

fixture stale
ps_add vxture-nginx "$PS_NGINX_BASE"
ps_add vx-platform-auth-bff "203.0.113.1:8081->3081/tcp"
capture idp_alias_handover "$SRC" "$DST"
[ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q "仍由" && [ "$(compose_calls)" = "0" ] && [ ! -e "$DST" ] \
  && ok "auth-bff 重建后仍占着（主机 compose.platform.yml 过旧）→ 交接非零、零 compose 动作、不落 compose" || bad "stale：rc=$RC compose=$(compose_calls) out=[$OUT]"

fixture psfail
capture env FAKE_DOCKER_PS_FAIL=1 bash -c '. "$0"; idp_alias_sync "$1" "$2"' "$LIB_DIR/nginx-idp-port.sh" "$SRC" "$DST"
[ "$RC" -ne 0 ] && [ ! -e "$DST" ] && ok "docker ps 坏了 → 20-sync 非零、不落 compose（不能判就不判）" || bad "psfail：rc=$RC out=[$OUT]"

fixture ignored
ps_add vxture-nginx "$PS_NGINX_BASE"
capture env FAKE_NGINX_IGNORE_8081=1 bash -c '. "$0"; idp_alias_handover "$1" "$2"' "$LIB_DIR/nginx-idp-port.sh" "$SRC" "$DST"
[ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q "交接后" && ok "up -d 绿了但 nginx 没发布 :8081 → 交接非零（成功信号也要验）" || bad "ignored：rc=$RC out=[$OUT]"

fixture nodir
rm -rf "$FX/host"
capture idp_alias_handover "$SRC" "$DST"
[ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q "20-sync" && [ "$(compose_calls)" = "0" ] && ok "nginx 从没同步过 → 交接非零、指向 20-sync" || bad "nodir：rc=$RC out=[$OUT]"

# ── 5. 接线：机制在仓里真的接上了 ─────────────────────────────────────────────────────────
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
