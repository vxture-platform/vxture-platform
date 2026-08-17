"use client";

/* LegacyRedirect — 2026-08-14 目录重构（`docs/opera-navigation-design.md` §3）留下的
 * 旧路径兜底。
 *
 * 这一批把 `/atlas/*` `/runos/*` `/observability/*` `/products` `/security/*` 全部换成
 * 按**管理域**命名的 `/model/*` `/capability/*` `/product/*` `/ops/*` `/audit/*`。改名
 * 的理由在设计文件 §1，这里只解决后果：旧路径散落在运营者书签、issue 正文、跨页链接
 * 和外部文档里，删掉就是 404。
 *
 * **整串查询参数原样带过去**，不逐个列举。旧深链带的是 `?providerId=` `?modelCode=`
 * `?endpointCode=` 这些"落地后展开哪一行/过滤成什么"的状态——逐个白名单迁移一定会漏，
 * 而漏掉的表现是"跳过去了但看到的是全量列表"，比 404 更难发现。
 *
 * 页面仍然渲染一屏说明而不是静默 `replace`：运营者需要知道自己收藏的地址已经变了，
 * 否则下次还从旧地址进。 */

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { EmptyState, ViewLayout, type IconName } from "@vxture/design-system";

export interface LegacyRedirectProps {
  /**
   * 新路径。**可以自带查询串**（如 `/audit/changes?source=atlas`）——旧页并进新页的
   * 某一个 tab 时需要它。自带的部分与继承来的部分用 `&` 合，不是简单拼接：拼接会
   * 产出 `?source=atlas?providerId=x` 这种第二个 `?` 之后全被当成值的地址。
   */
  to: string;
  /** 目标页在新导航里的名字，用于「正在前往「X」」。 */
  title: string;
  /** 说清为什么换了地方，一句话。 */
  description: string;
  icon?: IconName;
}

export function LegacyRedirect({
  to,
  title,
  description,
  icon = "arrow-right",
}: LegacyRedirectProps) {
  const router = useRouter();
  const from = usePathname();

  useEffect(() => {
    /* `useSearchParams()` 会把整棵树逼进 Suspense（Next 的 CSR bailout 规则），
       而这里只需要一段字符串，读 `location.search` 既够用也不牵连渲染边界。 */
    const inherited =
      typeof window === "undefined"
        ? ""
        : window.location.search.replace(/^\?/, "");
    const q = to.indexOf("?");
    const path = q === -1 ? to : to.slice(0, q);
    const own = q === -1 ? "" : to.slice(q + 1);
    const merged = [own, inherited].filter(Boolean).join("&");
    router.replace(merged ? `${path}?${merged}` : path);
  }, [router, to]);

  return (
    <ViewLayout>
      <EmptyState
        icon={icon}
        title={`正在前往「${title}」`}
        description={`${description}原地址 ${from} 已停用，请更新书签。`}
      />
    </ViewLayout>
  );
}
