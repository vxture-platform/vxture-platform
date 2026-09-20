"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  FactList,
  Icon,
  LabeledValue,
  LevelMarker,
  MetricCard,
  MetricGrid,
  PanelCard,
  PanelItem,
  PanelList,
  Section,
  SectionHeader,
  SegmentedControl,
  StatusBadge,
  TableTitleCell,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import { toStatusTone } from "@/modules/shared/tone";
import type {
  IconName,
  Level,
  MetricGridItem,
  StatusBadgeTone,
} from "@vxture/design-system";
import type { Locale } from "@vxture-platform/shared";
import {
  fetchDashboardOverview,
  fetchProductReleases,
  fetchProductSolutions,
} from "@/api/admin-bff";
import { EMPTY_DASHBOARD_OVERVIEW } from "@/api/admin-bff";
import type { DashboardOverviewRecord } from "@/api/admin-bff";
import type {
  ProductReleaseRecord,
  ProductSolutionRecord,
} from "@/entities/console";
import { formatAdminCompactCurrency } from "@/lib/admin-formatters";
import { useLocale } from "next-intl";

type Tone = "blue" | "green" | "cyan" | "amber" | "rose" | "indigo";
type PeriodKey = "recent30" | "total" | "year" | "quarter" | "month";
type BusinessPanelId = "tenantScale" | "subscription" | "finance";
type BusinessMetricIcon =
  | "building-library"
  | "user"
  | "api"
  | "database"
  | "chart-bar"
  | "shield-check"
  | "cloud";
type OverviewPulseTag = { label?: string; value: string; tone?: Tone };

interface ProductRankingRow {
  id: string;
  name: string;
  meta: string;
  subscriptions: number;
  monthlyNew: number;
  priceTag?: string;
}

/**
 * 产品供给 / 服务与工单 两处指标排共用的一份形状。
 *
 * 原本是 ProductMetric / ModelMetric / ServiceMetric 三个接口配三个本地卡组件，
 * 三份 CSS 逐条比对下来是同一张卡（2.5rem 图标轨 + 标签 + 读数 + 标）。迁到
 * DS MetricGrid 之后页面这边只剩数据，形状自然并成一个。
 *
 * `tone` 直接写 DS 语义名：这些值是前端写死的，不走 `toStatusTone`——那层只为
 * admin-bff 的颜色名契约而留（见 modules/shared/tone.ts 的说明）。
 */
interface OverviewMetric {
  label: string;
  value: string;
  /** 指标口径，落在标签行的 `?` 里。 */
  detail: string;
  icon: IconName;
  tone: StatusBadgeTone;
  /** 读数旁的补充口径，成品字符串（"生效 12"）。 */
  tags?: string[];
  /** 卡面常驻的一行补充。 */
  description?: string;
}

/** OverviewMetric → MetricGrid 的 item：口径进 `?`，其余直传。 */
function metricItems(metrics: readonly OverviewMetric[]): MetricGridItem[] {
  return metrics.map((metric) => ({
    id: metric.label,
    label: metric.label,
    value: metric.value,
    help: metric.detail,
    icon: metric.icon,
    tone: metric.tone,
    ...(metric.tags ? { tags: metric.tags } : {}),
    ...(metric.description ? { description: metric.description } : {}),
  }));
}

interface OverviewPulseMetric {
  id: string;
  title: string;
  value: string;
  detail: string;
  tone: Tone;
  tags: Array<{ label?: string; value: string; tone?: Tone }>;
}

const periodOptions = [
  { key: "recent30", label: "近30天" },
  { key: "total", label: "总计" },
  { key: "year", label: "年度" },
  { key: "quarter", label: "季度" },
  { key: "month", label: "月度" },
] satisfies Array<{ key: PeriodKey; label: string }>;

/* 2026-08-30：这里原来有一张 `periodScale = { total: 8.4, year: 6.2, quarter: 2.7,
   month: 0.92 }`，把"近 30 天"的真实读数乘上一个凭空写的系数冒充其它周期的数
   ——产品供给的"版本更新 N 次"与模型平台的"Token 总量"都靠它。按周期的数字只认
   `GET /api/dashboard/overview?period=` 这一条真聚合；没有表撑着
   的读数（发布更新次数、Token 用量，见 TD-036）直接不展示，不再拿系数编。 */

/**
 * 三方 = `releaseType === "custom"`，它由 `product.products.origin = 'third_party'`
 * 投影而来（2026-08-31 releases 去 mock）。此前还按产品码里含 partner/provider/
 * third 去猜——那是 mock 数据没有来源轴时的权宜，现在来源是真的，不再猜。
 */
function isThirdPartyProduct(release: ProductReleaseRecord) {
  return release.releaseType === "custom";
}

function uniqueProductReleases(records: ProductReleaseRecord[]) {
  const productMap = new Map<string, ProductReleaseRecord>();

  records.forEach((release) => {
    if (!productMap.has(release.productCode)) {
      productMap.set(release.productCode, release);
    }
  });

  return Array.from(productMap.values());
}

function productOwnershipCounts(
  records: ProductReleaseRecord[],
  options: { uniqueProducts?: boolean } = {},
) {
  const scopedRecords = options.uniqueProducts
    ? uniqueProductReleases(records)
    : records;
  const thirdParty = scopedRecords.filter(isThirdPartyProduct).length;
  const owned = scopedRecords.length - thirdParty;

  return {
    total: scopedRecords.length,
    owned,
    thirdParty,
  };
}

