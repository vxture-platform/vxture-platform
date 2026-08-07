"use client";

/* Dashboard — opera-top-level-design.md §10：平台状态 / Atlas 状态 / 请求统计。
 * 阅读顺序由 DashboardTemplate 焊死：先看数、再选路、最后处理事项。 */

import Link from "next/link";
import { useState } from "react";
import {
  Banner,
  Button,
  DashboardTemplate,
  DataTable,
  EntryCard,
  Icon,
  MetricGrid,
  Section,
  StatusBadge,
  TableTitleCell,
  ViewHeader,
} from "@vxture/design-system";
import { providers, logs } from "@/mocks/atlas";
import { LOG_LEVEL_META, RESOURCE_STATUS_META } from "@/lib/status";

const metrics = [
  {
    id: "req",
    label: "24h 请求",
    value: "4.85M",
    icon: "gauge",
    trend: "+6.2%",
    trendTone: "success",
  },
  {
    id: "token",
    label: "24h Token",
    value: "9.1B",
    icon: "stack",
    trend: "+3.8%",
    trendTone: "success",
  },
  {
    id: "latency",
    label: "TTFT P95",
    value: "412ms",
    icon: "timer",
    trend: "+38ms",
    trendTone: "warning",
  },
  {
    id: "cost",
    label: "24h 事实成本",
    value: "$1,208",
    icon: "coins",
    trend: "-2.1%",
    trendTone: "success",
  },
] as const;

export default function DashboardPage() {
  const degraded = providers.filter((p) => p.status === "degraded");
  /* 选择列全站占位（owner 定）：摘要表暂无批量动作，列先在。 */
  const [providerSel, setProviderSel] = useState<readonly string[]>([]);
  const [eventSel, setEventSel] = useState<readonly string[]>([]);

  return (
    <DashboardTemplate
      header={
        <ViewHeader
          icon="squares-four"
          title="Dashboard"
          description="平台状态、Atlas 状态与请求统计。Opera 记录事实成本，销售价格归 Admin。"
        />
      }
      metrics={<MetricGrid items={[...metrics]} columns={4} />}
      entries={
        <div className="grid gap-md sm:grid-cols-2 xl:grid-cols-3">
          <EntryCard
            href="/atlas/providers"
            icon="plugs-connected"
            title="Provider"
            meta={`${providers.filter((p) => p.status !== "disabled").length} 家在线`}
            description="模型供应商接入、健康检查与代理出口"
          />
          <EntryCard
            href="/atlas/router"
            icon="tree-structure"
            title="Router"
            meta="5 个 Endpoint"
            description="Primary / Failover 路由策略"
          />
          <EntryCard
            href="/observability/logs"
            icon="terminal"
            title="Logs"
            meta="1 条 ERROR / 1h"
            description="网关、路由与计量的运行日志"
          />
        </div>
      }
    >
      {degraded.length > 0 ? (
        <Banner
          tone="warning"
          title="Provider 降级"
          description={`${degraded.map((p) => p.name).join("、")} 延迟越限，Router 已自动切换 fallback；详见 Provider 健康页。`}
        />
      ) : null}

      <Section
        title="Provider 状态"
        icon="plugs-connected"
        level={2}
        description="各供应商的健康画像摘要；接入与启停到 Provider 页操作。"
        action={
          <Button asChild variant="ghost" size="md">
            <Link href="/atlas/providers">
              查看全部
              <Icon name="chevron-right" size="sm" aria-hidden="true" />
            </Link>
          </Button>
        }
      >
        <DataTable
          columns={[
            {
              id: "name",
              header: "Provider",
              cell: (r) => (
                <TableTitleCell
                  icon="plugs-connected"
                  title={r.name}
                  description={r.code}
                />
              ),
            },
            {
              id: "status",
              header: "状态",
              cell: (r) => (
                <StatusBadge tone={RESOURCE_STATUS_META[r.status].tone} dot>
                  {RESOURCE_STATUS_META[r.status].label}
                </StatusBadge>
              ),
            },
            {
              id: "models",
              header: "模型数",
              align: "right",
              cell: (r) => r.models,
            },
            {
              id: "latency",
              header: "P95 延迟",
              align: "right",
              cell: (r) => (r.latencyMs ? `${r.latencyMs}ms` : "—"),
            },
            {
              id: "success",
              header: "成功率",
              align: "right",
              cell: (r) => r.successRate,
            },
          ]}
          rows={providers}
          rowKey={(r) => r.id}
          selectedKeys={providerSel}
          onSelectionChange={setProviderSel}
          indexStart={1}
          rowActions={() => (
            /* 摘要行的操作从简：一键进 Provider 页处理。 */
            <Button
              asChild
              variant="ghost"
              size="md"
              aria-label="前往 Provider"
            >
              <Link href="/atlas/providers">
                <Icon name="arrow-right" size="sm" aria-hidden="true" />
              </Link>
            </Button>
          )}
        />
      </Section>

      <Section
        title="最近事件"
        icon="clock-counter-clockwise"
        level={2}
        description="近一小时的关键运行事件；完整检索与筛选进 Logs。"
        action={
          <Button asChild variant="ghost" size="md">
            <Link href="/observability/logs">
              查看全部
              <Icon name="chevron-right" size="sm" aria-hidden="true" />
            </Link>
          </Button>
        }
      >
        <DataTable
          columns={[
            { id: "time", header: "时间", cell: (r) => r.time },
            {
              id: "level",
              header: "级别",
              cell: (r) => (
                <StatusBadge tone={LOG_LEVEL_META[r.level].tone}>
                  {LOG_LEVEL_META[r.level].label}
                </StatusBadge>
              ),
            },
            { id: "source", header: "来源", cell: (r) => r.source },
            { id: "message", header: "内容", cell: (r) => r.message },
          ]}
          rows={logs.slice(0, 4)}
          rowKey={(r) => r.id}
          selectedKeys={eventSel}
          onSelectionChange={setEventSel}
          indexStart={1}
        />
      </Section>
    </DashboardTemplate>
  );
}
