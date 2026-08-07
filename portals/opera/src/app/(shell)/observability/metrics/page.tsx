"use client";

/* Metrics — opera-top-level-design.md §7：Gateway / Provider / Endpoint
 * 三层服务指标。图表组件按 DS 判据归 domain-ui 排期，本期以指标卡呈现。 */

import { useState } from "react";
import {
  Banner,
  DataTable,
  MetricGrid,
  Section,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import { meteringByEndpoint } from "@/mocks/atlas";

const gateway = [
  {
    id: "qps",
    label: "Gateway QPS",
    value: "142",
    icon: "lightning",
    trend: "+11%",
    trendTone: "success",
  },
  { id: "tps", label: "Token TPS", value: "38.4K", icon: "stack" },
  {
    id: "lat",
    label: "P95 延迟",
    value: "412ms",
    icon: "timer",
    trend: "+38ms",
    trendTone: "warning",
  },
  {
    id: "err",
    label: "错误率",
    value: "0.42%",
    icon: "warning",
    trend: "+0.1pp",
    trendTone: "warning",
  },
] as const;

const providerMetrics = [
  { id: "ok", label: "Provider 成功率", value: "99.2%", icon: "success" },
  {
    id: "fo",
    label: "Failover 次数 / 24h",
    value: "17",
    icon: "arrows-down-up",
  },
  {
    id: "deg",
    label: "降级 Provider",
    value: "1",
    icon: "trend-down",
    tone: "warning",
  },
  { id: "probe", label: "健康探测通过", value: "23/24", icon: "waveform" },
] as const;

export default function MetricsPage() {
  /* 选择列全站占位（owner 定）：统计行暂无批量动作，列先在。 */
  const [selected, setSelected] = useState<readonly string[]>([]);

  return (
    <ViewLayout>
      <ViewHeader
        icon="chart-line-up"
        title="Metrics"
        description="所有请求必须可观测：Gateway、Provider、Endpoint 三层指标；链路追踪基于 OpenTelemetry。"
      />

      <Banner
        tone="info"
        title="趋势图排期"
        description="时序趋势图依赖图表组件（DS 判据归 domain-ui），随功能期接入；本期先给指标事实。"
      />

      <Section
        title="Gateway"
        icon="globe"
        level={2}
        description="入口网关的吞吐、时延与错误率——平台健康的第一读数。"
      >
        <MetricGrid items={[...gateway]} columns={4} />
      </Section>

      <Section
        title="Provider"
        icon="plugs-connected"
        level={2}
        description="上游供应商的成功率与故障切换；降级判定依据健康探测。"
      >
        <MetricGrid items={[...providerMetrics]} columns={4} />
      </Section>

      {/* §11 的第三层：Endpoint 只看请求数与 Token 数——延迟与成本归 Metering，
          同一个事实不在两个页面各给一份。 */}
      <Section
        title="Endpoint"
        icon="plug"
        level={2}
        description="各能力入口的调用量与 Token 事实；延迟与成本归 Metering。"
      >
        <DataTable
          columns={[
            { id: "code", header: "Endpoint", cell: (r) => r.dimension },
            {
              id: "req",
              header: "请求数",
              align: "right",
              cell: (r) => r.requests,
            },
            {
              id: "in",
              header: "Input Token",
              align: "right",
              cell: (r) => r.inputTokens,
            },
            {
              id: "out",
              header: "Output Token",
              align: "right",
              cell: (r) => r.outputTokens,
            },
          ]}
          rows={meteringByEndpoint}
          rowKey={(r) => r.id}
          selectedKeys={selected}
          onSelectionChange={setSelected}
          indexStart={1}
        />
      </Section>
    </ViewLayout>
  );
}