function productActiveCount(
  records: ProductReleaseRecord[],
  options: { uniqueProducts?: boolean } = {},
) {
  const scopedRecords = options.uniqueProducts
    ? uniqueProductReleases(records)
    : records;

  return scopedRecords.filter(
    (release) => release.productStatus === "active" && release.isActive,
  ).length;
}

function productSolutionCounts(records: ProductSolutionRecord[]) {
  const active = records.filter(
    (solution) => solution.status === "active",
  ).length;
  const publicCount = records.filter(
    (solution) => solution.visibility === "public",
  ).length;
  const industryCount = new Set(
    records.map((solution) => solution.industry).filter(Boolean),
  ).size;

  return {
    total: records.length,
    active,
    public: publicCount,
    industryCount,
  };
}

function productTierCounts(records: ProductSolutionRecord[]) {
  const tiers = records.flatMap((solution) => solution.tiers);
  const active = tiers.filter((tier) => tier.status === "active").length;
  const publicCount = tiers.filter((tier) => tier.isPublic).length;

  return {
    total: tiers.length,
    active,
    public: publicCount,
  };
}

/* TD-036：模型用量/Token 没有任何落库（写路径从未建过，服务已迁 vxture-atlas）。
   这里原来先读 `model.config` 里的 periodTokens/tokenCalls 之类的键、再乘周期
   系数——config 里几乎从不带这些键，带了也不是用量。"Token 总量"读数与"Token
   调用量前三"排行一并摘掉（2026-08-30），等有真表再接。 */

function periodLabelOf(period: PeriodKey) {
  return periodOptions.find((option) => option.key === period)?.label ?? "";
}

// TD-036: ticket counts are real (support.tickets via /dashboard-overview);
// there is no rating/CSAT/SLA table anywhere in the schema, so that half of
// the old combined "服务与工单" section is not synthesized — see
// ratingMetricsFor below, which returns an explicit unavailable state.
function serviceMetricsFor(overview: DashboardOverviewRecord) {
  const label = periodLabelOf(overview.period);
  const { totalInPeriod, resolved, inProgress, pending } = overview.tickets;

  return [
    {
      label: "工单总数",
      value: totalInPeriod.toLocaleString("en-US"),
      detail: `${label}工单 ${totalInPeriod.toLocaleString("en-US")}（按创建时间统计）。`,
      tone: "brand",
      icon: "chat-circle",
    },
    {
      label: "已完成",
      value: resolved.toLocaleString("en-US"),
      detail: `${label}已完成（resolved/closed）${resolved.toLocaleString("en-US")}。`,
      tone: "success",
      icon: "success",
    },
    {
      label: "进行中",
      value: inProgress.toLocaleString("en-US"),
      detail: `${label}进行中（open/in_progress/reopened）${inProgress.toLocaleString("en-US")}。`,
      tone: "info",
      icon: "clock",
    },
    {
      label: "已搁置",
      value: pending.toLocaleString("en-US"),
      detail: `${label}已搁置（pending）${pending.toLocaleString("en-US")}。`,
      tone: "warning",
      icon: "warning",
    },
  ] satisfies OverviewMetric[];
}

/**
 * 客户评价三卡（support.product_reviews，2026-09-20 接入）。
 *
 * 此前这里写的是「数据源待建设：平台暂无服务/产品评价聚合表」——那句话现在是
 * 化石，表与两个入口都已落地（#399 建表 / #402 写侧 / #403 console 入口）。
 *
 * 三项**各带各的分母**：均分下面那行报的是「评了这一项的人数」，不是评价总条数。
 * 三项分数各自可空，只评了产品的客户不进价格分的分母；把四个数当同一个分母用，
 * 在「只评一项」的客户多起来之后会越错越远。
 *
 * `average` 为 `null` = 这一项还没人评，画「—」而不是 0.0——0 分是最差评，
 * 「还没人评」不是。
 */
function ratingMetricsFor(overview: DashboardOverviewRecord) {
  const { productScore, priceScore, serviceScore, reviewCount } =
    overview.reviews;

  const card = (
    label: string,
    icon: IconName,
    score: { average: number | null; count: number },
    detail: string,
  ) =>
    ({
      label,
      icon,
      value: score.average === null ? "—" : score.average.toFixed(1),
      detail:
        score.average === null
          ? `${detail}目前还没有人评这一项。`
          : `${detail}均分取自评了这一项的 ${score.count} 条评价（满分 5）。`,
      tags: [
        score.average === null
          ? "暂无评价"
          : `${score.count.toLocaleString("en-US")} 人评过`,
      ],
      // 低于 3 分转告警语气:这不是"数值小"，是客户在说不满意。
      tone:
        score.average === null
          ? "neutral"
          : score.average < 3
            ? "warning"
            : "success",
    }) satisfies OverviewMetric;

  return [
    card(
      "产品评价",
      "medal",
      productScore,
      "客户对产品本身的评分（功能是否称手、稳定与否）。",
    ),
    card(
      "价格评价",
      "credit-card",
      priceScore,
      "客户对价格的评分（花的钱与得到的是否相称）。",
    ),
    card(
      "服务评价",
      "star",
      serviceScore,
      `客户对服务的评分（咨询、工单与响应）。共收到 ${reviewCount.toLocaleString("en-US")} 条评价。`,
    ),
  ] satisfies OverviewMetric[];
}

/* 原有 `metricToneClass()` 随 `.admin-overview-tone--*` 一同退场：那六个类只是把
   一个 `--overview-tone` 变量喂给「详情」链接与图表图标的颜色，而那两处现在直接
   用 DS 语气名。卡片本身不需要这一层间接。 */

