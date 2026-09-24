#!/usr/bin/env bash
# deploy/scripts/lib/site-takeover.test.sh
# 纯文本单测：takeover_resolve 的合并与拒绝，takeover_render_map 的输出形状。
# 运行：bash deploy/scripts/lib/site-takeover.test.sh
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-09-24
set -uo pipefail
. "$(cd "$(dirname "$0")" && pwd)/site-takeover.sh"

fail=0
assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "ok   - $name"
  else
    echo "FAIL - $name" >&2
    echo "  expected: $(printf '%s' "$expected" | tr '\n' '|')" >&2
    echo "  actual:   $(printf '%s' "$actual" | tr '\n' '|')" >&2
    fail=1
  fi
}
assert_rejects() {
  local name="$1" defaults="$2" state="${3:-}"
  if out="$(takeover_resolve "$defaults" "$state" 2>/dev/null)"; then
    echo "FAIL - $name（应当拒绝，却输出了：$(printf '%s' "$out" | tr '\n' '|')）" >&2
    fail=1
  else
    echo "ok   - $name"
  fi
}

DEFAULTS="$(
  cat <<'TXT'
# 注释行
vxture.com  off

ruyin.work  portal   # 行尾注释
TXT
)"

# ── 没有现场档位时，默认就是答案（新机、或从没切过档）────────────────────────
assert_eq "默认档位：注释/空行/行尾注释都不算数据" \
  "vxture.com off
ruyin.work portal" \
  "$(takeover_resolve "$DEFAULTS" "")"

# ── 现场逐域覆盖，没被提到的域保持默认 ───────────────────────────────────────
assert_eq "现场覆盖一个域，另一个不动" \
  "vxture.com maintenance
ruyin.work portal" \
  "$(takeover_resolve "$DEFAULTS" "vxture.com maintenance")"

assert_eq "现场把门户域也切成维护" \
  "vxture.com off
