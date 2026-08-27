"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import Link from "next/link";
import {
  Button,
  EmptyState,
  EntryCard,
  LabeledValue,
  MetricGrid,
  PanelItem,
  PanelList,
  Section,
  SHELL_PANEL_HAIRLINE,
  TableTitleCell,
  ViewLayout,
} from "@vxture/design-system";
import type { IconName, StatusBadgeTone } from "@vxture/design-system";
import { fetchCommerceOverview } from "@/api/admin-bff";
import type {
  CommerceOverviewMetric,
  CommerceOverviewSnapshot,
} from "@/entities/console";
import { PageHeader } from "@/modules/shared/PageHeader";
import { PanelLinkItem } from "@/modules/shared/PanelLinkItem";
import { formatDate, formatNumber } from "@/modules/tenants/tenant-utils";
import { formatCurrency } from "./CommercialUtils";
import { toStatusTone } from "@/modules/shared/tone";

const quickLinks: Array<{
  href: string;
  label: string;
  description: string;
  icon: IconName;
}> = [
  {
    href: "/subscriptions",
    label: "订阅管理",
    description: "权益实例、续期、暂停和配额风险。",
    icon: "star",
  },
  {
    href: "/orders",
    label: "订单管理",
    description: "订单状态、支付确认和异常订单。",
    icon: "table",
  },
  {
    href: "/payments",
    label: "收款管理",
    description: "线下/线上收款台账与对账状态。",
    icon: "check",
  },
  {
    href: "/billing",
    label: "账单中心",
    description: "应收、调整、补录、作废与逾期跟进。",
    icon: "key",
  },
  {
    href: "/invoices",
    label: "发票管理",
    description: "线下开票登记、寄送交付和红冲。",
    icon: "table",
  },
  {
    href: "/usage-metering",
    label: "用量计费",
    description: "产品能力消耗、配额使用和超额风险。",
    icon: "graph",
  },
  {
    href: "/promotion-redemptions",
    label: "优惠核销",
    description: "账单减免、优惠使用和退回核销。",
    icon: "sparkles",
  },
];

function metricIcon(metric: CommerceOverviewMetric): IconName {
  if (metric.key === "subscriptions") return "star";
  if (metric.key === "payments") return "check";
  if (metric.key === "invoices") return "table";
  return "chart-bar";
}

function metricValue(metric: CommerceOverviewMetric) {
  if (typeof metric.amount === "number")
    return formatCurrency(metric.amount, metric.currency ?? "CNY");
  return formatNumber(metric.value);
}

/**
 * 金额型指标的读数是金额，笔数退成标；计数型指标读数本身就是笔数，不再重复。
 *
 * `hint` 不在这里——它是口径说明（"metering.subscriptions 中 status=active 的订阅数"
 * 这类），归 `MetricCard.help` 的 `?`。当成标挂出来，一整句表名条件会顶掉读数的位置。
 */
function metricTags(metric: CommerceOverviewMetric) {
  return typeof metric.amount === "number"
    ? [`${formatNumber(metric.value)} 笔`]
    : [];
}

type RiskTone = CommerceOverviewSnapshot["risks"][number]["tone"];

function riskIcon(tone: RiskTone): IconName {
  if (tone === "green") return "check";
  if (tone === "amber") return "clock";
  return "warning";
}

/**
 * 风险项的颜色此前挂在 `.vx-commerce-risk-item--{green,amber,rose}` 三个修饰类上，
 * 各自 `color-mix` 出一份底色。改用 DS 的语气名：底色/前景/描边三件由
 * `toneSurfaceClasses` 配好，暗色主题也已覆盖。
 */
function riskTone(tone: RiskTone): StatusBadgeTone {
  if (tone === "green") return "success";
  if (tone === "amber") return "warning";
  return "danger";
}

function OverviewMetricSummary({
  metrics,
}: {
  metrics: CommerceOverviewMetric[];
}) {
  return (
    <MetricGrid
      aria-label="商业总览统计"
      columns={5}
      items={metrics.map((metric) => ({
        id: metric.key,
        icon: metricIcon(metric),
        label: metric.label,
        value: metricValue(metric),
        help: metric.hint,
        tags: metricTags(metric),
        tone: toStatusTone(metric.tone),
      }))}
    />
  );
}

function RiskPanel({ snapshot }: { snapshot: CommerceOverviewSnapshot }) {
  const locale = useLocale();
  return (
    <Section
      aria-label="商业风险"
      className={`${SHELL_PANEL_HAIRLINE} min-w-0 pt-lg`}
      level={2}
      icon="warning"
      title="风险与待办"
      description="从账单、收款、发票和用量中抽取运营侧需要跟进的事项。"
      action={
        <span className="text-body-sm text-muted-foreground">
          生成 {formatDate(snapshot.generatedAt, locale)}
        </span>
      }
    >
      <PanelList>
        {snapshot.risks.map((risk) => (
          <PanelLinkItem
            key={risk.id}
            href={risk.href}
            icon={riskIcon(risk.tone)}
            tone={riskTone(risk.tone)}
            title={risk.title}
            description={risk.detail}
          />
        ))}
      </PanelList>
    </Section>
  );
}