const TONE_TEXT: Record<StatusBadgeTone, string> = {
  neutral: "text-muted-foreground",
  brand: "text-primary-text",
  info: "text-info-text",
  success: "text-success-text",
  warning: "text-warning-text",
  danger: "text-destructive-text",
};

/** 名次 → 等级：第 1 名最高（L5），第 5 名及以后落到 L1。 */
function rankLevel(rank: number): Level {
  return Math.min(5, Math.max(1, 6 - rank)) as Level;
}

/**
 * 前三名有徽章图，之后回落到等级记号——图只有三张。
 *
 * 原先还有个 `muted` 态给"待接入 / 暂无数据"的补位行去色。补位行本身
 * 2026-08-30 摘掉了（不足三条就只画有的几条，一条没有走 PanelList 的空态），
 * 去色态随之没有存在的理由。
 */
function RankMedal({ rank }: { rank: number }) {
  /* 三张奖牌图原来是 `background-image: url("https://raw.githubusercontent.com/…")`
   * ——**生产样式表里挂着外部 URL**。离线、内网、CSP 收紧任一条成立，它就变成三个
   * 空方块：背景图加载失败不报错、不留痕，只是没了。改用 emoji 字符表达同一件事，
   * 顺带省掉三次跨域请求。 */
  const MEDALS = ["🥇", "🥈", "🥉"] as const;

  if (rank > 3) {
    return (
      <LevelMarker level={rankLevel(rank)} aria-label={`第 ${rank} 名`}>
        {rank}
      </LevelMarker>
    );
  }

  return (
    <span
      className="inline-grid size-icon-xl place-items-center text-title-md"
      role="img"
      aria-label={`第 ${rank} 名`}
    >
      {MEDALS[rank - 1]}
    </span>
  );
}

/** 读数的单位（万 / % / K）压小一档，与读数同基线。 */
function metricValueNode(value: string) {
  const { prefix, number, unit } = splitMetricValue(value);

  return (
    <>
      {prefix}
      {number}
      {unit ? <small className="text-body-sm font-normal">{unit}</small> : null}
    </>
  );
}

/** 面板头右端的"详情"入口，四处面板同一个写法。 */
function DetailLink({ href }: { href: string }) {
  return (
    <Link
      className="shrink-0 text-body-sm font-semibold text-primary-text no-underline hover:underline"
      href={href}
    >
      详情
    </Link>
  );
}

function DetailTip({ detail }: { detail: string }) {
  return (
    /* 原来是 `:hover > span` 的绝对定位浮层，自带一套开合动画与窄屏翻边。
     * `Tooltip` 管这些，还管键盘聚焦与 Esc。 */
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-md" aria-label={detail}>
          <Icon name="help" size="xs" fallback="placeholder" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{detail}</TooltipContent>
    </Tooltip>
  );
}

function PeriodSwitch({
  value,
  options,
  onChange,
}: {
  value: PeriodKey;
  options: readonly PeriodKey[];
  onChange: (next: PeriodKey) => void;
}) {
  const visibleOptions = periodOptions.filter((option) =>
    options.includes(option.key),
  );

  /* 原来是手搓的分段控件：`role="tablist"` 的 div 里排一串 Button，选中滑块是
   * 一个 `::before`，位置靠两个自定义属性（`--active-offset` / `--item-count`）
   * 现算。`SegmentedControl` 就是这件东西，滑块与键盘行为都是它的契约。 */
  return (
    <SegmentedControl
      items={visibleOptions.map((option) => ({
        value: option.key,
        label: option.label,
      }))}
      value={value}
      onChange={onChange}
      size="sm"
      ariaLabel="统计周期"
    />
  );
}

function OverviewHeading({
  icon,
  title,
  description,
  period,
  onPeriodChange,
  level = "section",
}: {
  icon: IconName;
  title: string;
  description: string;
  /* 周期开关只给真有按周期读数的板块。产品供给那一段下面全是当前快照
     （目录计数），原先那个开关拨了只会换掉一个乘出来的
     假数（见 periodOptions 下方说明），开关本身就在暗示"这些数字分周期"——
     数字摘掉，开关也不留（2026-08-30）。 */
  period?: PeriodKey;
  onPeriodChange?: (next: PeriodKey) => void;
  level?: "page" | "section";
}) {
  const periodSwitch =
    period && onPeriodChange ? (
      <PeriodSwitch
        value={period}
        options={["recent30", "total", "year", "quarter", "month"]}
        onChange={onPeriodChange}
      />
    ) : undefined;

  // 页头与板块标题是两件不同的东西，不是同一件的两个层级：ViewHeader 是一页的
  // 页头（本页仅"平台总览"一处），SectionHeader 管页内板块，从 level 2 起。
  return level === "page" ? (
    <ViewHeader
      icon={icon}
      title={title}
      description={description}
      {...(periodSwitch ? { action: periodSwitch } : {})}
    />
  ) : (
    <SectionHeader
      level={2}
      icon={icon}
      title={title}
      description={description}
      {...(periodSwitch ? { action: periodSwitch } : {})}
    />
  );
}

function OverviewPulseCard({ metric }: { metric: OverviewPulseMetric }) {
  /* 带标签的是补充口径（"新增 +12"），语气跟随整卡；不带标签的是纯涨跌值，
   * 自带涨绿跌红的语气——正好对上 MetricCard 的 tags / trend 两个槽。 */
  const delta = metric.tags.find((tag) => !tag.label);
  const captions = metric.tags.filter((tag) => tag.label);

  return (
    <MetricCard
      label={metric.title}
      help={metric.detail}
      tone={toStatusTone(metric.tone)}
      value={metric.value}
      {...(delta
        ? {
            trend: delta.value,
            ...(delta.tone ? { trendTone: toStatusTone(delta.tone) } : {}),
          }
        : {})}
      tags={captions.map((tag) => `${tag.label} ${tag.value}`)}
    />
  );
}

