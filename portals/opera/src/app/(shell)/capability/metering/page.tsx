"use client";

/* 用量计量 — Runos 能力调用的七轴用量汇总。
 *
 * 2026-08-14 接入（B5，起于 `vxture-runos#81`）。此前这是全平台唯一一处「上游已交付、
 * opera 未接」的面：runos 从 v0.5.0 起就在产，opera 侧零引用。
 *
 * 源头是 opera-bff 的 `GET /api/runos/audit/usage-summaries`，代理 runos 的
 * `/audit/usage-summaries`（`10-http-surface.md`）。它在**运行调用流之上聚合**，
 * 与「运行监控 · 调用日志」看的是同一批事实的两种粒度：那边是每一次调用，这里是求和。
 *
 * ── 四条上游契约，页面必须如实转达而不是替它抹平 ─────────────────────────────
 *
 * 1. **恰好返回 `limit` 行 = top-N 截断，此时总计是少算的。** 这是最容易出错的一条：
 *    截断后的合计看起来是个完整的数，没有任何东西提示它不是。所以 `rows.length ===
 *    limit` 时页面会明说，并且**不显示总计**——显示一个已知偏小的总数比不显示更糟。
 *
 * 2. **历史从首次部署开始，没有回填。** 早于那一天的调用不是"用量为零"，是从来没被
 *    记过。窗口拉得再早也变不出数据来。
 *
 * 3. **`none` 是可见的哨兵值，不是空**。M1 期没解析出维度的行被归到 `none` 这一组
 *    而不是被丢掉——所以七根轴的总数彼此相等（上游契约：no axis excludes rows）。
 *    页面把 `none` 照原样显示，不美化成「未知」：它是一个真实存在、可以去查的分组。
 *
 * 4. **`costAmount` 是运营视图，不是账单事实。** runos 自己在契约里写明它「不预判
 *    product_110 §6.8#1 的计费归属裁定」。这页显示它，但标题写「成本（运营口径）」，
 *    不写「金额」——两者在读的人心里是不同的东西。
 *
 * ── 列随轴变，不画一张七轴通用的宽表 ─────────────────────────────────────────
 *
 * 不属于当前轴的身份字段**是 `null` 而不是缺数据**：一行 provider 汇总本来就是跨所有
 * 租户求和的。所以每根轴只渲染它自己的身份列。两个例外由上游保证并利用起来：
 * `workspace` 行带 `tenantId`（于是能按平台规则做成租户主导的显示），`endpoint` 行带
 * `capabilityId`（端点嵌在能力里，单看端点 id 没有意义）。
 *
 * 不轮询（设计文件 §7.3：窗口聚合类按手动刷新）——窗口本身是按月的，秒级刷新没有意义。 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Banner,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  Icon,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  ListPageTemplate,
  MetricGrid,
  NativeSelect,
  Pagination,
  SegmentedControl,
  type IconName,
  useListPagination,
  useToast,
  ViewHeader,
} from "@vxture/design-system";
import { useTenancyDirectory } from "@/features/tenancy/directory";
import { WorkspaceCell } from "@/features/tenancy/WorkspaceCell";
import { api, OperaApiError } from "@/lib/api";

type UsageAxis =
  | "tenant"
  | "workspace"
  | "product"
  | "agent"
  | "provider"
  | "capability"
  | "endpoint";

interface UsageSummaryRow {
  dimension: UsageAxis;
  tenantId: string | null;
  workspaceId: string | null;
  productId: string | null;
  agentId: string | null;
  provider: string | null;
  capabilityId: string | null;
  endpointInstanceId: string | null;
  calls: number;
  allowedCalls: number;
  successCalls: number;
  /** decimal，字符串——不走 JS number 免得丢精度。 */
  costAmount: string;
}

interface UsageSummaryPage {
  dimension: UsageAxis;
  from: string;
  to: string;
  items: UsageSummaryRow[];
}

