#!/usr/bin/env bash
# deploy/scripts/lib/service-order.test.sh
# 30-deploy 第 [4/4] 步的顺序钉死：不管 `config --services` 吐什么序，内部面四个都排最前、
# 相邻、固定序；其余按原序、一个不少、一个不多。
# 运行：bash deploy/scripts/lib/service-order.test.sh
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-10-04
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/service-order.sh"

fail=0
ok()  { echo "ok   - $1"; }
bad() { echo "FAIL - $1" >&2; fail=1; }

# 三种乱序是 2026-10-04 本机 Compose v5.5.1 对同一份 compose.platform.yml 真跑出来的
# （见 docs/50-deployment/15-idp-internal-token-cutover.md）。第三种里 opera-bff 排在最后：
# 不钉顺序时窗口就是整次部署。
ORDER_1="auth-bff admin-bff arche-bff console-bff opera opera-bff platform-api website accounts admin arche console gateway-bff website-bff"
ORDER_2="auth-bff platform-api website accounts admin-bff console-bff opera-bff website-bff admin arche arche-bff console gateway-bff opera"
ORDER_3="auth-bff website-bff admin arche-bff console console-bff platform-api website accounts admin-bff arche gateway-bff opera opera-bff"
# 第四种：auth-bff 不在第 1 位（审查者的三次里它出现过第 4 位）。
ORDER_4="website console admin auth-bff opera-bff accounts arche-bff gateway-bff admin-bff website-bff console-bff platform-api arche opera"

EXPECT_HEAD="auth-bff admin-bff arche-bff opera-bff"

check_order() {
  local label="$1" input="$2"
  local out head rest expected_rest
  out="$(order_services_internal_face_first "$input")"

  head="$(printf '%s\n' "$out" | head -n 4 | tr '\n' ' ' | sed 's/ $//')"
  [ "$head" = "$EXPECT_HEAD" ] && ok "$label: 前四个 = [$EXPECT_HEAD]" || bad "$label: 前四个 = [$head]"

  # 其余按输入原序
  rest="$(printf '%s\n' "$out" | tail -n +5 | tr '\n' ' ' | sed 's/ $//')"
  expected_rest="$(for s in $input; do case " $EXPECT_HEAD " in *" $s "*) ;; *) printf '%s ' "$s" ;; esac; done | sed 's/ $//')"
  [ "$rest" = "$expected_rest" ] && ok "$label: 其余按原序" || bad "$label: 其余 = [$rest] want [$expected_rest]"

  # 一个不少、一个不多（排序后集合相等）
  local in_sorted out_sorted
  in_sorted="$(printf '%s\n' $input | sort | tr '\n' ' ')"
  out_sorted="$(printf '%s\n' "$out" | sort | tr '\n' ' ')"
  [ "$in_sorted" = "$out_sorted" ] && ok "$label: 集合不变（$(printf '%s\n' $input | wc -l | tr -d ' ') 个）" || bad "$label: 集合变了"
}

check_order "乱序一" "$ORDER_1"
check_order "乱序二" "$ORDER_2"
check_order "乱序三（opera-bff 在末位）" "$ORDER_3"
check_order "乱序四（auth-bff 不在首位）" "$ORDER_4"

# 反例：不钉顺序时，乱序三的 opera-bff 确实在第 14 位——这条证明钉死不是空操作。
pos="$(printf '%s\n' $ORDER_3 | grep -n '^opera-bff$' | cut -d: -f1)"
[ "$pos" = "14" ] && ok "对照组：乱序三里 opera-bff 原本在第 $pos 位（窗口 = 整次部署）" || bad "对照组失真：opera-bff 在第 $pos 位"

# 四个里缺一个（将来某个服务退役）：只排在场的，不凭空造。
out="$(order_services_internal_face_first "website arche-bff console auth-bff admin-bff")"
[ "$(printf '%s\n' "$out" | tr '\n' ' ')" = "auth-bff admin-bff arche-bff website console " ] && ok "缺 opera-bff 时只排在场的三个" || bad "缺员处理：$(printf '%s\n' "$out" | tr '\n' ' ')"

# 空输入 → 空输出（不炸）。
[ -z "$(order_services_internal_face_first "")" ] && ok "空输入 → 空输出" || bad "空输入"

# 输出可被 `for svc in $SERVICES` 原样消费（每行一个、无多余字符）。
n="$(order_services_internal_face_first "$ORDER_1" | wc -l | tr -d ' ')"
[ "$n" = "14" ] && ok "14 行、可被 for 循环按词消费" || bad "行数 $n"

exit $fail
