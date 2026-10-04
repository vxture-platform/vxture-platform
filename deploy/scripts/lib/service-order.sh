#!/usr/bin/env bash
# deploy/scripts/lib/service-order.sh
# 30-deploy 第 [4/4] 步的服务重建顺序：共享内部面钥匙的四个服务先、相邻，其余按原序。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
#
# 为什么要有这个文件（2026-10-04，内部面口令拆分）：
# `docker compose config --services` 的顺序不是 YAML 顺序，而且不稳定——同一份 compose
# 本机 v5.5.1 连跑三次给出三种序。auth-bff（收）与 admin / arche / opera-bff（发）之间有一把
# 共享钥匙 IDP_INTERNAL_TOKEN；换钥匙那一版里，先换收方则旧发方送旧值 401，先换发方则新发方
# 把新值送给旧收方 401。窗口 = 四个里**第一个**被重建到**最后一个**被重建之间——随机序下最坏
# 就是整次部署。把四个排到最前、相邻重建，窗口就是四次串行重建。
#
# 纯文本函数、零依赖，可被 service-order.test.sh 直接喂三种乱序验证。
set -o pipefail

# 内部面的四个服务，按「收方先、发方后」排：auth-bff 换好之后，三个发方逐个跟上。
# 这个方向是为换钥匙选的：两头都会 401，先后无所谓，只求相邻。对「收方新增一个必填头」的
# 改动（2026-10-04 PR C 的 x-vxture-actor-token）它是**更差**的方向——新收方在等头、旧发方还不送，
# 发方先才是零窗口。接受下来，不改：窗口 = admin-bff、arche-bff 两次重建，账号动作 503
# operator_admin_unavailable、auth-bff 日志 actor_token_missing；症状与自愈写在
# docs/50-deployment/15-idp-internal-token-cutover.md §8 末条。同类改动下次可把发方那一半先一个 tag。
INTERNAL_FACE_SERVICES="auth-bff admin-bff arche-bff opera-bff"

# order_services_internal_face_first "<whitespace-separated services>"
# 输出：一行一个服务名。内部面四个（只含输入里确实存在的）先、按上面的固定序；其余按输入
# 原序跟在后面；不去重以外不改任何东西（输入没有的不会凭空出现，输入有的一个不少）。
order_services_internal_face_first() {
  local services="$1"
  local f s
  for f in $INTERNAL_FACE_SERVICES; do
    for s in $services; do
      if [ "$s" = "$f" ]; then
        printf '%s\n' "$f"
        break
      fi
    done
  done
  for s in $services; do
    case " $INTERNAL_FACE_SERVICES " in
      *" $s "*) continue ;;
    esac
    printf '%s\n' "$s"
  done
}