// Panel headers/tones are static section labels, not data — the previous
// indirection through a mock `band.metrics` array added nothing beyond mock
// plumbing (TD-036); businessCardMetrics() now reads DashboardOverviewRecord
// directly instead of a per-panel metrics slice.
function businessPanelsFor(period: PeriodKey) {
  return [
    {
      id: "tenantScale",
      title: "客户增长",
      period,
      detailHref: "/tenants",
      tone: "blue" as const,
    },
    {
      id: "subscription",
      title: "订阅转化",
      period,
      detailHref: "/subscriptions",
      tone: "blue" as const,
    },
    {
      id: "finance",
      title: "收入验证",
      period,
      // `/revenue` 是死链:侧栏注册表里没有这个条目,app 下也没有这个路由目录,
      // 点过去会落到 [...slug] 的「板块待建设」占位页。收入验证的去处是商业分析。
      detailHref: "/commerce-overview",
      tone: "blue" as const,
    },
  ] satisfies Array<{
    id: BusinessPanelId;
    title: string;
    period: PeriodKey;
    detailHref: string;
    tone: Tone;
  }>;
}

// TD-036: 模型调用/平台稳定性 have no backing table anywhere in the schema
// (no model usage-write path, no uptime/incident table) — rendered as an
// honest unavailable state instead of the old fabricated snapshot values.
function overviewPulseMetrics(
  overview: DashboardOverviewRecord,
  locale: Locale,
) {
  const { tenants, revenue } = overview;

  return [
    {
      id: "activeCustomers",
      title: "活跃客户",
      value: tenants.active.toLocaleString("en-US"),
      detail: `活跃租户 ${tenants.active.toLocaleString("en-US")}（tenancy.tenants, status=active），${periodLabelOf(overview.period)}新增 ${tenants.newInPeriod.toLocaleString("en-US")}。`,
      tone: "blue",
      tags: [
        createOverviewPulseTag(
          `+${tenants.newInPeriod.toLocaleString("en-US")}`,
          "新增",
          "blue",
        ),
      ],
    },
    {
      // 原先这一格是「模型调用」「平台稳定性」两个 `—` 占位(用量写路径未打通、
      // 无健康检查表)。owner 2026-09-20 收成三卡,换上真有数据源的产品订阅。
      id: "subscriptions",
      title: "产品订阅",
      value: overview.subscriptions.active.toLocaleString("en-US"),
      detail: `有效订阅 ${overview.subscriptions.active.toLocaleString("en-US")}（metering.subscriptions, status=active），试用中 ${overview.subscriptions.trialing.toLocaleString("en-US")}，${periodLabelOf(overview.period)}新增 ${overview.subscriptions.newInPeriod.toLocaleString("en-US")}。`,
      tone: "cyan",
      tags: [
        createOverviewPulseTag(
          `+${overview.subscriptions.newInPeriod.toLocaleString("en-US")}`,
          "新增",
          "cyan",
        ),
      ],
    },
    {
      id: "revenue",
      title: "订阅收入",
      value: formatAdminCompactCurrency(revenue.paidInPeriod, locale),
      detail: `${periodLabelOf(overview.period)}实收 ${formatAdminCompactCurrency(revenue.paidInPeriod, locale)}，累计实收 ${formatAdminCompactCurrency(revenue.paidTotal, locale)}；有效订阅 ${overview.subscriptions.active.toLocaleString("en-US")}。`,
      tone: "green",
      tags: [
        createOverviewPulseTag(
          periodDelta(
            revenue.paidInPeriod,
            revenue.paidInPrevPeriod,
            overview.period,
          ),
          undefined,
          displayDeltaTone(
            periodDelta(
              revenue.paidInPeriod,
              revenue.paidInPrevPeriod,
              overview.period,
            ),
          ),
        ),
      ],
    },
  ] satisfies OverviewPulseMetric[];
}

function displayDeltaTone(value: string | undefined): Tone | undefined {
  const trimmed = value?.trim();

  if (!trimmed || trimmed === "—") return undefined;
  if (trimmed.startsWith("-") || trimmed.startsWith("¥-")) return "rose";
  if (trimmed.startsWith("+")) return "blue";

  return undefined;
}

function createOverviewPulseTag(
  value: string,
  label?: string,
  tone?: Tone,
): OverviewPulseTag {
  return {
    ...(label ? { label } : {}),
    value,
    ...(tone ? { tone } : {}),
  };
}

function isNegativeDisplayValue(value: string) {
  const trimmed = value.trim();

  return trimmed.startsWith("-") || trimmed.startsWith("¥-");
}

function splitMetricValue(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^([+-]?[$¥]?)([\d,.]+)(万|[KkMmBb]|%)?$/);

  if (!match) return { prefix: "", number: value, unit: "" };

  return {
    prefix: match[1] ?? "",
    number: match[2] ?? value,
    unit: match[3] ?? "",
  };
}

interface BusinessCardMetric {
  label: string;
  value: string;
  valueTag?: string;
  detail: string;
  tone?: Tone;
  icon: BusinessMetricIcon;
  minor: Array<{ label: string; value: string; tone?: Tone }>;
}

/** "+N" / "-N" vs the immediately-preceding period of equal length; "—" when there's nothing to compare (period="total" has no prior window). */
function periodDelta(current: number, previous: number, period: PeriodKey) {
  if (period === "total") return "—";
  const diff = current - previous;
  return diff >= 0
    ? `+${diff.toLocaleString("en-US")}`
    : diff.toLocaleString("en-US");
}

