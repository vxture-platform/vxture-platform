"use client";

import Link from "next/link";
import { isEnabled, isServing } from "@vxture-platform/shared";
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
  fetchAiModelGrants,
  fetchAiModels,
  fetchDashboardOverview,
  fetchDevServices,
  fetchModelPolicies,
  fetchProductAgents,
  fetchProductReleases,
  fetchProductSolutions,
} from "@/api/admin-bff";
import type { DashboardOverviewRecord } from "@/api/admin-bff";
import type {
  AiModelGrantRecord,
  AiModelRecord,
  DevServiceSnapshot,
  ModelPolicyRecord,
  ProductAgentRecord,
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
 * 产品供给 / 模型技能 / 服务与工单 三处指标排共用的一份形状。
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
  rating?: number;
}

interface CapabilityServiceRow {
  id: string;
  name: string;
  meta: string;
  value: string;
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
   `GET /api/platform-admins/dashboard-overview?period=` 这一条真聚合；没有表撑着
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

function productSupplyAbnormalCounts(
  releases: ProductReleaseRecord[],
  solutions: ProductSolutionRecord[],
) {
  const stoppedProducts = uniqueProductReleases(releases).filter(
    (release) => release.productStatus === "archived" || !release.isActive,
  ).length;
  const abnormalSolutions = solutions.filter(
    (solution) => solution.status !== "active",
  ).length;
  const inactiveTiers = solutions
    .flatMap((solution) => solution.tiers)
    .filter((tier) => tier.status !== "active").length;

  return {
    total: stoppedProducts + abnormalSolutions + inactiveTiers,
    stoppedProducts,
    abnormalSolutions,
    inactiveTiers,
  };
}

function modelCapabilities(model: AiModelRecord) {
  return model.capabilities.map((capability) => capability.toLowerCase());
}

function isPrivateModel(model: AiModelRecord) {
  return (
    model.provider === "private" || modelCapabilities(model).includes("private")
  );
}

function modelOwnershipCounts(records: AiModelRecord[]) {
  const selfBuilt = records.filter(isPrivateModel).length;
  const thirdParty = records.length - selfBuilt;

  return {
    total: records.length,
    selfBuilt,
    thirdParty,
  };
}

function isModelAbnormal(model: AiModelRecord) {
  return (
    !model.endpointUrl.trim() ||
    !model.protocol.trim() ||
    (model.keyReference !== null && !model.keyReference.configured)
  );
}

/* TD-036：模型用量/Token 没有任何落库（写路径从未建过，服务已迁 vxture-atlas）。
   这里原来先读 `model.config` 里的 periodTokens/tokenCalls 之类的键、再乘周期
   系数——config 里几乎从不带这些键，带了也不是用量。"Token 总量"读数与"Token
   调用量前三"排行一并摘掉（2026-08-30），等有真表再接。 */

// TD-036: fetchDevServices() proxies a local dev-tools panel
// (localhost:8090), unreachable from a deployed admin instance — in any real
// production environment `services` is always empty here, and the old code
// filled that gap with a fabricated {total:12, healthy:11, ...}. There is no
// real infra health/uptime table anywhere in the schema (see TD-036), so an
// empty `services` array now surfaces as an honest unavailable state instead
// of synthesizing production monitoring data that was never collected.
function capabilityServiceHealth(services: DevServiceSnapshot[]) {
  if (!services.length) {
    return { available: false as const };
  }

  const healthy = services.filter(
    (service) => service.listening && service.healthy,
  ).length;
  const total = services.length;
  const abnormal = total - healthy;

  return {
    available: true as const,
    total,
    healthy,
    abnormal,
    availability: Math.round((healthy / Math.max(1, total)) * 100),
  };
}

/**
 * 策略 = Atlas 的模型策略（`GET /api/atlas/policies`），不再是 products.router
 * 编出来的「未定义 → 默认不授权」占位行（2026-08-31 该端点退役）。启用与否只看
 * `state`，没有"已定义"这一维——Atlas 里不存在未定义的策略。
 */
function capabilityPolicyCoverage(
  policies: ModelPolicyRecord[],
  grants: AiModelGrantRecord[],
) {
  const definedPolicies = policies.filter((policy) =>
    isEnabled(policy.state),
  ).length;
  const activeGrants = grants.filter((grant) => isEnabled(grant.state)).length;
  const total = policies.length + grants.length;
  const active = definedPolicies + activeGrants;

  return {
    total,
    active,
    pending: Math.max(0, total - active),
    rate: Math.round((active / Math.max(1, total)) * 100),
  };
}

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

// TD-036: no rating/CSAT/SLA-aggregate table exists in the schema (only a
// per-ticket satisfaction_score, not a service/product-level aggregate) —
// show an honest unavailable state rather than a fabricated star rating.
function ratingMetricsFor(_overview: DashboardOverviewRecord) {
  const unavailable = {
    value: "—",
    detail:
      "数据源待建设：平台暂无服务/产品评价聚合表，仅工单级评分字段，无法汇总展示。",
    description: "达成率",
  };

  return [
    {
      label: "服务评价",
      ...unavailable,
      tone: "brand",
      icon: "star",
    },
    {
      label: "产品评价",
      ...unavailable,
      tone: "brand",
      icon: "medal",
    },
    {
      label: "SLA",
      ...unavailable,
      tone: "brand",
      icon: "shield-check",
    },
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
  /* 周期开关只给真有按周期读数的板块。产品供给 / 模型技能两段下面全是当前快照
     （目录计数、模型池、授权、智能体），原先那两个开关拨了只会换掉一个乘出来的
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
      value={
        metric.rating ? (
          /* 评分档：星标在读数左侧，两者当作一个读数整体传进去。 */
          <span className="inline-flex items-end gap-xs">
            <RatingStars value={metric.rating} />
            {metric.value}
          </span>
        ) : (
          metric.value
        )
      }
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
      detailHref: "/revenue",
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

function compactMetricValue(
  value: string | undefined,
  prefixes: readonly string[],
) {
  if (!value) return "—";
  const trimmed = value.trim();
  const matchedPrefix = prefixes.find(
    (prefix) => trimmed === prefix || trimmed.startsWith(`${prefix} `),
  );

  return matchedPrefix
    ? trimmed.slice(matchedPrefix.length).trim() || trimmed
    : trimmed;
}

function displayMinorValue(label: string, value: string) {
  const aliases: Record<string, readonly string[]> = {
    新增: ["新增租户", "新增用户", "新增订阅", "新增"],
    活跃: ["活跃租户", "活跃用户", "活跃"],
    有效: ["有效订阅", "有效"],
    风险: ["风险续费", "风险", "预警"],
    取消订阅: ["取消订阅", "风险续费", "风险", "预警"],
    总数: ["订阅总数", "总数"],
    提升: ["覆盖提升", "提升"],
    待补齐: ["待补齐"],
    累计: ["累计确认收入", "累计成本", "累计毛利润", "累计"],
    本年: ["本年收入", "本年成本", "本年毛利润", "本年"],
    增长: ["增长"],
    变化: ["变化"],
  };

  return compactMetricValue(value, [label, ...(aliases[label] ?? [])]);
}

// TD-036: 模型调用/平台稳定性 have no backing table anywhere in the schema
// (no model usage-write path, no uptime/incident table) — rendered as an
// honest unavailable state instead of the old fabricated snapshot values.
function overviewPulseMetrics(
  overview: DashboardOverviewRecord,
  locale: Locale,
) {
  const { tenants, revenue } = overview;
  const unavailableTag = { label: "状态", value: "待建设" };

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
    {
      id: "modelCalls",
      title: "模型调用",
      value: "—",
      detail:
        "数据源待建设：平台暂无模型调用/Token 用量落库（用量写路径未打通），不展示编造数值。",
      tone: "amber",
      tags: [unavailableTag],
    },
    {
      id: "platformStability",
      title: "平台稳定性",
      value: "—",
      detail: "数据源待建设：平台暂无健康检查/事件记录表，不展示编造数值。",
      tone: "cyan",
      tags: [unavailableTag],
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
            value: displayMinorValue(item.label, item.value),
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

function ModelCategoryCard({
  title,
  detail,
  summary,
  tone,
  href,
  rankStyle = "number",
  rows,
}: {
  title: string;
  detail: string;
  summary: string;
  tone: Tone;
  href?: string;
  rankStyle?: "number" | "medal";
  rows: CapabilityServiceRow[];
}) {
  return (
    <PanelCard
      title={title}
      titleSuffix={<DetailTip detail={detail} />}
      description={summary}
      {...(href ? { action: <DetailLink href={href} /> } : {})}
      tone={toStatusTone(tone)}
      className="grid min-w-0 gap-sm"
    >
      <PanelList empty="暂无数据">
        {rows.map((row, index) => (
          <PanelItem
            key={row.id}
            lead={
              rankStyle === "medal" ? (
                <RankMedal rank={index + 1} />
              ) : (
                <LevelMarker
                  level={rankLevel(index + 1)}
                  aria-label={`第 ${index + 1} 位`}
                >
                  {index + 1}
                </LevelMarker>
              )
            }
            main={<TableTitleCell title={row.name} description={row.meta} />}
            trail={<span className="text-body-sm">{row.value}</span>}
          />
        ))}
      </PanelList>
    </PanelCard>
  );
}

function RatingStars({ value }: { value: number }) {
  const rounded = Math.round(value);

  return (
    <span
      className="inline-flex gap-xs text-body-md leading-[1] text-muted-foreground"
      aria-label={`${value} 星`}
    >
      {Array.from({ length: 5 }, (_, index) => (
        <span
          key={index}
          className={index < rounded ? "text-warning" : undefined}
        >
          {index < rounded ? "★" : "☆"}
        </span>
      ))}
    </span>
  );
}

// TD-036: placeholder shown before a period's real overview has loaded, or
// if the fetch fails — all zeros, never a fabricated number.
function emptyDashboardOverview(period: PeriodKey): DashboardOverviewRecord {
  return {
    period,
    tenants: { total: 0, active: 0, newInPeriod: 0, newInPrevPeriod: 0 },
    users: { total: 0, newInPeriod: 0, newInPrevPeriod: 0 },
    subscriptions: {
      active: 0,
      trialing: 0,
      newInPeriod: 0,
      newInPrevPeriod: 0,
      trialConvertedInPeriod: 0,
      renewalsDue: 0,
      renewalsAtRisk: 0,
    },
    revenue: {
      paidInPeriod: 0,
      paidInPrevPeriod: 0,
      paidTotal: 0,
      outstandingAmount: 0,
      outstandingCount: 0,
      overdueCount: 0,
    },
    tickets: {
      totalInPeriod: 0,
      resolved: 0,
      inProgress: 0,
      pending: 0,
      totalInPrevPeriod: 0,
    },
  };
}

export default function AdminOverviewPage() {
  const locale = useLocale();
  const [models, setModels] = useState<AiModelRecord[]>([]);
  const [modelGrants, setModelGrants] = useState<AiModelGrantRecord[]>([]);
  const [modelPolicies, setModelPolicies] = useState<ModelPolicyRecord[]>([]);
  const [agents, setAgents] = useState<ProductAgentRecord[]>([]);
  const [services, setServices] = useState<DevServiceSnapshot[]>([]);
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
     * 七路各自兜底，而不是 `Promise.all` 一荣俱荣。
     *
     * 原先是裸 `Promise.all().then()`，**没有 `.catch()`**：Atlas 一挂
     * （`AdminBffError: Atlas is unavailable`），整条链 reject，七个 setter
     * 一个都不执行，六份数据全停在初始空值，界面于是显示成"这些数据本来就是
     * 空的"，同时抛出未处理拒绝（2026-08-07 走查在控制台看到两条）。
     *
     * 只有 `fetchDevServices` 当初单独挂了 `.catch`——有人知道它会失败，却没
     * 管别的。一个上游挂掉不该让另外六份跟着消失。
     */
    const settle = <T,>(promise: Promise<T>, fallback: T): Promise<T> =>
      promise.catch(() => {
        if (active) setDataDegraded(true);
        return fallback;
      });

    /* 开发面板代理（app/api/dev-services/route.ts）只在本地有意义，生产直接 404。
       那不是"读取失败"，是"这个环境没有这份数据"——不能走 settle 去点亮上面的
       降级横幅，生产也不该为一个必然 404 的请求在控制台留一条红字。空数组进
       capabilityServiceHealth 就是"待建设"空态。 */
    const devServices: Promise<DevServiceSnapshot[]> =
      process.env.NODE_ENV === "production"
        ? Promise.resolve([])
        : fetchDevServices().catch(() => []);

    Promise.all([
      settle(fetchAiModels(true), []),
      settle(fetchAiModelGrants(), []),
      settle(fetchModelPolicies({ includeInactive: true }), []),
      settle(fetchProductAgents(), []),
      devServices,
      settle(fetchProductReleases(), []),
      settle(fetchProductSolutions(), []),
    ]).then(
      ([
        modelRecords,
        grantRecords,
        policyRecords,
        agentRecords,
        serviceRecords,
        releaseRecords,
        solutionRecords,
      ]) => {
        if (!active) return;
        setModels(modelRecords);
        setModelGrants(grantRecords);
        setModelPolicies(policyRecords);
        setAgents(agentRecords);
        setServices(serviceRecords);
        setReleases(releaseRecords);
        setSolutions(solutionRecords);
      },
    );

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
    const abnormalCounts = productSupplyAbnormalCounts(releases, solutions);

    return [
      {
        label: "产品能力",
        value: String(productTotalCounts.total),
        detail: `产品能力是平台可被方案编排的底层产品供给，累计 ${productTotalCounts.total} 个，生效 ${activeProductCount} 个，自有 ${productTotalCounts.owned} 个，三方 ${productTotalCounts.thirdParty} 个。`,
        tone: "brand",
        icon: "database",
        tags: [
          `生效 ${activeProductCount}`,
          `三方 ${productTotalCounts.thirdParty}`,
        ],
      },
      {
        label: "方案组合",
        value: String(solutionCounts.total),
        detail: `方案组合承接行业、场景和客户分层，当前方案 ${solutionCounts.total} 个，生效 ${solutionCounts.active} 个，覆盖 ${solutionCounts.industryCount} 个行业。`,
        tone: "brand",
        icon: "workflow",
        tags: [
          `生效 ${solutionCounts.active}`,
          `行业 ${solutionCounts.industryCount}`,
        ],
      },
      {
        label: "套餐层级",
        value: String(tierCounts.total),
        detail: `套餐层级是方案下可售卖、可授权的权益包，当前套餐 ${tierCounts.total} 个，生效 ${tierCounts.active} 个，公开 ${tierCounts.public} 个。`,
        tone: "brand",
        icon: "cube",
        tags: [`生效 ${tierCounts.active}`, `公开 ${tierCounts.public}`],
      },
      {
        label: "供给异常",
        value: String(abnormalCounts.total),
        detail: `供给异常用于观察会影响售卖或交付的非正常状态：停用产品 ${abnormalCounts.stoppedProducts} 个，异常方案 ${abnormalCounts.abnormalSolutions} 个，未生效套餐 ${abnormalCounts.inactiveTiers} 个。`,
        tone: abnormalCounts.total > 0 ? "warning" : "brand",
        icon: "warning",
        tags: [
          `产品 ${abnormalCounts.stoppedProducts}`,
          `套餐 ${abnormalCounts.inactiveTiers}`,
        ],
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

  const capabilityMetrics = useMemo(() => {
    const serviceHealth = capabilityServiceHealth(services);
    const totalModelCounts = modelOwnershipCounts(models);
    const activeModelCounts = modelOwnershipCounts(
      /* 数还能服务的：`deprecated` 仍可解析，排除它会低报模型面。 */
      models.filter((model) => isServing(model.state)),
    );
    const abnormalModelCounts = modelOwnershipCounts(
      models.filter(isModelAbnormal),
    );
    const policyCoverage = capabilityPolicyCoverage(modelPolicies, modelGrants);
    const activeAgents = agents.filter(
      (agent) => agent.status === "active",
    ).length;
    const publicAgents = agents.filter(
      (agent) => agent.visibility === "public",
    ).length;
    const inactiveAgents = agents.length - activeAgents;

    return [
      serviceHealth.available
        ? {
            label: "服务监控",
            value: String(serviceHealth.total),
            detail: `服务监控显示当前纳入观测的服务 ${serviceHealth.total} 个，其中健康 ${serviceHealth.healthy} 个，异常 ${serviceHealth.abnormal} 个。`,
            tone:
              serviceHealth.abnormal > 0
                ? ("warning" as const)
                : ("brand" as const),
            icon: "server" as const,
            tags: [`异常 ${serviceHealth.abnormal}`],
          }
        : {
            label: "服务监控",
            value: "—",
            detail:
              "数据源待建设：平台暂无真实基础设施健康/延迟监控落库，不展示编造数值。",
            tone: "brand" as const,
            icon: "server" as const,
            tags: ["状态 待建设"],
          },
      {
        label: "模型平台",
        value: String(totalModelCounts.total),
        detail: `模型平台观察平台可调度模型资源池，模型总数 ${totalModelCounts.total} 个，生效模型 ${activeModelCounts.total} 个，接入异常 ${abnormalModelCounts.total} 个。Token 用量数据源待建设（无模型用量写路径），不展示。`,
        // 异常台数抬进整卡语气——同段的服务监控/策略覆盖/技能市场三张都是这么做的，
        // 只有这张原先写死 blue，靠标自己变色，一排四张里独一份（2026-08-05）。
        tone: abnormalModelCounts.total > 0 ? "warning" : "brand",
        icon: "cloud",
        tags: [
          `异常 ${abnormalModelCounts.total}`,
          `生效 ${activeModelCounts.total}`,
        ],
      },
      {
        label: "策略覆盖",
        value: String(policyCoverage.active),
        detail: `策略覆盖统计模型授权和租户授权的启用情况，当前有效策略 ${policyCoverage.active} 条，待配置或停用 ${policyCoverage.pending} 条。`,
        tone: policyCoverage.pending > 0 ? "warning" : "brand",
        icon: "shield-check",
        tags: [`待配 ${policyCoverage.pending}`],
      },
      {
        label: "技能市场",
        value: String(activeAgents),
        detail: `技能市场当前以智能体可调用能力作为过渡口径，启用 ${activeAgents} 个，公开 ${publicAgents} 个，异常或停用 ${inactiveAgents} 个。`,
        tone: inactiveAgents > 0 ? "warning" : "brand",
        icon: "cube",
        tags: [`异常 ${inactiveAgents}`],
      },
    ] satisfies OverviewMetric[];
  }, [agents, modelGrants, modelPolicies, models, services]);

  const capabilityPanels = useMemo(() => {
    /* 这一排原先有三张：模型平台（Token 调用量前三）、模型授权、技能市场，
       不足三条的都拿"待接入 / 暂无数据"补到三行。模型那张的排序键是乘出来的
       Token 数（见文件头部说明），整张摘掉；补位行也摘掉——列表有几条画几条，
       一条没有就是 PanelList 的空态，不再用假行把表撑满（2026-08-30）。 */
    // Atlas 策略：名字缺省用模型名（modelId 是 UUID，不上屏）；范围看 tenantId 有无。
    const policyRows = modelPolicies
      .map((policy) => ({
        id: policy.id,
        name:
          policy.name ??
          models.find((model) => model.id === policy.modelId)?.modelName ??
          "未命名策略",
        meta: policy.tenantId === null ? "平台策略" : "租户策略",
        value: isEnabled(policy.state) ? "生效" : "停用",
      }))
      .slice(0, 3);
    const agentRows = agents
      .map((agent) => ({
        id: agent.id,
        name: agent.agentName,
        meta: agent.agentType === "chat" ? "内容" : "业务",
        value:
          agent.visibility === "public"
            ? "公开"
            : agent.visibility === "internal"
              ? "内部"
              : "私有",
      }))
      .slice(0, 3);

    return [
      {
        title: "模型授权",
        summary: "策略、授权和配额。",
        detail: "按产品、租户和智能体观察模型授权与配额配置。",
        tone: "blue",
        href: "/model-grants",
        rankStyle: "medal",
        rows: policyRows,
      },
      {
        title: "技能市场",
        summary: "可调用能力接入状态。",
        detail: "当前以智能体可调用能力作为技能市场过渡口径。",
        tone: "blue",
        href: "/skills",
        rankStyle: "medal",
        rows: agentRows,
      },
    ] satisfies Array<{
      title: string;
      summary: string;
      detail: string;
      tone: Tone;
      href: string;
      rankStyle: "number" | "medal";
      rows: CapabilityServiceRow[];
    }>;
  }, [agents, modelPolicies, models]);

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
          description={`${globalPeriodLabel}聚合客户活跃、订阅收入、模型调用和平台稳定性，首页只保留运营判断需要的核心数字。`}
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

      {/* 四张一行，窄屏折两列。间距与其余卡组同为 16px。 */}
      <section
        className="grid gap-md sm:grid-cols-2 lg:grid-cols-4"
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
          description="按产品能力、方案组合、套餐层级和供给异常观察平台可售卖、可交付能力（当前快照）。"
        />
        <MetricGrid
          aria-label="产品供给指标"
          items={metricItems(productMetrics)}
        />
        <div className="grid items-stretch gap-md max-lg:grid-cols-1 lg:grid-cols-3">
          <ProductRankingCard
            title="产品能力排行"
            summary="默认前三，观察底层产品被订阅采用的强度。"
            href="/products"
            rows={productRankings.productTop}
          />
          <ProductRankingCard
            title="方案组合排行"
            summary="默认前三，观察场景方案的市场采用度。"
            href="/product-solutions"
            rows={productRankings.solutionTop}
          />
          <ProductRankingCard
            title="套餐层级排行"
            summary="默认前三，观察可售权益包的订阅使用。"
            href="/service-plans"
            rows={productRankings.tierTop}
          />
        </div>
      </section>

      <section className="grid gap-md" aria-label="能力与服务">
        <OverviewHeading
          icon="cloud"
          title="模型技能"
          description="观察服务运行、模型池、策略覆盖和技能市场，判断平台 AI 能力是否稳定、可控、可被业务调用（当前快照）。"
        />
        <MetricGrid
          aria-label="模型技能指标"
          items={metricItems(capabilityMetrics)}
        />
        <div className="grid items-stretch gap-md max-lg:grid-cols-1 lg:grid-cols-2">
          {capabilityPanels.map((panel) => (
            <ModelCategoryCard
              key={panel.title}
              title={panel.title}
              summary={panel.summary}
              detail={panel.detail}
              tone={panel.tone}
              href={panel.href}
              rankStyle={panel.rankStyle}
              rows={panel.rows}
            />
          ))}
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
            （2026-08-05）。同段的产品供给/模型技能也是"标题 + 一排卡"，这里只是
            多一层，用 level 3 的板块标题表达层级即可。 */}
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
            title="服务评价"
            description="服务满意度、产品评价和 SLA 达成。"
            action={<DetailLink href="/tickets" />}
          >
            <MetricGrid
              aria-label="服务评价指标"
              columns={3}
              items={metricItems(ratingMetrics)}
            />
          </Section>
        </div>
      </section>
    </ViewLayout>
  );
}