const AXES: {
  value: UsageAxis;
  label: string;
  icon: IconName;
  /** 这根轴回答的问题——轴名本身说不清它为什么存在。 */
  answers: string;
}[] = [
  {
    value: "workspace",
    label: "工作区",
    icon: "buildings",
    answers:
      "这次消耗记在谁头上。上游的默认轴，也是计量归属最细的那一层——工作区蕴含租户，所以这根轴同时答得出「哪个客户」。",
  },
  {
    value: "tenant",
    label: "租户",
    icon: "building",
    answers: "一个客户总共消耗了多少，不分工作区。",
  },
  {
    value: "product",
    label: "产品",
    icon: "package",
    answers:
      "哪个产品在调能力。产品是唯一授权主体（ADR-010），所以这根轴与授权口径对得上。",
  },
  {
    value: "agent",
    label: "Agent",
    icon: "agent",
    answers: "具体哪个 agent 实例在调——同一个产品下多个 agent 时，找异常用它。",
  },
  {
    value: "provider",
    label: "Provider",
    icon: "plugs-connected",
    answers: "第三方能力供给方的量，用于对账与合同谈判。",
  },
  {
    value: "capability",
    label: "能力",
    icon: "stack",
    answers: "哪个能力被调得最多。",
  },
  {
    value: "endpoint",
    label: "端点",
    icon: "tree-structure",
    answers:
      "同一个能力下哪个端点实例在承接流量。端点嵌在能力里，所以这根轴带能力 id 一起看。",
  },
];

const LIMITS = ["100", "500", "1000"] as const;

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