const UNAVAILABLE_CARD_DETAIL =
  "数据源待建设：暂无对应统计表，不展示编造数值。";

function unavailableBusinessCard(
  label: string,
  icon: BusinessMetricIcon,
): BusinessCardMetric {
  return {
    label,
    value: "—",
    detail: UNAVAILABLE_CARD_DETAIL,
    tone: "blue",
    icon,
    minor: [],
  };
}

// TD-036: every value below is read straight from DashboardOverviewRecord
// (bff/admin-bff platform-admins.router.ts GET /dashboard-overview), which
// only exposes fields with a real backing table. "私域大客户"（no VIP/key-
// account flag anywhere in the schema）and "收入质量"（no nominal-vs-actual
// revenue distinction — the old actualRevenue/nominalRevenue split was
// invented) have no real source and render as an honest empty state instead.
function businessCardMetrics(
  panel: ReturnType<typeof businessPanelsFor>[number],
  overview: DashboardOverviewRecord,
  locale: Locale,
): BusinessCardMetric[] {
  if (panel.id === "tenantScale") {
    const { tenants, users } = overview;
    return [
      {
        label: "租户规模",
        value: tenants.total.toLocaleString("en-US"),
        valueTag: `活跃 ${tenants.active.toLocaleString("en-US")}`,
        detail: `租户总数 ${tenants.total.toLocaleString("en-US")}，${periodLabelOf(panel.period)}新增 ${tenants.newInPeriod.toLocaleString("en-US")}，活跃 ${tenants.active.toLocaleString("en-US")}。`,
        tone: "blue",
        icon: "chart-bar",
        minor: [
          {
            label: "新增",
            value: `+${tenants.newInPeriod.toLocaleString("en-US")}`,
          },
          {
            label: "环比",
            value: periodDelta(
              tenants.newInPeriod,
              tenants.newInPrevPeriod,
              panel.period,
            ),
          },
        ],
      },
      {
        label: "用户规模",
        value: users.total.toLocaleString("en-US"),
        detail: `用户总数 ${users.total.toLocaleString("en-US")}，${periodLabelOf(panel.period)}新增 ${users.newInPeriod.toLocaleString("en-US")}。`,
        tone: "blue",
        icon: "user",
        minor: [
          {
            label: "新增",
            value: `+${users.newInPeriod.toLocaleString("en-US")}`,
          },
          {
            label: "环比",
            value: periodDelta(
              users.newInPeriod,
              users.newInPrevPeriod,
              panel.period,
            ),
          },
        ],
      },
      unavailableBusinessCard("私域大客户", "building-library"),
    ];
  }

  if (panel.id === "subscription") {
    const { subscriptions } = overview;
    return [
      {
        label: "订阅规模",
        value: subscriptions.active.toLocaleString("en-US"),
        valueTag: `试用中 ${subscriptions.trialing.toLocaleString("en-US")}`,
        detail:
          "有效订阅指当前处于试用或已付费、仍能产生产品权益的订阅实例（metering.subscriptions.status ∈ active/trialing）。",
        tone: "blue",
        icon: "database",
        minor: [
          {
            label: "新增",
            value: `+${subscriptions.newInPeriod.toLocaleString("en-US")}`,
          },
          {
            label: "环比",
            value: periodDelta(
              subscriptions.newInPeriod,
              subscriptions.newInPrevPeriod,
              panel.period,
            ),
          },
        ],
      },
      {
        label: "付费转化",
        value: subscriptions.trialConvertedInPeriod.toLocaleString("en-US"),
        detail:
          "试用转付费指该周期内 subscription_histories 记录到的 trialing → active 状态迁移次数。",
        tone: "blue",
        icon: "chart-bar",
        minor: [
          {
            label: "试用中",
            value: subscriptions.trialing.toLocaleString("en-US"),
          },
          {
            label: "活跃",
            value: subscriptions.active.toLocaleString("en-US"),
          },
        ],
      },
      {
        label: "续费健康",
        value: subscriptions.renewalsDue.toLocaleString("en-US"),
        valueTag: `风险 ${subscriptions.renewalsAtRisk.toLocaleString("en-US")}`,
        detail:
          "续费健康统计 metering.subscription_renewals 队列：待处理（pending/processing）与风险（failed/dunning）两类，不区分统计周期（队列状态是当前快照）。",
        tone: subscriptions.renewalsAtRisk > 0 ? "amber" : "blue",
        icon: "shield-check",
        minor: [
          {
            label: "待处理",
            value: subscriptions.renewalsDue.toLocaleString("en-US"),
          },
          {
            label: "风险",
            value: subscriptions.renewalsAtRisk.toLocaleString("en-US"),
            tone: "rose",
          },
        ],
      },
    ];
  }

  const { revenue } = overview;
  return [
    {
      label: "收入规模",
      value: formatAdminCompactCurrency(revenue.paidInPeriod, locale),
      valueTag: periodDelta(
        revenue.paidInPeriod,
        revenue.paidInPrevPeriod,
        panel.period,
      ),
      detail: `${periodLabelOf(panel.period)}实收 ${formatAdminCompactCurrency(revenue.paidInPeriod, locale)}，累计实收 ${formatAdminCompactCurrency(revenue.paidTotal, locale)}（billing.payments, pay_status=paid）。`,
      tone: "blue",
      icon: "chart-bar",
      minor: [
        {
          label: "累计",
          value: formatAdminCompactCurrency(revenue.paidTotal, locale),
        },
        {
          label: "环比",
          value: periodDelta(
            revenue.paidInPeriod,
            revenue.paidInPrevPeriod,
            panel.period,
          ),
        },
      ],
    },
    unavailableBusinessCard("收入质量", "database"),
    {
      label: "回款健康",
      value: formatAdminCompactCurrency(revenue.outstandingAmount, locale),
      valueTag: `待收 ${revenue.outstandingCount.toLocaleString("en-US")} 笔`,
      detail: `待收账单 ${revenue.outstandingCount.toLocaleString("en-US")} 笔，其中逾期 ${revenue.overdueCount.toLocaleString("en-US")} 笔（billing.invoices, bill_status ∈ unpaid/partial/overdue）。`,
      tone: revenue.overdueCount > 0 ? "amber" : "blue",
      icon: "shield-check",
      minor: [
        {
          label: "待收",
          value: formatAdminCompactCurrency(revenue.outstandingAmount, locale),
        },
        {
          label: "逾期",
          value: revenue.overdueCount.toLocaleString("en-US"),
          tone: "rose",
        },
      ],
    },
  ];
}

