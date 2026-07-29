"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Button, Icon } from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";
import type { Locale } from "@vxture/shared";
import {
  fetchAiModelGrants,
  fetchAiModels,
  fetchDashboardOverview,
  fetchDevServices,
  fetchProductAgents,
  fetchProductModelPolicies,
  fetchProductReleases,
  fetchProductSolutions,
} from "@/api/admin-bff";
import type { DashboardOverviewRecord } from "@/api/admin-bff";
import type {
  AiModelGrantRecord,
  AiModelRecord,
  DevServiceSnapshot,
  ProductAgentRecord,
  ProductModelPolicyRecord,
  ProductReleaseRecord,
  ProductSolutionRecord,
} from "@/entities/console";
import { formatAdminCompactCurrency } from "@/lib/admin-formatters";
import { useConsoleLocale } from "@/lib/ConsoleIntl";

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

interface SummaryMetric {
  label: string;
  value: string;
  secondary?: string;
  delta?: string;
  detail: string;
  tone?: Tone;
}

interface ProductRankingRow {
  id: string;
  name: string;
  meta: string;
  subscriptions: number;
  monthlyNew: number;
  priceTag?: string;
}

interface ProductMetric extends SummaryMetric {
  icon: IconName;
  tags: Array<{ label: string; value: string; tone?: "neutral" | "warning" }>;
}

interface ModelMetric extends SummaryMetric {
  icon: IconName;
  tags: Array<{ label: string; value: string; tone?: "neutral" | "warning" }>;
  badges?: string[];
}

interface ServiceMetric extends SummaryMetric {
  icon: IconName;
  display?: "stars" | "text";
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
  placeholder?: boolean;
}

const periodOptions = [
  { key: "recent30", label: "近30天" },
  { key: "total", label: "总计" },
  { key: "year", label: "年度" },
  { key: "quarter", label: "季度" },
  { key: "month", label: "月度" },
] satisfies Array<{ key: PeriodKey; label: string }>;

const periodScale = {
  recent30: 1,
  total: 8.4,
  year: 6.2,
  quarter: 2.7,
  month: 0.92,
} satisfies Record<PeriodKey, number>;

function isRecentlyUpdated(value: string) {
  const updatedAt = new Date(value).getTime();
  if (!Number.isFinite(updatedAt)) return false;

  const days = (Date.now() - updatedAt) / 86_400_000;
  return days >= 0 && days <= 30;
}

function scalePeriodValue(value: number, period: PeriodKey) {
  return Math.max(0, Math.round(value * periodScale[period]));
}

function periodReleaseUpdateCount(
  baseCount: number,
  totalCount: number,
  period: PeriodKey,
) {
  if (period === "total") return totalCount;
  if (period === "year")
    return Math.min(
      totalCount,
      Math.max(baseCount, scalePeriodValue(baseCount, period)),
    );

  return Math.min(totalCount, scalePeriodValue(baseCount, period));
}

