"use client";

/* Metering — opera-atlas-design.md §10：事实计量（Request / Token / TTFT /
 * Raw Cost），四个聚合维度 Provider / Model / Endpoint / Tenant。
 *
 * 维度切换用 SegmentedControl 而不是下拉：四档全部可见、一次点击到位，
 * 而下拉要"点开—找—再点"。时间窗口反过来——它是次要旋钮，收进下拉。 */

import { useState } from "react";
import {
  ActionMenu,
  DataTable,
  MetricGrid,
  NativeSelect,
  Section,
  SegmentedControl,
  useToast,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import {
  meteringByEndpoint,
  meteringByModel,
  meteringByProvider,
  meteringByTenant,
  type MeteringRow,
} from "@/mocks/atlas";

const summary = [
  { id: "req", label: "总请求", value: "4.85M", icon: "gauge" },
  { id: "in", label: "Input Token", value: "8.81B", icon: "arrow-down" },
  { id: "out", label: "Output Token", value: "3.21B", icon: "arrow-up" },
  {
    id: "cost",
    label: "Raw Cost",
    value: "$29,880",
    icon: "coins",
    description: "事实成本；销售价格归 Admin",
  },
] as const;

type Dimension = "provider" | "model" | "endpoint" | "tenant";

/** 每档自带表头名与图标——第一列的含义随维度变，不能写死成"维度"。 */
const DIMENSIONS: ReadonlyArray<{
  value: Dimension;
  label: string;
  icon: "plugs-connected" | "brain" | "plug" | "building";
  rows: MeteringRow[];
}> = [
  {
    value: "provider",
    label: "Provider",
    icon: "plugs-connected",
    rows: meteringByProvider,
  },
  { value: "model", label: "Model", icon: "brain", rows: meteringByModel },
  {
    value: "endpoint",
    label: "Endpoint",
    icon: "plug",
    rows: meteringByEndpoint,
  },
  {
    value: "tenant",
    label: "Tenant",
    icon: "building",
    rows: meteringByTenant,
  },
];

export default function MeteringPage() {
  const { toast } = useToast();
  const [dimension, setDimension] = useState<Dimension>("provider");
  /* 选择列全站占位（owner 定）：聚合行暂无批量动作，列先在。 */
  const [selected, setSelected] = useState<readonly string[]>([]);
  const active =
    DIMENSIONS.find((d) => d.value === dimension) ?? DIMENSIONS[0]!;

  return (
    <ViewLayout>
      <ViewHeader
        icon="gauge"
        title="Metering"
        description="所有请求必须被计量。Opera 只记录事实（Raw Cost），不做定价。"
      />

      <MetricGrid items={[...summary]} columns={4} />

      <Section
        title={`按 ${active.label} 聚合`}
        icon={active.icon}
        level={2}
        description="同一份请求事实的四个切面：Provider / Model / Endpoint / Tenant。"
        action={
          <NativeSelect
            wrapperClassName="w-fit"
            defaultValue="30d"
            aria-label="时间窗口"
          >
            <option value="24h">近 24 小时</option>
            <option value="7d">近 7 天</option>
            <option value="30d">近 30 天</option>
          </NativeSelect>
        }
      >
        <SegmentedControl
          items={DIMENSIONS.map((d) => ({
            value: d.value,
            label: d.label,
            icon: d.icon,
          }))}
          value={dimension}
          onChange={(d) => {
            setDimension(d);
            // 换维度即换行集，旧选择随之失效。
            setSelected([]);
          }}
          ariaLabel="聚合维度"
          /* 默认铺满容器宽，四档挤在左边、右侧拖一条空轨道。收成内容宽。 */
          className="w-fit"
        />

        <DataTable
          columns={[
            { id: "dim", header: active.label, cell: (r) => r.dimension },
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
            {
              id: "ttft",
              header: "平均 TTFT",
              align: "right",
              cell: (r) => `${r.avgTtftMs}ms`,
            },
            {
              id: "cost",
              header: "Raw Cost",
              align: "right",
              cell: (r) => r.rawCost,
            },
          ]}
          rows={active.rows}
          rowKey={(r) => r.id}
          selectedKeys={selected}
          onSelectionChange={setSelected}
          indexStart={1}
          rowActions={(r) => (
            <ActionMenu
              label={`${r.dimension} 操作`}
              items={[
                {
                  id: "detail",
                  label: "查看明细",
                  icon: "chart-line-up",
                  onSelect: () =>
                    toast({
                      tone: "info",
                      title: `${r.dimension} 明细`,
                      description: "维度明细与趋势图随功能期接入。",
                    }),
                },
              ]}
            />
          )}
        />
      </Section>
    </ViewLayout>
  );
}