/** 一条经营读数：图标 · 标签与读数 · 右侧事实。 */
function BusinessMetricRow({ metric }: { metric: BusinessCardMetric }) {
  const tone = metric.tone ? toStatusTone(metric.tone) : "brand";

  return (
    <PanelItem
      lead={
        <span className={TONE_TEXT[tone]} aria-hidden="true">
          <Icon name={metric.icon} size="lg" fallback="placeholder" />
        </span>
      }
      main={
        <LabeledValue
          label={metric.label}
          labelSuffix={<DetailTip detail={metric.detail} />}
          value={metricValueNode(metric.value)}
          tone={isNegativeDisplayValue(metric.value) ? "danger" : tone}
          {...(metric.valueTag
            ? { valueTag: metric.valueTag, valueTagTone: tone }
            : {})}
        />
      }
      trail={
        <FactList
          facts={metric.minor.map((item) => ({
            label: item.label,
            /* 原来这里走 `displayMinorValue()`——用一张 12 个中文键的别名表
               去剥 value 的中文前缀。查实那是死代码:全部 14 个 minor[].value
               的构造点要么是 `+${n.toLocaleString()}`、要么是 periodDelta()
               的 `—`/`+N`/`-N`、要么是 toLocaleString()/
               formatAdminCompactCurrency()（「万」是后缀不是前缀），**没有一个
               以中文开头**,匹配从不发生,函数恒等返回。
               有用的只有它开头那句空值兜底,留在这里。 */
            value: item.value || "—",
            ...(item.tone === "rose" ? { tone: "danger" as const } : {}),
          }))}
        />
      }
    />
  );
}

function BusinessPanel({
  panel,
  overview,
  locale,
}: {
  panel: ReturnType<typeof businessPanelsFor>[number];
  overview: DashboardOverviewRecord;
  locale: Locale;
}) {
  return (
    <PanelCard
      title={panel.title}
      titleSuffix={
        <Link
          className="inline-flex items-center leading-[1] text-muted-foreground transition-colors hover:text-primary-text focus-visible:text-primary-text"
          href={`/usage-metering?period=${panel.period}&scope=${encodeURIComponent(panel.title)}`}
          title={`${panel.title}图形化显示`}
        >
          <Icon name="chart-bar" size="sm" fallback="placeholder" />
        </Link>
      }
      action={<DetailLink href={panel.detailHref} />}
    >
      <PanelList>
        {businessCardMetrics(panel, overview, locale).map((metric) => (
          <BusinessMetricRow key={metric.label} metric={metric} />
        ))}
      </PanelList>
    </PanelCard>
  );
}

function ProductRankingCard({
  title,
  summary,
  detail = summary,
  href,
  rows,
  tone = "blue",
}: {
  title: string;
  summary: string;
  detail?: string;
  href: string;
  rows: ProductRankingRow[];
  tone?: Tone;
}) {
  return (
    <PanelCard
      title={title}
      titleSuffix={<DetailTip detail={detail} />}
      description={summary}
      action={<DetailLink href={href} />}
      tone={toStatusTone(tone)}
      className="grid min-w-0 gap-sm"
    >
      <PanelList empty="数据源待建设：暂无产品供给排行数据。">
        {rows.map((item, index) => (
          <PanelItem
            key={item.id}
            lead={<RankMedal rank={index + 1} />}
            main={
              <TableTitleCell
                title={item.name}
                description={`${item.meta} · 新增 +${item.monthlyNew.toLocaleString("en-US")}`}
              />
            }
            trail={
              <span className="flex items-center gap-xs">
                <b className="text-title-sm font-bold">
                  {item.subscriptions.toLocaleString("en-US")}
                </b>
                {item.priceTag ? (
                  <StatusBadge tone="neutral">{item.priceTag}</StatusBadge>
                ) : null}
              </span>
            }
          />
        ))}
      </PanelList>
    </PanelCard>
  );
}

// 还没读到 / 读失败时的占位——全零，绝不编造数字。
// 取 admin-bff 那一份：此前这里另写了一遍，加字段时两处要同时改。
function emptyDashboardOverview(period: PeriodKey): DashboardOverviewRecord {
  return { period, ...EMPTY_DASHBOARD_OVERVIEW };
}