function isThirdPartyProduct(release: ProductReleaseRecord) {
  const productCode = release.productCode.toLowerCase();

  return (
    release.releaseType === "custom" ||
    ["partner", "provider", "third"].some((marker) =>
      productCode.includes(marker),
    )
  );
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

function scaleProductOwnershipCounts(
  baseCounts: ReturnType<typeof productOwnershipCounts>,
  totalCounts: ReturnType<typeof productOwnershipCounts>,
  period: PeriodKey,
) {
  const owned = periodReleaseUpdateCount(
    baseCounts.owned,
    totalCounts.owned,
    period,
  );
  const thirdParty = periodReleaseUpdateCount(
    baseCounts.thirdParty,
    totalCounts.thirdParty,
    period,
  );

  return {
    total: owned + thirdParty,
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

function modelConfigNumber(model: AiModelRecord, keys: readonly string[]) {
  if (!model.config) return null;

  for (const key of keys) {
    const value = model.config[key];

    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(/,/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return null;
}

// TD-036: no usage/token-tracking table exists anywhere for models (the
// write path was never built — see services/model/platform's own schema
// comment). model.config almost never carries these keys in practice; when
// it doesn't, return null (no data) instead of the old deterministic-hash
// fake number — a stable-looking number is still a fabricated one.
function modelTokenCalls(model: AiModelRecord, period: PeriodKey) {
  const baseValue = modelConfigNumber(model, [
    "periodTokens",
    "tokenCalls",
    "tokenUsage",
    "totalTokens",
    "tokens",
    "usedTokens",
  ]);
  if (baseValue === null) return null;

  return scalePeriodValue(baseValue, period);
}

function formatTokenCount(value: number) {
  return value.toLocaleString("en-US");
}

function serviceStatus(service: DevServiceSnapshot) {
  if (service.stopping) return "停止中";
  if (service.listening && service.healthy) return "健康";
  if (service.listening) return "未就绪";
  return "离线";
}

function serviceMaxDuration(service: DevServiceSnapshot) {
  return Math.max(0, ...service.health.map((check) => check.durationMs));
}

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

function capabilityPolicyCoverage(
  policies: ProductModelPolicyRecord[],
  grants: AiModelGrantRecord[],
) {
  const definedPolicies = policies.filter(
    (policy) => policy.isDefined && policy.isActive,
  ).length;
  const activeGrants = grants.filter((grant) => grant.isActive).length;
  const total = policies.length + grants.length;
  const active = definedPolicies + activeGrants;

  return {
    total,
    active,
    pending: Math.max(0, total - active),
    rate: Math.round((active / Math.max(1, total)) * 100),
  };
}

function riskTagTone(value: number): "neutral" | "warning" {
  return value > 0 ? "warning" : "neutral";
}

function fillCapabilityRows(rows: CapabilityServiceRow[], prefix: string) {
  if (rows.length >= 3) return rows.slice(0, 3);

  return [
    ...rows,
    ...Array.from({ length: 3 - rows.length }, (_, index) => ({
      id: `${prefix}-placeholder-${index}`,
      name: "待接入",
      meta: "暂无数据",
      value: "—",
      placeholder: true,
    })),
  ];
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
      tone: "blue",
      icon: "chat-circle",
    },
    {
      label: "已完成",
      value: resolved.toLocaleString("en-US"),
      detail: `${label}已完成（resolved/closed）${resolved.toLocaleString("en-US")}。`,
      tone: "green",
      icon: "success",
    },
    {
      label: "进行中",
      value: inProgress.toLocaleString("en-US"),
      detail: `${label}进行中（open/in_progress/reopened）${inProgress.toLocaleString("en-US")}。`,
      tone: "cyan",
      icon: "clock",
    },
    {
      label: "已搁置",
      value: pending.toLocaleString("en-US"),
      detail: `${label}已搁置（pending）${pending.toLocaleString("en-US")}。`,
      tone: "amber",
      icon: "warning",
    },
  ] satisfies ServiceMetric[];
}

// TD-036: no rating/CSAT/SLA-aggregate table exists in the schema (only a
// per-ticket satisfaction_score, not a service/product-level aggregate) —
// show an honest unavailable state rather than a fabricated star rating.
function ratingMetricsFor(_overview: DashboardOverviewRecord) {
  const unavailable = {
    value: "—",
    detail:
      "数据源待建设：平台暂无服务/产品评价聚合表，仅工单级评分字段，无法汇总展示。",
  };

  return [
    {
      label: "服务评价",
      ...unavailable,
      tone: "blue",
      icon: "star",
      display: "text",
    },
    {
      label: "产品评价",
      ...unavailable,
      tone: "blue",
      icon: "medal",
      display: "text",
    },
    {
      label: "SLA",
      ...unavailable,
      tone: "blue",
      icon: "shield-check",
      display: "text",
    },
  ] satisfies ServiceMetric[];
}

function metricToneClass(tone: Tone = "blue") {
  return `admin-overview-tone admin-overview-tone--${tone}`;
}

function pulseTagToneClass(tone?: Tone) {
  return tone ? `admin-overview-pulse__tag--${tone}` : undefined;
}

function DetailTip({ detail }: { detail: string }) {
  return (
    <span className="admin-overview-tip">
      <Button variant="ghost" size="icon" aria-label={detail} title={detail}>
        <Icon name="help" size="xs" fallback="placeholder" />
      </Button>
      <span role="tooltip">{detail}</span>
    </span>
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
  const activeIndex = Math.max(
    0,
    visibleOptions.findIndex((option) => option.key === value),
  );
  const switchStyle = {
    "--active-offset": `${activeIndex * 100}%`,
    "--item-count": visibleOptions.length,
  } as CSSProperties;

  return (
    <div
      className="admin-overview-period"
      role="tablist"
      aria-label="统计周期"
      style={switchStyle}
    >
      {visibleOptions.map((option) => (
        <Button
          key={option.key}
          variant={value === option.key ? "secondary" : "ghost"}
          size="sm"
          role="tab"
          aria-selected={value === option.key}
          className={
            value === option.key
              ? "admin-overview-period__item admin-overview-period__item--active"
              : "admin-overview-period__item"
          }
          onClick={() => onChange(option.key)}
        >
          {option.label}
        </Button>
      ))}
    </div>
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
  period: PeriodKey;
  onPeriodChange: (next: PeriodKey) => void;
  level?: "page" | "section";
}) {
  const TitleTag = level === "page" ? "h1" : "h2";

  return (
    <div
      className={`admin-overview-heading ${level === "page" ? "admin-overview-heading--page" : ""}`}
    >
      <span className="admin-overview-heading__icon" aria-hidden="true">
        <Icon name={icon} size="lg" fallback="placeholder" />
      </span>
      <div className="admin-overview-heading__copy">
        <TitleTag>{title}</TitleTag>
        <p>{description}</p>
      </div>
      <PeriodSwitch
        value={period}
        options={["recent30", "total", "year", "quarter", "month"]}
        onChange={onPeriodChange}
      />
    </div>
  );
}

function OverviewPulseCard({ metric }: { metric: OverviewPulseMetric }) {
  return (
    <article
      className={`admin-overview-pulse__item ${metricToneClass(metric.tone)}`}
    >
      <span className="admin-overview-pulse__label">
        {metric.title}
        <DetailTip detail={metric.detail} />
      </span>
      <div className="admin-overview-pulse__line">
        {metric.rating ? (
          <span className="admin-overview-pulse__rating">
            <RatingStars value={metric.rating} />
            <MetricValue value={metric.value} />
          </span>
        ) : (
          <MetricValue
            value={metric.value}
            className="admin-overview-pulse__value"
          />
        )}
        <span className="admin-overview-pulse__tags">
          {metric.tags.map((tag) => (
            <em
              className={pulseTagToneClass(tag.tone)}
              key={`${tag.label ?? "value"}-${tag.value}`}
            >
              {tag.label ? `${tag.label} ` : ""}
              {tag.value}
            </em>
          ))}
        </span>
      </div>
    </article>
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

function MetricValue({
  value,
  className,
  danger,
  as = "strong",
}: {
  value: string;
  className?: string;
  danger?: boolean;
  as?: "strong" | "b";
}) {
  const valueParts = splitMetricValue(value);
  const Tag = as;
  const classNames = [
    "admin-overview-metric-value",
    className,
    danger ? "admin-overview-metric-value--danger" : undefined,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Tag className={classNames}>
      {valueParts.prefix}
      {valueParts.number}
      {valueParts.unit ? <small>{valueParts.unit}</small> : null}
    </Tag>
  );
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

function BusinessMetricCard({ metric }: { metric: BusinessCardMetric }) {
  return (
    <article
      className={`admin-overview-business-card ${metricToneClass(metric.tone)}`}
    >
      <span className="admin-overview-business-card__icon" aria-hidden="true">
        <Icon name={metric.icon} size="lg" fallback="placeholder" />
      </span>
      <div className="admin-overview-business-card__main">
        <span>
          {metric.label}
          <DetailTip detail={metric.detail} />
        </span>
        <span className="admin-overview-business-card__value-line">
          <MetricValue
            value={metric.value}
            danger={isNegativeDisplayValue(metric.value)}
          />
          {metric.valueTag ? <em>{metric.valueTag}</em> : null}
        </span>
      </div>
      <div className="admin-overview-business-card__minor">
        {metric.minor.map((item) => (
          <div
            key={item.label}
            className={`admin-overview-business-card__minor-item ${item.tone === "rose" ? "admin-overview-business-card__minor-item--danger" : ""}`}
          >
            <small>{item.label}</small>
            <span className="admin-overview-business-card__minor-value">
              {displayMinorValue(item.label, item.value)}
            </span>
          </div>
        ))}
      </div>
    </article>
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
    <section
      className={`admin-overview-business-panel ${metricToneClass(panel.tone)}`}
      aria-label={panel.title}
    >
      <div className="admin-overview-business-panel__header">
        <div className="admin-overview-business-panel__header-left">
          <h3>{panel.title}</h3>
          <Link
            className="admin-overview-business-panel__chart"
            href={`/usage-metering?period=${panel.period}&scope=${encodeURIComponent(panel.title)}`}
            title={`${panel.title}图形化显示`}
          >
            <Icon name="chart-bar" size="sm" fallback="placeholder" />
          </Link>
        </div>
        <Link
          className="admin-overview-business-panel__detail"
          href={panel.detailHref}
        >
          详情
        </Link>
      </div>
      <div className="admin-overview-business-panel__cards">
        {businessCardMetrics(panel, overview, locale).map((metric) => (
          <BusinessMetricCard key={metric.label} metric={metric} />
        ))}
      </div>
    </section>
  );
}

function ProductMetricCard({ metric }: { metric: ProductMetric }) {
  return (
    <article
      className={`admin-overview-product-metric ${metricToneClass(metric.tone)}`}
    >
      <span className="admin-overview-product-metric__icon" aria-hidden="true">
        <Icon name={metric.icon} size="lg" fallback="placeholder" />
      </span>
      <div className="admin-overview-product-metric__main">
        <span className="admin-overview-product-metric__label">
          {metric.label}
          <DetailTip detail={metric.detail} />
        </span>
        <div className="admin-overview-product-metric__line">
          <MetricValue
            value={metric.value}
            className="admin-overview-product-metric__value"
          />
          <span className="admin-overview-product-metric__tags">
            {metric.tags.map((tag) => (
              <em
                key={`${tag.label}-${tag.value}`}
                className={
                  tag.tone
                    ? `admin-overview-metric-tag--${tag.tone}`
                    : undefined
                }
              >
                {tag.label} {tag.value}
              </em>
            ))}
          </span>
        </div>
      </div>
    </article>
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
    <article
      className={`admin-overview-product-ranking ${metricToneClass(tone)}`}
    >
      <div className="admin-overview-product-ranking__header">
        <div>
          <div className="admin-overview-card-title-line">
            <h3>{title}</h3>
            <DetailTip detail={detail} />
          </div>
          <p>{summary}</p>
        </div>
        <Link href={href}>详情</Link>
      </div>
      <div className="admin-overview-product-ranking__rows">
        {rows.length === 0 ? (
          <p className="admin-overview-model-category__empty">
            数据源待建设：暂无产品供给排行数据。
          </p>
        ) : (
          rows.map((item, index) => (
            <div key={item.id} className="admin-overview-product-ranking__row">
              <span
                className={`admin-overview-product-ranking__medal admin-overview-product-ranking__medal--${index + 1}`}
                role="img"
                aria-label={`第 ${index + 1} 名`}
              />
              <div>
                <strong>{item.name}</strong>
                <small>
                  {item.meta} · 新增 +{item.monthlyNew.toLocaleString("en-US")}
                </small>
              </div>
              <span className="admin-overview-product-ranking__value-line">
                <MetricValue
                  value={item.subscriptions.toLocaleString("en-US")}
                  as="b"
                />
                {item.priceTag ? <em>{item.priceTag}</em> : null}
              </span>
            </div>
          ))
        )}
      </div>
    </article>
  );
}

function ModelMetricCard({ metric }: { metric: ModelMetric }) {
  return (
    <article
      className={`admin-overview-model-metric ${metricToneClass(metric.tone)}`}
    >
      <span className="admin-overview-model-metric__icon" aria-hidden="true">
        <Icon name={metric.icon} size="lg" fallback="placeholder" />
      </span>
      <div className="admin-overview-model-metric__main">
        <span className="admin-overview-model-metric__label">
          {metric.label}
          {metric.badges?.map((badge) => (
            <em key={badge}>{badge}</em>
          ))}
          <DetailTip detail={metric.detail} />
        </span>
        <div className="admin-overview-model-metric__line">
          <MetricValue
            value={metric.value}
            className="admin-overview-model-metric__value"
          />
          <span className="admin-overview-model-metric__tags">
            {metric.tags.map((tag) => (
              <em
                key={`${tag.label}-${tag.value}`}
                className={
                  tag.tone
                    ? `admin-overview-metric-tag--${tag.tone}`
                    : undefined
                }
              >
                {tag.label} {tag.value}
              </em>
            ))}
          </span>
        </div>
      </div>
    </article>
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
    <article
      className={`admin-overview-model-category ${metricToneClass(tone)}`}
    >
      <div className="admin-overview-model-category__header">
        <div>
          <div className="admin-overview-card-title-line">
            <h3>{title}</h3>
            <DetailTip detail={detail} />
          </div>
          <p>{summary}</p>
        </div>
        {href ? <Link href={href}>详情</Link> : null}
      </div>
      <div className="admin-overview-model-category__rows">
        {rows.length > 0 ? (
          rows.map((row, index) => (
            <div
              key={row.id}
              className={
                row.placeholder
                  ? "admin-overview-model-category__row admin-overview-model-category__row--placeholder"
                  : "admin-overview-model-category__row"
              }
            >
              <span
                className={
                  rankStyle === "medal"
                    ? `admin-overview-product-ranking__medal admin-overview-product-ranking__medal--${index + 1}`
                    : undefined
                }
                role={rankStyle === "medal" ? "img" : undefined}
                aria-label={
                  rankStyle === "medal" ? `第 ${index + 1} 名` : undefined
                }
              >
                {rankStyle === "number" ? index + 1 : null}
              </span>
              <div>
                <strong>{row.name}</strong>
                <small>
                  <span>{row.meta}</span>
                  <em>{row.value}</em>
                </small>
              </div>
            </div>
          ))
        ) : (
          <p className="admin-overview-model-category__empty">暂无数据</p>
        )}
      </div>
    </article>
  );
}

function ServiceBlock({
  title,
  summary,
  href,
  tone,
  children,
}: {
  title: string;
  summary: string;
  href: string;
  tone: Tone;
  children: ReactNode;
}) {
  return (
    <article
      className={`admin-overview-service-block ${metricToneClass(tone)}`}
    >
      <div className="admin-overview-service-block__header">
        <div>
          <h3>{title}</h3>
          <p>{summary}</p>
        </div>
        <Link href={href}>详情</Link>
      </div>
      {children}
    </article>
  );
}

function ServiceMetricCard({ metric }: { metric: ServiceMetric }) {
  return (
    <article
      className={`admin-overview-service-metric ${metricToneClass(metric.tone)}`}
    >
      <span className="admin-overview-service-metric__icon" aria-hidden="true">
        <Icon name={metric.icon} size="lg" fallback="placeholder" />
      </span>
      <div className="admin-overview-service-metric__main">
        <span>
          {metric.label}
          <DetailTip detail={metric.detail} />
        </span>
        {metric.display === "stars" ? (
          <div className="admin-overview-service-metric__rating-line">
            <RatingStars value={Number(metric.value)} />
            <MetricValue value={metric.value} />
          </div>
        ) : (
          <MetricValue value={metric.value} />
        )}
      </div>
      {metric.display === "text" ? <small>达成率</small> : null}
    </article>
  );
}

function RatingStars({ value }: { value: number }) {
  const rounded = Math.round(value);

  return (
    <span className="admin-overview-stars" aria-label={`${value} 星`}>
      {Array.from({ length: 5 }, (_, index) => (
        <span
          key={index}
          className={
            index < rounded
              ? "admin-overview-stars__item admin-overview-stars__item--active"
              : "admin-overview-stars__item"
          }
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
  const locale = useConsoleLocale();
  const [models, setModels] = useState<AiModelRecord[]>([]);
  const [modelGrants, setModelGrants] = useState<AiModelGrantRecord[]>([]);
  const [modelPolicies, setModelPolicies] = useState<
    ProductModelPolicyRecord[]
  >([]);
  const [agents, setAgents] = useState<ProductAgentRecord[]>([]);
  const [services, setServices] = useState<DevServiceSnapshot[]>([]);
  const [releases, setReleases] = useState<ProductReleaseRecord[]>([]);
  const [solutions, setSolutions] = useState<ProductSolutionRecord[]>([]);
  const [globalPeriod, setGlobalPeriod] = useState<PeriodKey>("recent30");
  const [businessPeriod, setBusinessPeriod] = useState<PeriodKey>("recent30");
  const [productPeriod, setProductPeriod] = useState<PeriodKey>("recent30");
  const [modelPeriod, setModelPeriod] = useState<PeriodKey>("recent30");
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
  const productPeriodLabel = periodLabelOf(productPeriod);
  const modelPeriodLabel = periodLabelOf(modelPeriod);
  const servicePeriodLabel = periodLabelOf(servicePeriod);

  function handleGlobalPeriodChange(next: PeriodKey) {
    setGlobalPeriod(next);
    setBusinessPeriod(next);
    setProductPeriod(next);
    setModelPeriod(next);
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

    Promise.all([
      fetchAiModels(true),
      fetchAiModelGrants(),
      fetchProductModelPolicies(),
      fetchProductAgents(),
      fetchDevServices().catch(() => [] as DevServiceSnapshot[]),
      fetchProductReleases(),
      fetchProductSolutions(),
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
    const releaseTotalCounts = productOwnershipCounts(releases);
    const recentUpdatedCounts = productOwnershipCounts(
      releases.filter((release) => isRecentlyUpdated(release.updatedAt)),
    );
    const versionUpdateCounts = scaleProductOwnershipCounts(
      recentUpdatedCounts,
      releaseTotalCounts,
      productPeriod,
    );
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
        detail: `产品能力是平台可被方案编排的底层产品供给，累计 ${productTotalCounts.total} 个，生效 ${activeProductCount} 个，自有 ${productTotalCounts.owned} 个，三方 ${productTotalCounts.thirdParty} 个；${productPeriodLabel}版本更新 ${versionUpdateCounts.total} 次。`,
        tone: "blue",
        icon: "database",
        tags: [
          { label: "生效", value: String(activeProductCount) },
          { label: "更新", value: String(versionUpdateCounts.total) },
        ],
      },
      {
        label: "方案组合",
        value: String(solutionCounts.total),
        detail: `方案组合承接行业、场景和客户分层，当前方案 ${solutionCounts.total} 个，生效 ${solutionCounts.active} 个，覆盖 ${solutionCounts.industryCount} 个行业。`,
        tone: "blue",
        icon: "workflow",
        tags: [
          { label: "生效", value: String(solutionCounts.active) },
          { label: "行业", value: String(solutionCounts.industryCount) },
        ],
      },
      {
        label: "套餐层级",
        value: String(tierCounts.total),
        detail: `套餐层级是方案下可售卖、可授权的权益包，当前套餐 ${tierCounts.total} 个，生效 ${tierCounts.active} 个，公开 ${tierCounts.public} 个。`,
        tone: "blue",
        icon: "cube",
        tags: [
          { label: "生效", value: String(tierCounts.active) },
          { label: "公开", value: String(tierCounts.public) },
        ],
      },
      {
        label: "供给异常",
        value: String(abnormalCounts.total),
        detail: `供给异常用于观察会影响售卖或交付的非正常状态：停用产品 ${abnormalCounts.stoppedProducts} 个，异常方案 ${abnormalCounts.abnormalSolutions} 个，未生效套餐 ${abnormalCounts.inactiveTiers} 个。`,
        tone: abnormalCounts.total > 0 ? "amber" : "blue",
        icon: "warning",
        tags: [
          { label: "产品", value: String(abnormalCounts.stoppedProducts) },
          { label: "套餐", value: String(abnormalCounts.inactiveTiers) },
        ],
      },
    ] satisfies ProductMetric[];
  }, [productPeriod, productPeriodLabel, releases, solutions]);

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
      models.filter((model) => model.isActive),
    );
    const abnormalModelCounts = modelOwnershipCounts(
      models.filter(isModelAbnormal),
    );
    const tokenCallsPerModel = models.map((model) =>
      modelTokenCalls(model, modelPeriod),
    );
    const hasTokenData = tokenCallsPerModel.some((value) => value !== null);
    const totalTokenCalls = tokenCallsPerModel.reduce<number>(
      (total, value) => total + (value ?? 0),
      0,
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
                ? ("amber" as const)
                : ("blue" as const),
            icon: "server" as const,
            tags: [
              {
                label: "异常",
                value: String(serviceHealth.abnormal),
                tone: riskTagTone(serviceHealth.abnormal),
              },
            ],
          }
        : {
            label: "服务监控",
            value: "—",
            detail:
              "数据源待建设：平台暂无真实基础设施健康/延迟监控落库，不展示编造数值。",
            tone: "blue" as const,
            icon: "server" as const,
            tags: [{ label: "状态", value: "待建设" }],
          },
      {
        label: "模型平台",
        value: String(totalModelCounts.total),
        detail: `${modelPeriodLabel}模型平台观察平台可调度模型资源池，模型总数 ${totalModelCounts.total} 个，生效模型 ${activeModelCounts.total} 个，接入异常 ${abnormalModelCounts.total} 个${hasTokenData ? `，Token 总量 ${formatTokenCount(totalTokenCalls)}` : "；Token 用量数据源待建设（无模型用量写路径）"}。`,
        tone: "blue",
        icon: "cloud",
        tags: [
          {
            label: "异常",
            value: String(abnormalModelCounts.total),
            tone: riskTagTone(abnormalModelCounts.total),
          },
          {
            label: "Token",
            value: hasTokenData ? formatTokenCount(totalTokenCalls) : "待建设",
          },
        ],
      },
      {
        label: "策略覆盖",
        value: String(policyCoverage.active),
        detail: `策略覆盖统计模型授权和租户授权的启用情况，当前有效策略 ${policyCoverage.active} 条，待配置或停用 ${policyCoverage.pending} 条。`,
        tone: policyCoverage.pending > 0 ? "amber" : "blue",
        icon: "shield-check",
        tags: [
          {
            label: "待配",
            value: String(policyCoverage.pending),
            tone: riskTagTone(policyCoverage.pending),
          },
        ],
      },
      {
        label: "技能市场",
        value: String(activeAgents),
        detail: `技能市场当前以智能体可调用能力作为过渡口径，启用 ${activeAgents} 个，公开 ${publicAgents} 个，异常或停用 ${inactiveAgents} 个。`,
        tone: inactiveAgents > 0 ? "amber" : "blue",
        icon: "cube",
        tags: [
          {
            label: "异常",
            value: String(inactiveAgents),
            tone: riskTagTone(inactiveAgents),
          },
        ],
      },
    ] satisfies ModelMetric[];
  }, [
    agents,
    modelGrants,
    modelPeriod,
    modelPeriodLabel,
    modelPolicies,
    models,
    services,
  ]);

  const capabilityPanels = useMemo(() => {
    const serviceRows = services.map((service) => ({
      id: service.id,
      name: service.name,
      meta: serviceStatus(service),
      value: `${serviceMaxDuration(service)}ms`,
    }));
    // TD-036: only rank models that actually carry a real token figure in
    // config — models with no usage data are excluded rather than ranked
    // by a fabricated zero; fillCapabilityRows() below pads the remainder
    // with an honest "待接入/暂无数据" placeholder when this list is short.
    const modelRows = models
      .map((model) => ({
        id: model.id,
        name: model.modelName,
        meta: `${model.provider} · ${model.isActive ? "启用" : "停用"}`,
        tokenCalls: modelTokenCalls(model, modelPeriod),
      }))
      .filter(
        (row): row is typeof row & { tokenCalls: number } =>
          row.tokenCalls !== null,
      )
      .map((row) => ({ ...row, value: formatTokenCount(row.tokenCalls) }))
      .sort((left, right) => right.tokenCalls - left.tokenCalls)
      .slice(0, 3);
    const policyRows = modelPolicies
      .map((policy) => ({
        id: policy.id,
        name: policy.scopeName,
        meta: policy.agentName ?? "全部智能体",
        value: policy.isActive && policy.isDefined ? "生效" : "待配置",
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
        title: "服务监控",
        summary: "运行、探针和响应时间。",
        detail: "查看服务运行、探针响应和异常状态。",
        tone: "blue",
        href: "/service-monitor",
        rankStyle: "number",
        // TD-036: no real production infra-monitoring table exists —
        // serviceRows is only ever populated from a local dev-tools panel
        // unreachable in production, so it's always empty there. No fake
        // fallback rows; fillCapabilityRows() renders the honest empty state.
        rows: fillCapabilityRows(
          serviceRows
            .sort(
              (left, right) =>
                Number.parseInt(right.value.replace(/\D/g, ""), 10) -
                Number.parseInt(left.value.replace(/\D/g, ""), 10),
            )
            .slice(0, 3),
          "service",
        ),
      },
      {
        title: "模型平台",
        summary: "Token 调用量前三。",
        detail: "按 Token 调用量观察模型平台后的真实使用强度。",
        tone: "blue",
        href: "/atlas",
        rankStyle: "medal",
        rows: fillCapabilityRows(modelRows, "model"),
      },
      {
        title: "模型授权",
        summary: "策略、授权和配额。",
        detail: "按产品、租户和智能体观察模型授权与配额配置。",
        tone: "blue",
        href: "/model-grants",
        rankStyle: "medal",
        rows: fillCapabilityRows(policyRows, "policy"),
      },
      {
        title: "技能市场",
        summary: "可调用能力接入状态。",
        detail: "当前以智能体可调用能力作为技能市场过渡口径。",
        tone: "blue",
        href: "/skills",
        rankStyle: "medal",
        rows: fillCapabilityRows(agentRows, "agent"),
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
  }, [agents, modelPeriod, modelPolicies, models, services]);

  const serviceMetrics = useMemo(
    () => serviceMetricsFor(serviceOverview),
    [serviceOverview],
  );
  const ratingMetrics = useMemo(
    () => ratingMetricsFor(serviceOverview),
    [serviceOverview],
  );

  return (
    <div className="vx-page-stack admin-overview">
      <header className="admin-overview-header">
        <OverviewHeading
          icon="squares-four"
          title="平台总览"
          description={`${globalPeriodLabel}聚合客户活跃、订阅收入、模型调用和平台稳定性，首页只保留运营判断需要的核心数字。`}
          period={globalPeriod}
          onPeriodChange={handleGlobalPeriodChange}
          level="page"
        />
      </header>

      <section className="admin-overview-pulse" aria-label="平台核心态势">
        {pulseMetrics.map((metric) => (
          <OverviewPulseCard key={metric.id} metric={metric} />
        ))}
      </section>

      <section className="admin-overview-section" aria-label="经营指标">
        <OverviewHeading
          icon="chart-bar"
          title="经营指标"
          description={`${periodLabelOf(businessPeriod)}观察客户增长、订阅转化和收入验证，优先看运营动作是否带来真实使用与商业信号。`}
          period={businessPeriod}
          onPeriodChange={setBusinessPeriod}
        />
        <div className="admin-overview-business-panels">
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

      <section className="admin-overview-section" aria-label="产品供给">
        <OverviewHeading
          icon="database"
          title="产品供给"
          description={`${productPeriodLabel}按产品能力、方案组合、套餐层级和供给异常观察平台可售卖、可交付能力。`}
          period={productPeriod}
          onPeriodChange={setProductPeriod}
        />
        <div className="admin-overview-product-metrics">
          {productMetrics.map((metric) => (
            <ProductMetricCard key={metric.label} metric={metric} />
          ))}
        </div>
        <div className="admin-overview-product-rankings">
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

      <section className="admin-overview-section" aria-label="能力与服务">
        <OverviewHeading
          icon="cloud"
          title="模型技能"
          description={`${modelPeriodLabel}观察服务运行、模型调用、策略覆盖和技能市场，判断平台 AI 能力是否稳定、可控、可被业务调用。`}
          period={modelPeriod}
          onPeriodChange={setModelPeriod}
        />
        <div className="admin-overview-model-metrics">
          {capabilityMetrics.map((metric) => (
            <ModelMetricCard key={metric.label} metric={metric} />
          ))}
        </div>
        <div className="admin-overview-model-categories">
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

      <section className="admin-overview-section" aria-label="服务与工单">
        <OverviewHeading
          icon="chat-circle"
          title="服务与工单"
          description={`${servicePeriodLabel}工单处理和服务评价分层展示。`}
          period={servicePeriod}
          onPeriodChange={setServicePeriod}
        />
        <div className="admin-overview-service-stack">
          <ServiceBlock
            title="工单统计"
            summary="工单总量、处理状态和搁置情况。"
            href="/tickets"
            tone="blue"
          >
            <div className="admin-overview-service-metrics admin-overview-service-metrics--tickets">
              {serviceMetrics.map((metric) => (
                <ServiceMetricCard key={metric.label} metric={metric} />
              ))}
            </div>
          </ServiceBlock>
          <ServiceBlock
            title="服务评价"
            summary="服务满意度、产品评价和 SLA 达成。"
            href="/tickets"
            tone="green"
          >
            <div className="admin-overview-service-metrics admin-overview-service-metrics--rating">
              {ratingMetrics.map((metric) => (
                <ServiceMetricCard key={metric.label} metric={metric} />
              ))}
            </div>
          </ServiceBlock>
        </div>
      </section>
    </div>
  );
}