ruyin.work maintenance" \
  "$(takeover_resolve "$DEFAULTS" "
# 维护窗口
ruyin.work   maintenance
")"

# ── 输出顺序跟默认文件走，与现场文件的行序无关（map 的可读性靠这一条）────────
assert_eq "输出顺序由默认文件决定" \
  "vxture.com portal
ruyin.work off" \
  "$(takeover_resolve "$DEFAULTS" "ruyin.work off
vxture.com portal")"

# ── 拒绝的四种：这些若被宽容放过，症状都不是报错而是「改了没生效」──────────
assert_rejects "档位不在三档之内（默认文件）" "vxture.com paused"
assert_rejects "档位不在三档之内（现场文件）" "$DEFAULTS" "vxture.com paused"
assert_rejects "现场登记了默认文件没有的域（最常见的是拼错）" "$DEFAULTS" "vxtrue.com off"
assert_rejects "默认文件里同一个域写了两遍" "vxture.com off
vxture.com portal"
assert_rejects "一行多出第三列" "vxture.com off 还有别的"
assert_rejects "默认文件一条数据都没有" "# 只有注释"
assert_rejects "域名写了但没写档位" "vxture.com"

# ── 退役一个域：现场状态还留着它 ─────────────────────────────────────────────
# 这两条是同一个输入的两种正确答案，按调用方分：
#   · 35-site-takeover.sh（人在敲命令）→ 拒绝，因为那只可能是敲错了；
#   · 20-sync-nginx-config.sh（deploy 路径）→ 丢弃，因为「把一个域从登记表里摘掉」是正常
#     的仓内改动，而报错会让整次 deploy 失败（那个脚本 set -e），等于这件事做不成。
assert_eq "prune：退役的域从现场状态里丢掉，其余不动" \
  "vxture.com portal" \
  "$(takeover_resolve "vxture.com off" "vxture.com portal
ruyin.work portal" prune)"

assert_rejects "reject（默认）：现场有登记表没有的域就拦下" \
  "vxture.com off" "vxture.com portal
ruyin.work portal"

assert_eq "prune 不改变合法行的处理" \
  "vxture.com maintenance" \
  "$(takeover_resolve "vxture.com off" "vxture.com maintenance" prune)"

# ── map 的输出形状：nginx map include 的数据行是 `key value;` ────────────────
tmp="$(mktemp)"
takeover_render_map "vxture.com off
ruyin.work portal" "$tmp"
assert_eq "渲出的 map 数据行" \
  'vxture.com "off";
ruyin.work "portal";' \
  "$(grep -v '^#' "$tmp" | grep -v '^$')"
assert_eq "渲出的 map 带出处说明（免得被当成可手改的文件）" \
  "2" \
  "$(grep -c '^#' "$tmp")"
rm -f "$tmp"

# ── off 不能有页：有了它，「不接管」也会把正常站点顶掉 ───────────────────────
src="$(mktemp -d)"; dst="$(mktemp -d)"
mkdir -p "$src/$TAKEOVER_HTML_SUBDIR"
printf 'x' >"$src/$TAKEOVER_HTML_SUBDIR/portal.html"
printf 'x' >"$src/$TAKEOVER_HTML_SUBDIR/off.html"
if takeover_sync_pages "$src" "$dst" "vxture.com off" >/dev/null 2>&1; then
  echo "FAIL - off.html 存在时应当拒绝" >&2; fail=1
else
  echo "ok   - off.html 存在时拒绝投放"
fi
rm -f "$src/$TAKEOVER_HTML_SUBDIR/off.html"

# ── 在用的档位缺页：断言必须在 reload 之前炸 ─────────────────────────────────
if takeover_sync_pages "$src" "$dst" "vxture.com maintenance" >/dev/null 2>&1; then
  echo "FAIL - 档位是 maintenance 而缺 maintenance.html 时应当拒绝" >&2; fail=1
else
  echo "ok   - 在用档位缺页时拒绝（拦在 reload 之前）"
fi

printf 'x' >"$src/$TAKEOVER_HTML_SUBDIR/maintenance.html"
if takeover_sync_pages "$src" "$dst" "vxture.com maintenance
ruyin.work portal" >/dev/null 2>&1; then
  assert_eq "两张页都投放到位" "maintenance.html portal.html" \
    "$(ls "$dst/$TAKEOVER_HTML_SUBDIR" | sort | tr '\n' ' ' | sed 's/ $//')"
else
  echo "FAIL - 页齐时不该拒绝" >&2; fail=1
fi
# ── 目录不重建：重建会把归属重置成当次运行者，而这个目录有两个身份不同的写者 ─────
# deploy 以部署用户跑、35-site-takeover.sh 以 root 跑。root 建过一次，下一次 deploy
# 连 unlink 里面的文件都做不到（unlink 看目录的写权限，不看文件归属）——v0.26.263 的
# 生产 deploy 实际因此失败。归属本身在非 root 的测试里造不出来，**inode 不变**是
# 「没重建」的可测形式，而它恰好就是那条被违反的性质。
ino_before="$(stat -c %i "$dst/$TAKEOVER_HTML_SUBDIR")"
printf 'stale' >"$dst/$TAKEOVER_HTML_SUBDIR/stale.html"
if takeover_sync_pages "$src" "$dst" "vxture.com maintenance" >/dev/null 2>&1; then
  assert_eq "同步不重建目标目录（inode 不变）" \
    "$ino_before" "$(stat -c %i "$dst/$TAKEOVER_HTML_SUBDIR")"
  assert_eq "目录内容照旧清干净（上一版遗留的页不留下）" \
    "maintenance.html portal.html" \
    "$(ls "$dst/$TAKEOVER_HTML_SUBDIR" | sort | tr '\n' ' ' | sed 's/ $//')"
else
  echo "FAIL - 目标目录已存在时不该拒绝" >&2; fail=1
fi

rm -rf "$src" "$dst"

echo ""
if [ "$fail" -eq 0 ]; then
  echo "site-takeover：全部通过"
else
  echo "site-takeover：有失败项" >&2
fi
exit "$fail"
