"use client";

/**
 * DashboardPage.tsx — 概览（工作台首页）。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * ## 2026-09-09 全面重排（owner）
 *
 * 三块，顺序是 **你是谁 → 要你做什么 → 你有什么**：
 *
 *     ① WelcomeCard     当前用户与所在租户/工作空间的概要，只显示不编辑
 *     ② TodoSection     需要处理的事项：待办与紧要信息
 *     ③ ResourceSection 我有的资源与产品，「更多」去智能体域主页
 *
 * ── 旧版错在哪 ──
 * 旧版标题叫「账户与租户控制台」，第一块是「快捷操作」三个按钮（添加成员 / 查看
 * 订阅 / 提交工单），然后是重点信号、配额态势、近期账单。两个问题：
 *
 *   1. **它把一个多产品平台讲成了单一后台的入口页。** owner 的话：「必须清楚我们是
 *      多产品服务平台，不是一款产品」。旧版**完全没有**「我有哪些产品在服务」这一块。
 *   2. **快捷操作那三个按钮指向的就是侧栏里的三项**——重复导航不是内容。而且
 *      「提交工单」指向的页面根本不存在。
 *
 * 我自己在这里也想岔过一次：起初把「产品」放第一块，owner 指出思路狭隘——人落到
 * 这一页先要知道「我是谁、在哪」（这是**多租户**平台，进错租户做的每件事都是错的），
 * 然后才是「要我做什么」「我有什么」。
 *
 * ── 为什么不用 DashboardTemplate ──
 * 那个模板焊死的顺序是「先看数(metrics) → 再选路(entries) → 再处理事项」，与这里
 * 要的顺序相反；而且它的 `entries` 槽位天然招来一排快捷入口，正是要去掉的东西。
 * 它只有这一个使用者。
 *
 * ── 读失败显影 ──
 * 四路读全 allSettled：一路失败只让它自己那块显影，并给一次整页重试。
 * 各块按能力码显隐（billing.read / quota.read）；**产品磁贴不设门**——「我有哪些
 * 产品」是每个成员都该看得见的事实，不是账务信息。
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ViewHeader, ViewLayout } from "@vxture/design-system";
import {
  fetchMyApps,
  fetchQuotaUsage,
  type ConsoleQuotaUsage,
  type ProductAppTile,
} from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { hasCapability } from "@/features/permissions/can";
import { LoadFailedBanner } from "@/components/load/LoadFailed";
import { fmtCount, formatBytes } from "@/lib/format-metrics";
import { WelcomeCard } from "./WelcomeCard";
import { TodoSection } from "./TodoSection";
import { ResourceSection, type OverviewQuotaRow } from "./ResourceSection";

/** 用过这个比例才值得在概览上提一句。与配额页的告急口径同一个数。 */
const ATTENTION_PERCENT = 80;

export function DashboardPage() {
  const { session } = useConsoleSession();
  const t = useTranslations("dashboard");

  const canSeeQuota = hasCapability(session.capabilities, "tenant.quota.read");

  const [quota, setQuota] = useState<ConsoleQuotaUsage | null>(null);
  /* 产品磁贴。null = 没读到——与「读到了但一个产品都没有」是两回事，
     后者是新工作空间的正常状态，要给去处而不是报错。 */
  const [tiles, setTiles] = useState<ProductAppTile[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<{
    quota: boolean;
    tiles: boolean;
    any: boolean;
  }>({ quota: false, tiles: false, any: false });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const skip = <T,>(value: T) => Promise.resolve(value);
    void Promise.allSettled([
      canSeeQuota ? fetchQuotaUsage() : skip(null),
      fetchMyApps(),
    ])
      .then(([quotaRes, tilesRes]) => {
        if (!active) return;
        setQuota(quotaRes.status === "fulfilled" ? quotaRes.value : null);
        setTiles(tilesRes.status === "fulfilled" ? tilesRes.value : null);
        const f = {
          quota: quotaRes.status === "rejected",
          tiles: tilesRes.status === "rejected",
          any: false,
        };
        f.any = f.quota || f.tiles;
        setFailed(f);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session.tenant?.id, canSeeQuota, reloadKey]);

  /* 概览只画**需要注意**的额度行（用过 80%）。没有任何一项到线时整块不画——
     一堆 5% 的进度条不需要人做任何事，画出来只是噪音。全量在配额管理。 */
  const quotaRows = useMemo<OverviewQuotaRow[]>(() => {
    if (!quota) return [];
    const pools = [
      { key: "storage" as const, ...quota.storage, fmt: formatBytes },
      { key: "aiCredit" as const, ...quota.aiCredit, fmt: fmtCount },
    ];
    return pools
      .map((p) => ({
        label: t(`quotas.pool.${p.key}`),
        percent:
          p.limit > 0
            ? Math.min(100, Math.round((p.used / p.limit) * 100))
            : null,
        text: `${p.fmt(p.used)} / ${p.fmt(p.limit)}`,
      }))
      .filter((r) => r.percent !== null && r.percent >= ATTENTION_PERCENT);
  }, [quota, t]);

  return (
    <ViewLayout>
      <ViewHeader
        icon="home"
        title={t("title")}
        description={t("description")}
      />

      {failed.any ? (
        <LoadFailedBanner
          onRetry={() => setReloadKey((k) => k + 1)}
          retrying={loading}
        />
      ) : null}

      {/* ① 你是谁、在哪 —— 只显示不编辑 */}
      <WelcomeCard />

      {/* ② 要你做什么 —— 待办与紧要信息 */}
      <TodoSection />

      {/* ③ 你有什么 —— 产品与需要注意的额度 */}
      <ResourceSection
        tiles={tiles}
        tilesFailed={failed.tiles}
        quotaRows={quotaRows}
        quotaFailed={failed.quota}
        loading={loading}
      />
    </ViewLayout>
  );
}
