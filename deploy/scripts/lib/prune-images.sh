#!/usr/bin/env bash
# deploy/scripts/lib/prune-images.sh
# 选出可回收的平台镜像:本平台命名空间(platform_*)下、没有任何容器(含已停止的)在引用的镜像。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-08-29
#
# 为什么不再用 `docker image prune -af`(2026-08-29 从 v0.26.1 / v0.26.2 两次部署
# 的时间线里查出来的):
#
#   `-a` 会删掉**所有**没有容器引用的镜像,包括 21-prepare 用来跑 `select 1` 的
#   `postgres:18-alpine`——平台库在 RDS,主机上没有 postgres 容器,它必然"未引用"。
#   于是每次部署都要从 Docker Hub 重新拉一遍这个工具镜像,只为一句 `select 1`:
#   v0.26.0 花 78 秒,v0.26.1 花 6 分钟,v0.26.2 花 5 分 14 秒;Docker Hub 抽风时
#   就是无限期挂,而且这段时间落在部署链**最前面**,整栈还没开始动。
#
# 为什么按**镜像 ID** 比对而不是 repo:tag(2026-09-05 worker-01 根盘 100% 撑满时查出来的):
#
#   发版改成按摘要拉取(#112 digest-pin)之后,拉下来的镜像**没有 tag**——`docker images`
#   里全是 `<none>`。旧逻辑按 `repo:tag` 挑、又把 `<none>` 交给 `docker image prune -f`;
#   可 Docker 不把"有摘要引用的无标签镜像"当悬空(实测 dangling=0),于是两边都不管,
#   每次部署都打印「没有可回收的平台旧镜像」,366 个版本堆满 40 GB。
#   容器对镜像的引用有三种形态(tag / repo@digest / 短 ID),统一解析成全长镜像 ID
#   再比对,形态就无关了。工具镜像、别人的镜像仍然一律不碰。
#
# 这个函数是纯文本过滤,不碰 docker,所以能在本地用假清单测(见同目录的 .test.sh)。
#
# 用法:
#   select_stale_platform_images <in-use-ids-file>  < <images-list>
#     images-list:`docker images --no-trunc --format '{{.Repository}} {{.ID}}'` 的输出
#     in-use-ids-file:`docker ps -aq | xargs -r docker inspect --format '{{.Image}}'`
#                     的输出(每行一个全长 ID,`sha256:…`)
#   输出:每行一个可 `docker rmi` 的镜像 ID(去重)

select_stale_platform_images() {
  local inuse_file="$1"

  # 在用清单为空意味着 docker ps 没跑成——那时任何删除都可能删到正在用的,宁可不删。
  if [ ! -s "$inuse_file" ]; then
    echo "select_stale_platform_images: in-use list is empty; refusing to select anything" >&2
    return 0
  fi

  awk -v inuse_file="$inuse_file" '
    BEGIN {
      while ((getline line < inuse_file) > 0) {
        if (line != "") used[line] = 1
      }
      close(inuse_file)
    }
    # 只认本平台命名空间(仓库名以 /platform_xxx 结尾,不管有没有 tag);
    # 同一个 ID 可能因多个 tag 出现多行,只报一次。
    $1 ~ /\/platform_[a-z-]+$/ && $2 != "" && !($2 in used) && !seen[$2]++ { print $2 }
  '
}