function PlanRevenuePanel({
  snapshot,
}: {
  snapshot: CommerceOverviewSnapshot;
}) {
  return (
    <Section
      aria-label="套餐收入"
      className={`${SHELL_PANEL_HAIRLINE} min-w-0 pt-lg`}
      level={2}
      icon="chart-bar"
      title="套餐收入"
      description="按服务套餐汇总订阅数量与订阅应收（Σ subscriptions.pay_amount）。"
      action={
        <Button variant="link" size="sm" asChild>
          <Link href="/service-plans">套餐管理</Link>
        </Button>
      }
    >
      {/* C15: tierName / paidAmount / discountAmount removed — no source (tier not
          grouped; paidAmount was a dup of revenueAmount; discount never computed). */}
      <PanelList empty="暂无套餐收入数据">
        {snapshot.planRevenue.map((plan) => (
          <PanelItem
            key={plan.planName}
            main={
              <TableTitleCell
                title={plan.planName}
                description={`${formatNumber(plan.subscriptionCount)} 个订阅`}
              />
            }
            trail={
              <LabeledValue
                label="订阅应收"
                value={formatCurrency(plan.revenueAmount, plan.currency)}
                className="items-end"
              />
            }
          />
        ))}
      </PanelList>
    </Section>
  );
}

function QuickLinkPanel() {
  return (
    <Section
      aria-label="商业财务入口"
      className={`${SHELL_PANEL_HAIRLINE} min-w-0 pt-lg`}
      level={2}
      icon="squares-four"
      title="业务入口"
      description="商业财务域的运营台账入口，保持人工处理和规则配置边界清晰。"
    >
      <div className="grid min-w-0 grid-cols-1 gap-md sm:grid-cols-2 xl:grid-cols-4">
        {quickLinks.map((link) => (
          <EntryCard
            key={link.href}
            href={link.href}
            icon={link.icon}
            title={link.label}
            description={link.description}
          />
        ))}
      </div>
    </Section>
  );
}

export function CommerceOverviewPage() {
  const locale = useLocale();
  const [snapshot, setSnapshot] = useState<CommerceOverviewSnapshot | null>(
    null,
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchCommerceOverview()
      .then((item) => {
        if (active) setSnapshot(item);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const metricCount = useMemo(() => snapshot?.metrics.length ?? 0, [snapshot]);

  /* `ViewLayout` 上不能写 `max-w-none`（旧 CSS 里那条 `max-width: none`
     的字面对应物）：DS 注册了 `--space-none: 0px`，而 Tailwind v4 解
     `max-w-<名>` 时先查 `--spacing-*`、后查 `--container-*`，于是这个关键字
     变成了 `max-width: 0`——页面会塔成一字一行。坑记在
     `portals/website/assets/legacy-tokens/tokens-website.css`，它对所有消费方都在。
     `ViewLayout` 自己不带 max-width，所以不写就是满宽。 */
  return (
    <ViewLayout className="w-full">
      <PageHeader
        icon="chart-bar"
        eyebrow="商业分析"
        title="商业总览"
        description="运营管理平台的商业财务入口：聚合订阅、订单、收款、账单、发票、用量和优惠数据，辅助运营人员判断风险与跟进优先级。"
      />

      {snapshot ? <OverviewMetricSummary metrics={snapshot.metrics} /> : null}

      {!snapshot && !loading ? (
        <EmptyState
          title="暂未读取到商业分析数据"
          description="请确认商业 BFF 服务和数据库连接状态。"
        />
      ) : null}

      {loading && !snapshot ? (
        <p className="py-md text-center text-body-sm text-muted-foreground">
          正在读取商业财务快照
        </p>
      ) : null}

      {snapshot ? (
        <>
          <div className="grid min-w-0 grid-cols-1 items-start gap-xl xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <RiskPanel snapshot={snapshot} />
            <PlanRevenuePanel snapshot={snapshot} />
          </div>
          <QuickLinkPanel />
          <footer
            className={`${SHELL_PANEL_HAIRLINE} flex min-h-icon-xl items-center justify-between gap-md pt-sm pb-md text-body-sm text-muted-foreground`}
          >
            <span>已聚合 {formatNumber(metricCount)} 类指标</span>
            <strong className="font-semibold text-foreground">
              更新时间 {formatDate(snapshot.generatedAt, locale)}
            </strong>
          </footer>
        </>
      ) : null}
    </ViewLayout>
  );
}