/** 当月 UTC 起止，与上游默认窗口一致——控件里先填上，免得人以为没设就是"全部"。 */
function currentMonth(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function formatWindow(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("zh-CN", { timeZone: "UTC" });
}

function downloadCsv(filename: string, rows: readonly string[][]) {
  const csv = rows
    .map((cols) => cols.map((c) => `"${c.replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 该轴那一列显示什么。`none` 原样透出——它是可以去查的真实分组，不是"未知"。 */
function axisIdentity(row: UsageSummaryRow): string {
  switch (row.dimension) {
    case "tenant":
      return row.tenantId ?? "—";
    case "workspace":
      return row.workspaceId ?? "—";
    case "product":
      return row.productId ?? "—";
    case "agent":
      return row.agentId ?? "—";
    case "provider":
      return row.provider ?? "—";
    case "capability":
      return row.capabilityId ?? "—";
    case "endpoint":
      return row.endpointInstanceId ?? "—";
  }
}

export default function CapabilityMeteringPage() {
  const tShared = useTranslations();
  const { toast } = useToast();
  const [axis, setAxis] = useState<UsageAxis>("workspace");
  const [window_, setWindow] = useState(currentMonth);
  const [limit, setLimit] = useState<string>("100");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState<UsageSummaryPage | null>(null);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [selected, setSelected] = useState<readonly string[]>([]);

  const reload = useCallback(async () => {
    setLoad({ kind: "loading" });
    const p = new URLSearchParams({
      groupBy: axis,
      from: window_.from,
      to: window_.to,
      limit,
    });
    try {
      const data = await api.get<UsageSummaryPage>(
        `/api/runos/audit/usage-summaries?${p.toString()}`,
      );
      setPage(data);
      setLoad({ kind: "ready" });
    } catch (error) {
      /* 上游对写错的轴与解析不了的日期都回 400 并说明原因——原样展示那句话，
         比换成「读取失败」有用得多。 */
      setLoad({
        kind: "error",
        message:
          error instanceof OperaApiError ? error.message : "读取用量汇总失败",
      });
    }
  }, [axis, window_, limit]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const rows = useMemo(() => page?.items ?? [], [page]);

  /* 工作区一律以租户为主导显示（规则见 features/tenancy/directory.ts）。只有
     workspace 轴需要查号台——其它轴的行 workspaceId 本来就是 null。 */
  const tenancy = useTenancyDirectory(
    rows.map((r) => r.tenantId).filter((v): v is string => !!v),
    rows.map((r) => r.workspaceId).filter((v): v is string => !!v),
  );

  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (kw === "") return rows;
    return rows.filter((r) => axisIdentity(r).toLowerCase().includes(kw));
  }, [rows, keyword]);

  const pager = useListPagination(visible, 20);
  const currentAxis = AXES.find((a) => a.value === axis) ?? AXES[0]!;

  /** 恰好取满 = top-N 截断，合计不可信（上游契约）。 */
  const truncated = rows.length === Number(limit);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        calls: acc.calls + r.calls,
        allowed: acc.allowed + r.allowedCalls,
        success: acc.success + r.successCalls,
      }),
      { calls: 0, allowed: 0, success: 0 },
    );
  }, [rows]);

  function exportCsv() {
    if (rows.length === 0) return;
    downloadCsv(`runos-usage-${axis}-${window_.from}_${window_.to}.csv`, [
      [currentAxis.label, "调用数", "放行数", "成功数", "成本（运营口径）"],
      ...rows.map((r) => [
        axisIdentity(r),
        String(r.calls),
        String(r.allowedCalls),
        String(r.successCalls),
        r.costAmount,
      ]),
      /* 截断时把这件事写进 CSV 本身：导出去的文件会脱离页面独自流传，
         而"这份数据是不全的"必须跟着它走。 */
      ...(truncated
        ? [
            ["", "", "", "", ""],
            [`⚠ 上游按 calls 倒序截断到 ${limit} 行，合计少算`],
          ]
        : []),
    ]);
    toast({ tone: "success", title: "已导出 CSV" });
  }

  const emptyState =
    load.kind === "loading" ? (
      <EmptyState
        title={tShared("common.loading")}
        description="正在读取用量汇总。"
      />
    ) : load.kind === "error" ? (
      <EmptyState
        title={tShared("common.loadFailed")}
        description={load.message}
        action={
          <Button variant="secondary" onClick={() => void reload()}>
            {tShared("common.retry")}
          </Button>
        }
      />
    ) : keyword.trim() !== "" ? (
      <EmptyState
        title="没有匹配的分组"
        description="关键词只在已取回的这些行里筛。"
      />
    ) : (
      <EmptyState
        icon="gauge"
        title="这个窗口没有用量"
        description="要么该时间段确实没有能力调用，要么它早于 runos 首次部署——历史不回填，早于那一天的调用从来没被记过，不是「用量为零」。"
      />
    );

  return (
    <ListPageTemplate
      header={
        <ViewHeader
          icon="gauge"
          title="用量计量"
          description="Runos 能力调用的用量汇总，七根聚合轴。在运行调用流之上求和——每一次调用的明细在「运行监控 · 调用日志」。只读：这里记的是调用事实，定价是 admin 商业层的事。"
          action={
            <div className="flex items-center gap-sm">
              <Button
                variant="secondary"
                onClick={() => void reload()}
                disabled={load.kind === "loading"}
              >
                <Icon name="refresh" size="sm" aria-hidden="true" />
                {tShared("common.refresh")}
              </Button>
              <Button
                variant="outline"
                onClick={exportCsv}
                disabled={rows.length === 0}
              >
                <Icon name="download" size="sm" aria-hidden="true" />
                导出 CSV
              </Button>
            </div>
          }
        />
      }
      summary={
        <div className="flex flex-col gap-sm">
          {truncated ? (
            /* 最重要的一条横幅。截断后的合计看起来是个完整的数，没有任何东西提示
               它不是——所以必须明说，而且下面的合计卡片会整体隐藏。 */
            <Banner
              tone="warning"
              title={`上游按调用数倒序截断到 ${limit} 行，合计不可信`}
              description="返回行数恰好等于上限，说明还有没取回的分组——此时任何总计都是少算的，所以这里不显示合计。要拿到完整数字：收窄窗口、加过滤条件，或把上限调高。"
            />
          ) : (
            <MetricGrid
              items={[
                {
                  id: "calls",
                  label: "调用数",
                  value: totals.calls.toLocaleString("zh-CN"),
                  icon: "waveform",
                },
                {
                  id: "allowed",
                  label: "放行数",
                  value: totals.allowed.toLocaleString("zh-CN"),
                  icon: "shield-check",
                  help: "通过裁决、真正跑起来的次数。调用数减放行数 = 被策略挡掉的。",
                },
                {
                  id: "success",
                  label: "成功数",
                  value: totals.success.toLocaleString("zh-CN"),
                  icon: "check",
                  help: "成功率按「成功 / 放行」算，不按「成功 / 调用」——被裁决挡掉的那些从来没跑过，算进分母会把一次严格的策略读成一次故障。",
                },
                {
                  id: "groups",
                  label: "分组数",
                  value: rows.length.toLocaleString("zh-CN"),
                  icon: "rows",
                },
              ]}
            />
          )}
          <Banner
            tone="info"
            title={
              page
                ? `窗口 ${formatWindow(page.from)} — ${formatWindow(page.to)}（UTC）· 按${currentAxis.label}聚合`
                : "读取中"
            }
            description={`${currentAxis.answers} 历史从 runos 首次部署起，不回填；没解析出维度的行归在可见的 none 分组里，所以七根轴的总数彼此相等。`}
          />
        </div>
      }
      filters={
        <FilterBar
          view="list"
          onViewChange={() => {}}
          cardsDisabledReason={tShared("common.cardsRetired")}
          count={
            visible.length === rows.length
              ? rows.length
              : `${visible.length} / ${rows.length}`
          }
          /* 聚合轴放左段而不是混进右边那串筛选里：右边每一个控件都是"在同一份数据里
             少看几行"，而换轴是**换一份数据**——列会跟着变。与模型侧计量页同一形态。 */
          scope={
            <SegmentedControl<UsageAxis>
              size="sm"
              ariaLabel="聚合轴"
              items={AXES.map((a) => ({
                value: a.value,
                label: a.label,
                icon: a.icon,
              }))}
              value={axis}
              onChange={(v) => {
                setAxis(v);
                setKeyword("");
                setSelected([]);
                pager.resetPage();
              }}
            />
          }
        >
          <InputGroup className="grow basis-media-3xl max-w-panel-sm">
            <InputGroupAddon>
              <Icon name="search" size="sm" aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              placeholder={`搜索${currentAxis.label}…`}
              aria-label="搜索分组"
              value={keyword}
              onChange={(e) => {
                setKeyword(e.target.value);
                pager.resetPage();
              }}
            />
          </InputGroup>
          <Input
            type="date"
            aria-label="起始日期（UTC）"
            className="w-fit"
            value={window_.from}
            onChange={(e) => setWindow({ ...window_, from: e.target.value })}
          />
          <Input
            type="date"
            aria-label="截止日期（UTC，不含）"
            className="w-fit"
            value={window_.to}
            onChange={(e) => setWindow({ ...window_, to: e.target.value })}
          />
          <NativeSelect
            wrapperClassName="w-fit"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            aria-label="返回上限"
          >
            {LIMITS.map((l) => (
              <option key={l} value={l}>
                上限 {l} 组
              </option>
            ))}
          </NativeSelect>
        </FilterBar>
      }
      table={
        <DataTable
          columns={[
            {
              id: "identity",
              header: currentAxis.label,
              cell: (r: UsageSummaryRow) =>
                /* workspace 轴走平台的租户主导规则——上游契约保证这根轴的行带
                   tenantId，所以这里拿得到租户名做主导部分。 */
                r.dimension === "workspace" ? (
                  <WorkspaceCell
                    directory={tenancy}
                    workspaceId={r.workspaceId}
                  />
                ) : (
                  <span className="flex flex-col gap-2xs">
                    <span className="font-mono text-code-sm text-foreground">
                      {axisIdentity(r)}
                    </span>
                    {/* 端点行带能力 id：单看端点实例 id 没有意义。 */}
                    {r.dimension === "endpoint" && r.capabilityId ? (
                      <span className="text-body-sm text-muted-foreground">
                        {r.capabilityId}
                      </span>
                    ) : null}
                    {axisIdentity(r) === "none" ? (
                      <Badge variant="outline" className="w-fit">
                        未解析维度
                      </Badge>
                    ) : null}
                  </span>
                ),
            },
            {
              id: "calls",
              header: "调用数",
              align: "right",
              width: "xs",
              cell: (r: UsageSummaryRow) => r.calls.toLocaleString("zh-CN"),
            },
            {
              id: "allowed",
              header: "放行数",
              align: "right",
              width: "xs",
              cell: (r: UsageSummaryRow) =>
                r.allowedCalls.toLocaleString("zh-CN"),
            },
            {
              id: "success",
              header: "成功数",
              align: "right",
              width: "xs",
              cell: (r: UsageSummaryRow) => (
                <span className="flex flex-col items-end gap-2xs">
                  <span>{r.successCalls.toLocaleString("zh-CN")}</span>
                  {/* 成功率由放行数而不是调用数算：被裁决挡掉的那些从来没跑过，
                      算进分母会把一次严格的策略读成一次故障。 */}
                  {r.allowedCalls > 0 ? (
                    <span className="text-body-sm text-muted-foreground">
                      {Math.round((r.successCalls / r.allowedCalls) * 100)}%
                    </span>
                  ) : null}
                </span>
              ),
            },
            {
              id: "cost",
              header: "成本（运营口径）",
              align: "right",
              width: "sm",
              cell: (r: UsageSummaryRow) => (
                <span className="font-mono text-code-sm">{r.costAmount}</span>
              ),
            },
          ]}
          rows={pager.pageRows}
          rowKey={(r: UsageSummaryRow) => `${r.dimension}:${axisIdentity(r)}`}
          selectedKeys={selected}
          onSelectionChange={setSelected}
          indexStart={pager.indexStart}
          footer={
            <Pagination
              className="w-full"
              page={pager.page}
              pageCount={pager.pageCount}
              total={rows.length}
              filteredTotal={visible.length}
              pageSize={pager.pageSize}
              onPageSizeChange={pager.onPageSizeChange}
              onPageChange={pager.onPageChange}
            />
          }
          empty={emptyState}
        />
      }
    />
  );
}
