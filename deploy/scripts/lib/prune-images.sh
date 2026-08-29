#!/usr/bin/env bash
# deploy/scripts/lib/prune-images.sh
# 选出可回收的平台镜像：旧版本的 platform_* 镜像，且没有任何容器（含已停止的）在引用。
# @package  @vxture/repo
# @layer    Infrastructure
# @category deployment-script
# @author   AI-Generated
# @date     2026-08-29
#
# 为什么不再用 `docker image prune -af`（2026-08-29 从 v0.26.1 / v0.26.2 两次部署
# 的时间线里查出来的）：
#
#   `-a` 会删掉**所有**没有容器引用的镜像，包括 21-prepare 用来跑 `select 1` 的
#   `postgres:18-alpine`——平台库在 RDS，主机上没有 postgres 容器，它必然"未引用"。
#   于是每次部署都要从 Docker Hub 重新拉一遍这个工具镜像，只为一句 `select 1`：
#   v0.26.0 花 78 秒，v0.26.1 花 6 分钟，v0.26.2 花 5 分 14 秒；Docker Hub 抽风时
#   就是无限期挂，而且这段时间落在部署链**最前面**，整栈还没开始动。
#
#   步骤 41 的目的只有一个：别让根盘随每次部署累积撑满。真正会累积的是本平台
#   12 个镜像的旧版本，所以只回收它们——按命名空间 `platform_*` 挑、跳过当前 tag、
#   跳过任何容器在引用的。工具镜像、别人的镜像一律不碰。
#
# 这个函数是纯文本过滤，不碰 docker，所以能在本地用假清单测（见同目录的 .test.sh）。
#
# 用法：
#   select_stale_platform_images <keep_tag> <in-use-list-file>  < <images-list>
#     images-list：`docker images --format '{{.Repository}}:{{.Tag}}'` 的输出
#     in-use-list-file：`docker ps -a --format '{{.Image}}'` 的输出（每行一个引用）
#   输出：每行一个可 `docker rmi` 的 repository:tag

select_stale_platform_images() {
  local keep_tag="$1"
  local inuse_file="$2"

  # keep_tag 为空意味着"当前版本未知"——那时任何删除都可能删到正在用的，宁可不删。
  if [ -z "$keep_tag" ]; then
    echo "select_stale_platform_images: keep_tag is empty; refusing to select anything" >&2
    return 0
  fi

  awk -v keep=":${keep_tag}" -v inuse_file="$inuse_file" '
    BEGIN {
      while ((getline line < inuse_file) > 0) {
        if (line != "") used[line] = 1
      }
      close(inuse_file)
    }
    # 只认本平台命名空间；<none> 由 `docker image prune -f`（不带 -a）负责。
    /\/platform_[a-z-]+:/ && $0 !~ /:<none>$/ && substr($0, length($0) - length(keep) + 1) != keep && !($0 in used) { print }
  '
}