export default function AdminOverviewPage() {
  const locale = useLocale();
  /**
   * 有上游读取失败。用于把"读不到"与"本来就没有"分开——两者在界面上都是空表，
   * 但只有前者需要运营去看服务是否还活着。
   */
  const [dataDegraded, setDataDegraded] = useState(false);
  const [releases, setReleases] = useState<ProductReleaseRecord[]>([]);
  const [solutions, setSolutions] = useState<ProductSolutionRecord[]>([]);
  const [globalPeriod, setGlobalPeriod] = useState<PeriodKey>("recent30");
  const [businessPeriod, setBusinessPeriod] = useState<PeriodKey>("recent30");
  const [servicePeriod, setServicePeriod] = useState<PeriodKey>("recent30");
  // TD-036: pulse/business/service cards each have an independent period
  // switch, so more than one distinct period can be in view at once — a
  // small per-period cache avoids redundant fetches when they agree (the
  // common case) while still supporting independent switching.
  const [overviewByPeriod, setOverviewByPeriod] = useState<
    Partial<Record<PeriodKey, DashboardOverviewRecord>>
  >({});
  const globalOverview =
    overviewByPeriod[globalPeriod] ?? emptyDashboardOverview(globalPeriod);
  const businessOverview =
    overviewByPeriod[businessPeriod] ?? emptyDashboardOverview(businessPeriod);
  const serviceOverview =
    overviewByPeriod[servicePeriod] ?? emptyDashboardOverview(servicePeriod);
  const pulseMetrics = overviewPulseMetrics(globalOverview, locale);
  const businessPanels = businessPanelsFor(businessPeriod);
  const globalPeriodLabel = periodLabelOf(globalPeriod);
  const servicePeriodLabel = periodLabelOf(servicePeriod);

  function handleGlobalPeriodChange(next: PeriodKey) {
    setGlobalPeriod(next);
    setBusinessPeriod(next);
    setServicePeriod(next);
  }

  useEffect(() => {
    const neededPeriods = Array.from(
      new Set<PeriodKey>([globalPeriod, businessPeriod, servicePeriod]),
    ).filter((period) => !overviewByPeriod[period]);
    if (!neededPeriods.length) return;

    let active = true;
    Promise.all(
      neededPeriods.map((period) => fetchDashboardOverview(period)),
    ).then((results) => {
      if (!active) return;
      setOverviewByPeriod((prev) => {
        const next = { ...prev };
        neededPeriods.forEach((period, index) => {
          const value = results[index];
          if (value) next[period] = value;
        });
        return next;
      });
    });

    return () => {
      active = false;
    };
  }, [globalPeriod, businessPeriod, servicePeriod, overviewByPeriod]);

  useEffect(() => {
    let active = true;

    /**
     * 两路各自兜底，而不是 `Promise.all` 一荣俱荣。
     *
     * 原先是裸 `Promise.all().then()`，**没有 `.catch()`**：Atlas 一挂
     * （`AdminBffError: Atlas is unavailable`），整条链 reject，setter 一个都不
     * 执行，数据全停在初始空值，界面于是显示成"这些数据本来就是空的"，同时抛出
     * 未处理拒绝（2026-08-07 走查在控制台看到两条）。一个上游挂掉不该让另一份
     * 跟着消失。
     *
     * 原先是七路（模型/授权/策略/智能体/开发面板 + 产品/方案）。模型技能整块
     * 2026-09-20 移交 opera 平面后，前五路没有消费方了，一并摘掉——少发四个
     * 后端请求，也少一个在生产必然 404 的开发面板代理。
     */
    const settle = <T,>(promise: Promise<T>, fallback: T): Promise<T> =>
      promise.catch(() => {
        if (active) setDataDegraded(true);
        return fallback;
      });

    Promise.all([
      settle(fetchProductReleases(), []),
      settle(fetchProductSolutions(), []),
    ]).then(([releaseRecords, solutionRecords]) => {
      if (!active) return;
      setReleases(releaseRecords);
      setSolutions(solutionRecords);
    });

    return () => {
      active = false;
    };
  }, []);

  const productMetrics = useMemo(() => {
    const productTotalCounts = productOwnershipCounts(releases, {
      uniqueProducts: true,
    });
    const solutionCounts = productSolutionCounts(solutions);
    const tierCounts = productTierCounts(solutions);
    const activeProductCount = productActiveCount(releases, {
      uniqueProducts: true,
    });
    return [
      {
        label: "产品发布",
        value: String(productTotalCounts.total),
        detail: `产品发布是平台可被方案编排的底层产品供给，累计 ${productTotalCounts.total} 个，生效 ${activeProductCount} 个，自有 ${productTotalCounts.owned} 个，三方 ${productTotalCounts.thirdParty} 个。`,
        tone: "brand",
        icon: "database",
        tags: [
          `生效 ${activeProductCount}`,
          `三方 ${productTotalCounts.thirdParty}`,
        ],
      },
      {
        label: "解决方案",
        value: String(solutionCounts.total),
        detail: `解决方案承接行业、场景和客户分层，当前方案 ${solutionCounts.total} 个，生效 ${solutionCounts.active} 个，覆盖 ${solutionCounts.industryCount} 个行业。`,
        tone: "brand",
        icon: "workflow",
        tags: [
          `生效 ${solutionCounts.active}`,
          `行业 ${solutionCounts.industryCount}`,
        ],
      },
      {
        label: "服务套餐",
        value: String(tierCounts.total),
        detail: `服务套餐是产品与方案之上可售卖、可授权的权益包，当前套餐 ${tierCounts.total} 个，生效 ${tierCounts.active} 个，公开 ${tierCounts.public} 个。`,
        tone: "brand",
        icon: "cube",
        tags: [`生效 ${tierCounts.active}`, `公开 ${tierCounts.public}`],
      },
    ] satisfies OverviewMetric[];
  }, [releases, solutions]);

  // TD-036: the old productTop ranking was a second, independent fabrication
  // (a hardcoded productOperations array with its own made-up subscription
  // counts) layered on top of the already-mock products.router endpoints —
  // removed outright rather than kept. solutionTop/tierTop derived from the
  // same still-mock solutions endpoint (TD-029, no product-catalog schema
  // exists yet) PLUS an extra layer of invented tier-weight multipliers
  // (0.82/1.05/1.25) and arbitrary "monthlyNew" scaling — that extra layer is
  // removed too. TD-029's own 4 KPI summary cards above are untouched (owner
  // ruling: keep those as explicitly-labeled mock pending schema design);
  // this ranking sub-feature has no such ruling and no real backing at all,
  // so it renders the honest empty state (ProductRankingCard, rows=[]).
  const productRankings = useMemo(
    () => ({
      productTop: [] as ProductRankingRow[],
      solutionTop: [] as ProductRankingRow[],
      tierTop: [] as ProductRankingRow[],
    }),
    [],
  );

  const serviceMetrics = useMemo(
    () => serviceMetricsFor(serviceOverview),
    [serviceOverview],
  );
  const ratingMetrics = useMemo(
    () => ratingMetricsFor(serviceOverview),
    [serviceOverview],
  );

  return (
    <ViewLayout className="w-full">
      <header className="grid gap-md">
        <OverviewHeading
          icon="squares-four"
          title="平台总览"
          description={`${globalPeriodLabel}聚合客户活跃、产品订阅和订阅收入，首页只保留运营判断需要的核心数字。`}
          period={globalPeriod}
          onPeriodChange={handleGlobalPeriodChange}
          level="page"
        />
      </header>

      {/*
        读取降级提示。**不能省**：上游挂掉时下面每张卡都会照常渲染出一个数字，
        只是那个数字建立在空数组上——看起来像"平台确实没有模型/方案/发布"，
        而不是"读不到"。空表与读不到必须能分辨（2026-08-07 走查）。
      */}
      {dataDegraded ? (
        <StatusBadge tone="warning">
          部分数据读取失败，下方模型、方案与发布相关指标可能不完整；请确认 Admin
          BFF 与上游服务已启动。
        </StatusBadge>
      ) : null}

      {/* 三张一行，窄屏折两列。间距与其余卡组同为 16px。
          卡数与列数必须一起改：2026-09-20 把四卡收成三卡时只动了数据、没动这里，
          宽屏于是右边空出一格（owner 实看报出）。 */}
      <section
        className="grid gap-md sm:grid-cols-2 lg:grid-cols-3"
        aria-label="平台核心态势"
      >
        {pulseMetrics.map((metric) => (
          <OverviewPulseCard key={metric.id} metric={metric} />
        ))}
      </section>

      <section className="grid gap-md" aria-label="经营指标">
        <OverviewHeading
          icon="chart-bar"
          title="经营指标"
          description={`${periodLabelOf(businessPeriod)}观察客户增长、订阅转化和收入验证，优先看运营动作是否带来真实使用与商业信号。`}
          period={businessPeriod}
          onPeriodChange={setBusinessPeriod}
        />
        <div className="grid items-stretch gap-md max-lg:grid-cols-1 lg:grid-cols-3">
          {businessPanels.map((panel) => (
            <BusinessPanel
              key={panel.id}
              panel={panel}
              overview={businessOverview}
              locale={locale}
            />
          ))}
        </div>
      </section>

      <section className="grid gap-md" aria-label="产品供给">
        <OverviewHeading
          icon="database"
          title="产品供给"
          description="按产品发布、解决方案和服务套餐观察平台可售卖、可交付能力（当前快照）。"
        />
        <MetricGrid
          aria-label="产品供给指标"
          columns={3}
          items={metricItems(productMetrics)}
        />
        <div className="grid items-stretch gap-md max-lg:grid-cols-1 lg:grid-cols-3">
          <ProductRankingCard
            title="产品发布排行"
            summary="默认前三，观察底层产品被订阅采用的强度。"
            href="/products"
            rows={productRankings.productTop}
          />
          <ProductRankingCard
            title="解决方案排行"
            summary="默认前三，观察场景方案的市场采用度。"
            href="/product-solutions"
            rows={productRankings.solutionTop}
          />
          <ProductRankingCard
            title="服务套餐排行"
            summary="默认前三，观察可售权益包的订阅使用。"
            href="/service-plans"
            rows={productRankings.tierTop}
          />
        </div>
      </section>

      <section className="grid gap-md" aria-label="服务与工单">
        <OverviewHeading
          icon="chat-circle"
          title="服务与工单"
          description={`${servicePeriodLabel}工单处理和服务评价分层展示。`}
          period={servicePeriod}
          onPeriodChange={setServicePeriod}
        />
        {/* 这两块不是面板卡：它们装的就是一排指标卡，套上卡壳会变成卡中卡
            （2026-08-05）。同段的产品供给也是"标题 + 一排卡"，这里只是多一层，
            用 level 3 的板块标题表达层级即可。 */}
        <div className="grid gap-md">
          <Section
            level={3}
            title="工单统计"
            description="工单总量、处理状态和搁置情况。"
            action={<DetailLink href="/tickets" />}
          >
            <MetricGrid
              aria-label="工单统计指标"
              items={metricItems(serviceMetrics)}
            />
          </Section>
          <Section
            level={3}
            title="客户评价"
            description="客户给产品、价格与服务打的分，全周期口径。"
            action={<DetailLink href="/reviews" />}
          >
            <MetricGrid
              aria-label="客户评价指标"
              columns={3}
              items={metricItems(ratingMetrics)}
            />
          </Section>
        </div>
      </section>
    </ViewLayout>
  );
}
