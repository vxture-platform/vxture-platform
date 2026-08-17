"use client";

/* Metrics — opera-top-level-design.md §7：请求量 / 延迟 / 错误率等运行指标。
 *
 * 2026-08-12 诚实化：此前 gateway/providerMetrics 是页面里手写的虚构数组
 * （QPS/延迟/错误率），mocks/atlas.ts 的 meteringByProvider/Model/Endpoint 三个
 * 维度同样是虚构——Atlas 真实的 `/capability/usage-summaries` 只回传
 * tenant × cycleMonth 维度（Metering 页已接），没有 provider/model/endpoint
 * 细分，也没有任何网关侧 QPS/延迟/错误率导出（已提 liaison issue 给
 * vxture-atlas）。接假数据不如不接——这里换成两块真实存在的运行信号
 * （后台任务执行统计、webhook 投递队列深度）。
 *
 * 2026-08-12 补网关性能（liaison #245，vxture-atlas#147 已合并）：Atlas 交付了
 * `GET /capability/providers/performance`——但只到 provider 粒度，chat/stream
 * 流量为准，仍然没有 model/endpoint 级拆分，上面那句"暂无上游数据源"改成
 * "只有 Provider 粒度"，不整段撤掉——过度声称比继续留白更容易误导人。
 * attempts/successes/errors 是进程启动以来的累计计数器（Prometheus 语义），
 * 这里只展示原始快照，不在前端复刻求导数的假象。 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionMenu,
  Banner,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  Icon,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  MetricGrid,
  NativeSelect,
  Pagination,
  Section,
  StatusBadge,
  ViewHeader,
  ViewLayout,
  useListPagination,
  useToast,
  type StatusBadgeTone,
} from "@vxture/design-system";
import { api, OperaApiError } from "@/lib/api";

/**
 * `/capability/logs/summary` —— 窗口聚合的请求量 / 错误率 / 延迟分位。
 *
 * 2026-08-14（platform#257 §5）：byGroup 增加 `endpointCode` 与 `totalTokens`。
 * 此前这里的注释写着「Endpoint 维度 Atlas 没提供」并挂着验收清单——已交付，注释作废。
 *
 * **`endpointCode: null` 这一组必须保留，不能藏。** 这个端点的各组**必须加总等于
 * `overall`**，藏掉那一组就是少报。注意它与 Metering 页的做法**刻意相反**：那边的
 * endpoint 轴是把没走入口的流量**排除**（把没经过入口的流量算给某个入口是虚报），
 * 这边是**保留**（各组要能加回总数）。两处不一致是有意的，别"顺手统一"。
 */
interface LogSummaryBucket {
  requests: number;
  errors: number;
  errorRate: number | null;
  /**
   * 2026-08-14 新增（platform#257 §5）。注意 `overall.totalTokens` 恒为 0，见下方。
   *
   * **可选**：交付说明写明生产当时还是 `v0.3.1`，这些字段一个都不存在。缺失时显示
   * 「—」——把 undefined 交给 Intl.NumberFormat 会渲染成 `NaN`，那比空着更糟。
   */
  totalTokens?: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
}

interface LogSummary {
  windowStart: string;
  windowEnd: string;
  /**
   * **`overall.totalTokens` 恒为 0**，不是"这段时间没有 token"：它来自另一份不带
   * token 求和的聚合。靠把各组加起来倒推 = 给同一个数造第二个权威来源，所以页面
   * 上不设"总 Token"这一格，token 只在分组行里显示。
   */
  overall: LogSummaryBucket;
  byGroup: (LogSummaryBucket & {
    modelCode: string | null;
    providerCode: string | null;
    /**
     * `null` 与 `undefined` 在这里**含义完全不同**，不能混：
     *   `null`      = 真实的一组——调用方没走任何入口（直接点名 modelCode）
     *   `undefined` = 这台 Atlas 还没交付这一维，压根没按入口分过组
     * 把后者也渲染成「未走入口」，等于宣称全部流量都绕开了入口——一句彻头彻尾的
     * 假话，而且看起来完全正常。
     */
    endpointCode?: string | null;
  })[];
}

interface ProviderPerformanceRow {
  provider: string;
  attempts: number;
  successes: number;
  errors: number;
  errorRate: number | null;
  avgLatencyMs: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  lastObservedAt: string | null;
}

interface ProviderPerformanceSnapshot {
  generatedAt: string;
  processStartedAt: string;
  inFlightRequests: number;
  providers: ProviderPerformanceRow[];
}

function formatTime(iso: string | null): string {
  if (!iso) return "从未";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("zh-CN", { hour12: false });
}

function formatMs(ms: number | null): string {
  return ms == null ? "—" : `${Math.round(ms)}ms`;
}

function formatRate(rate: number | null): string {
  return rate == null ? "—" : `${(rate * 100).toFixed(1)}%`;
}

type JobStatus = "idle" | "running" | "success" | "failed";

const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  idle: "空闲",
  running: "运行中",
  success: "正常",
  failed: "异常",
};

function jobStatusTone(status: JobStatus): StatusBadgeTone {
  if (status === "success") return "success";
  if (status === "running") return "info";
  if (status === "failed") return "danger";
  return "neutral";
}

interface JobHeartbeatItem {
  jobName: string;
  status: JobStatus;
  lastDurationMs: number | null;
  runCount: number;
  failureCount: number;
}

interface WebhookQueueCounts {
  pending: number;
  delivering: number;
  delivered: number;
  failed: number;
  dead: number;
}

interface JobSchedulerSnapshot {
  jobs: JobHeartbeatItem[];
  queue: { counts: WebhookQueueCounts };
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

export default function MetricsPage() {
  const { toast } = useToast();
  const [snapshot, setSnapshot] = useState<JobSchedulerSnapshot | null>(null);
  const [perf, setPerf] = useState<ProviderPerformanceSnapshot | null>(null);
  const [perfLoad, setPerfLoad] = useState<LoadState>({ kind: "loading" });
  const [summary, setSummary] = useState<LogSummary | null>(null);
  const [summaryLoad, setSummaryLoad] = useState<LoadState>({
    kind: "loading",
  });
  /* 不叫 `window`：那会遮蔽全局 window 对象。 */
  const [summaryWindow, setSummaryWindow] = useState("24h");
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<readonly string[]>([]);

  const reload = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const data = await api.get<JobSchedulerSnapshot>("/api/job-scheduler");
      setSnapshot(data);
      setLoad({ kind: "ready" });
    } catch (error) {
      setLoad({
        kind: "error",
        message:
          error instanceof OperaApiError ? error.message : "读取运行指标失败",
      });
    }
  }, []);

  const reloadSummary = useCallback(async (w: string) => {
    setSummaryLoad({ kind: "loading" });
    try {
      const data = await api.get<LogSummary>(
        `/api/atlas/logs/summary?window=${encodeURIComponent(w)}`,
      );
      setSummary(data);
      setSummaryLoad({ kind: "ready" });
    } catch (error) {
      setSummaryLoad({
        kind: "error",
        message:
          error instanceof OperaApiError ? error.message : "读取窗口聚合失败",
      });
    }
  }, []);

  const reloadPerf = useCallback(async () => {
    setPerfLoad({ kind: "loading" });
    try {
      const data = await api.get<ProviderPerformanceSnapshot>(
        "/api/atlas/providers/performance",
      );
      setPerf(data);
      setPerfLoad({ kind: "ready" });
    } catch (error) {
      setPerfLoad({
        kind: "error",
        message:
          error instanceof OperaApiError ? error.message : "读取网关性能失败",
      });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    void reloadPerf();
  }, [reloadPerf]);

  useEffect(() => {
    void reloadSummary(summaryWindow);
  }, [reloadSummary, summaryWindow]);

  const counts = snapshot?.queue.counts;
  const jobs = useMemo(() => snapshot?.jobs ?? [], [snapshot]);
  const filteredJobs = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return kw === ""
      ? jobs
      : jobs.filter((j) => j.jobName.toLowerCase().includes(kw));
  }, [jobs, keyword]);
  const pager = useListPagination(filteredJobs, 20);

  const copyRow = async (r: JobHeartbeatItem) => {
    const text = [
      r.jobName,
      JOB_STATUS_LABELS[r.status],
      r.lastDurationMs != null ? `${r.lastDurationMs}ms` : "—",
      `运行 ${r.runCount} / 失败 ${r.failureCount}`,
    ].join(" · ");
    try {
      await navigator.clipboard.writeText(text);
      toast({ tone: "success", title: "已复制该行到剪贴板" });
    } catch {
      toast({
        tone: "danger",
        title: "复制失败",
        description: "浏览器拒绝了剪贴板访问，请手动选中复制。",
      });
    }
  };

  return (
    <ViewLayout>
      <ViewHeader
        icon="chart-line"
        title="运行指标"
        description="平台运行指标。网关性能已到 Provider 粒度；Model/Endpoint 维度拆分暂无上游数据源。"
      />

      <Banner
        tone="info"
        title="网关性能：只到 Provider 粒度"
        description="Atlas 已导出按 Provider 聚合的近实时吞吐/延迟/错误率（见下方），但 Model / Endpoint 维度的拆分仍未提供（已提 liaison issue 给 vxture-atlas）。这里不为没有的粒度接虚构数字；按租户的成本/Token 用量是真实数据，见下方入口。"
      />

      <Section
        title="网关流量聚合"
        icon="chart-line"
        level={2}
        description="Atlas /capability/logs/summary：按窗口聚合的请求量、错误率与延迟分位。这是设计稿 §11 要的 Gateway / Provider 指标来源。"
        action={
          <NativeSelect
            wrapperClassName="w-fit"
            value={summaryWindow}
            onChange={(e) => setSummaryWindow(e.target.value)}
            aria-label="统计窗口"
          >
            <option value="1h">最近 1 小时</option>
            <option value="24h">最近 24 小时</option>
            <option value="7d">最近 7 天</option>
          </NativeSelect>
        }
      >
        <MetricGrid
          loading={summaryLoad.kind === "loading" && !summary}
          columns={4}
          items={[
            {
              id: "requests",
              label: "请求数",
              value: summary ? String(summary.overall.requests) : "—",
              icon: "gauge",
            },
            {
              id: "errorRate",
              label: "错误率",
              value: summary ? formatRate(summary.overall.errorRate) : "—",
              icon: "warning",
              ...((summary?.overall.errorRate ?? 0) > 0.02
                ? { trendTone: "warning" as const }
                : {}),
            },
            {
              id: "avg",
              label: "平均延迟",
              value: summary ? formatMs(summary.overall.avgLatencyMs) : "—",
              icon: "clock",
            },
            {
              id: "p95",
              label: "P95 延迟",
              value: summary ? formatMs(summary.overall.p95LatencyMs) : "—",
              icon: "clock",
            },
          ]}
        />
        <DataTable
          columns={[
            {
              id: "group",
              header: "模型 / Provider",
              cell: (r: LogSummary["byGroup"][number]) => (
                <span className="text-body-sm">
                  {r.modelCode ?? "—"}
                  <span className="text-muted-foreground">
                    {" / "}
                    {r.providerCode ?? "—"}
                  </span>
                </span>
              ),
            },
            {
              /* `null` 不是缺数据，是**一组真实的流量**：调用方直接点名
                 modelCode / taskProfile，没有经过任何入口。如实标出来，因为各组
                 必须能加总回 overall——把它显示成「—」会让人以为是脏数据。 */
              id: "endpoint",
              header: "Endpoint",
              width: "sm",
              cell: (r: LogSummary["byGroup"][number]) =>
                r.endpointCode ? (
                  <span className="text-code-sm">{r.endpointCode}</span>
                ) : r.endpointCode === null ? (
                  <span className="text-body-sm text-muted-foreground">
                    未走入口
                  </span>
                ) : (
                  /* 字段根本没回——这台 Atlas 没按入口分过组，不是"没走入口"。 */
                  <span className="text-body-sm text-muted-foreground">—</span>
                ),
            },
            {
              id: "requests",
              header: "请求数",
              align: "right",
              width: "xs",
              cell: (r: LogSummary["byGroup"][number]) => r.requests,
            },
            {
              id: "tokens",
              header: "Token 数",
              align: "right",
              width: "xs",
              cell: (r: LogSummary["byGroup"][number]) =>
                r.totalTokens === undefined
                  ? "—"
                  : new Intl.NumberFormat("zh-CN").format(r.totalTokens),
            },
            {
              id: "errors",
              header: "错误数",
              align: "right",
              width: "xs",
              cell: (r: LogSummary["byGroup"][number]) => r.errors,
            },
            {
              id: "errorRate",
              header: "错误率",
              align: "right",
              width: "xs",
              cell: (r: LogSummary["byGroup"][number]) =>
                formatRate(r.errorRate),
            },
            {
              id: "p95",
              header: "P95 延迟",
              align: "right",
              width: "xs",
              cell: (r: LogSummary["byGroup"][number]) =>
                formatMs(r.p95LatencyMs),
            },
          ]}
          rows={summary?.byGroup ?? []}
          /* endpointCode 必须进 key：加上这一维之后，同一个 model/provider 会按不同
             入口拆成多行，只用前两段做 key 会撞成重复键——React 会丢行，而丢掉的正是
             这次新增的那一维。 */
          rowKey={(r) =>
            `${r.modelCode ?? "-"}::${r.providerCode ?? "-"}::${r.endpointCode ?? "-"}`
          }
          indexStart={1}
          empty={
            summaryLoad.kind === "loading" ? (
              <EmptyState title="读取中…" description="正在读取窗口聚合。" />
            ) : summaryLoad.kind === "error" ? (
              <EmptyState
                title="读取失败"
                description={summaryLoad.message}
                action={
                  <Button
                    variant="secondary"
                    onClick={() => void reloadSummary(summaryWindow)}
                  >
                    重试
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title="该窗口内没有流量"
                description="换一个更长的统计窗口再看。"
              />
            )
          }
        />
      </Section>

      <Section
        title="网关性能 · Provider 维度"
        icon="gauge"
        level={2}
        description="chat/stream 流量为准；attempts/successes/errors 是进程启动以来的累计计数器（Prometheus 语义），不是瞬时 QPS。数据源是 Atlas 的进程内存计数器——Atlas 重启即清零，不要当历史累计读；要看跨重启的真实历史请用上方「网关流量聚合」（读的是持久化的请求日志）。"
      >
        <MetricGrid
          loading={perfLoad.kind === "loading" && !perf}
          columns={3}
          items={[
            {
              id: "in-flight",
              label: "当前 In-flight 请求",
              value: String(perf?.inFlightRequests ?? 0),
              icon: "gauge",
            },
            {
              id: "process-started",
              label: "进程启动于",
              value: perf ? formatTime(perf.processStartedAt) : "—",
              icon: "clock",
            },
            {
              id: "generated-at",
              label: "本次快照时间",
              value: perf ? formatTime(perf.generatedAt) : "—",
              icon: "refresh",
            },
          ]}
        />
        <DataTable
          columns={[
            {
              id: "provider",
              header: "Provider",
              cell: (r: ProviderPerformanceRow) => (
                <span className="font-mono">{r.provider}</span>
              ),
            },
            {
              id: "attempts",
              header: "累计请求",
              align: "right",
              width: "xs",
              cell: (r: ProviderPerformanceRow) => r.attempts,
            },
            {
              id: "errorRate",
              header: "错误率",
              align: "right",
              width: "xs",
              cell: (r: ProviderPerformanceRow) => formatRate(r.errorRate),
            },
            {
              id: "avgLatency",
              header: "平均延迟",
              align: "right",
              width: "xs",
              cell: (r: ProviderPerformanceRow) => formatMs(r.avgLatencyMs),
            },
            {
              id: "p95Latency",
              header: "P95 延迟",
              align: "right",
              width: "xs",
              cell: (r: ProviderPerformanceRow) => formatMs(r.p95LatencyMs),
            },
            {
              id: "lastObserved",
              header: "最近观测",
              width: "sm",
              cell: (r: ProviderPerformanceRow) => formatTime(r.lastObservedAt),
            },
          ]}
          rows={perf?.providers ?? []}
          rowKey={(r) => r.provider}
          indexStart={1}
          empty={
            perfLoad.kind === "loading" ? (
              <EmptyState title="读取中…" description="正在读取网关性能。" />
            ) : perfLoad.kind === "error" ? (
              <EmptyState
                title="读取失败"
                description={perfLoad.message}
                action={
                  <Button variant="secondary" onClick={() => void reloadPerf()}>
                    重试
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title="暂无数据"
                description="还没有 provider 承载过 chat/stream 流量。"
              />
            )
          }
        />
      </Section>

      <Section
        title="后台任务执行统计"
        icon="gauge"
        level={2}
        description="opera-bff 自有的四个后台作业（provisioning-dispatch / sharing-expiry / trial-expiry / order-payment-expiry），真实心跳数据。"
      >
        <FilterBar
          view="list"
          onViewChange={() => {}}
          cardsDisabledReason="卡片视图已下线，改用列表"
          count={
            filteredJobs.length === jobs.length
              ? jobs.length
              : `${filteredJobs.length} / ${jobs.length}`
          }
        >
          <InputGroup className="grow basis-media-3xl max-w-panel-sm">
            <InputGroupAddon>
              <Icon name="search" size="sm" aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="搜索作业名…"
              aria-label="搜索作业"
              value={keyword}
              onChange={(e) => {
                setKeyword(e.target.value);
                pager.resetPage();
              }}
            />
          </InputGroup>
        </FilterBar>
        <DataTable
          columns={[
            {
              id: "job",
              header: "作业",
              cell: (r: JobHeartbeatItem) => r.jobName,
            },
            {
              id: "duration",
              header: "最近耗时",
              align: "right",
              width: "xs",
              cell: (r: JobHeartbeatItem) =>
                r.lastDurationMs != null ? `${r.lastDurationMs}ms` : "—",
            },
            {
              id: "runs",
              header: "累计运行",
              align: "right",
              width: "xs",
              cell: (r: JobHeartbeatItem) => r.runCount,
            },
            {
              id: "failures",
              header: "累计失败",
              align: "right",
              width: "xs",
              cell: (r: JobHeartbeatItem) => r.failureCount,
            },
            {
              id: "status",
              header: "状态",
              align: "center",
              width: "xs",
              cell: (r: JobHeartbeatItem) => (
                <StatusBadge tone={jobStatusTone(r.status)}>
                  {JOB_STATUS_LABELS[r.status]}
                </StatusBadge>
              ),
            },
          ]}
          rows={pager.pageRows}
          rowKey={(r) => r.jobName}
          selectedKeys={selected}
          onSelectionChange={setSelected}
          indexStart={pager.indexStart}
          rowActions={(r: JobHeartbeatItem) => (
            <ActionMenu
              label={`${r.jobName} 操作`}
              items={[
                {
                  id: "copy",
                  label: "复制该行",
                  icon: "copy",
                  onSelect: () => void copyRow(r),
                },
              ]}
            />
          )}
          footer={
            <Pagination
              className="w-full"
              page={pager.page}
              pageCount={pager.pageCount}
              total={jobs.length}
              filteredTotal={filteredJobs.length}
              pageSize={pager.pageSize}
              onPageSizeChange={pager.onPageSizeChange}
              onPageChange={pager.onPageChange}
            />
          }
          empty={
            load.kind === "loading" ? (
              <EmptyState title="读取中…" description="正在读取作业统计。" />
            ) : load.kind === "error" ? (
              <EmptyState
                title="读取失败"
                description={load.message}
                action={
                  <Button variant="secondary" onClick={() => void reload()}>
                    重试
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title="暂无作业数据"
                description="尚未采集到任何作业心跳。"
              />
            )
          }
        />
      </Section>

      <Section
        title="Webhook 投递队列深度"
        icon="package"
        level={2}
        description="provisioning.webhook_deliveries 当前各状态计数，真实数据。"
      >
        <MetricGrid
          loading={load.kind === "loading" && !snapshot}
          columns={5}
          items={[
            {
              id: "pending",
              label: "待投递",
              value: String(counts?.pending ?? 0),
              icon: "clock",
            },
            {
              id: "delivering",
              label: "投递中",
              value: String(counts?.delivering ?? 0),
              icon: "arrow-up",
            },
            {
              id: "delivered",
              label: "已投递",
              value: String(counts?.delivered ?? 0),
              icon: "success",
            },
            {
              id: "failed",
              label: "失败（待重试）",
              value: String(counts?.failed ?? 0),
              icon: "warning",
              ...((counts?.failed ?? 0) > 0
                ? { trendTone: "warning" as const }
                : {}),
            },
            {
              id: "dead",
              label: "死信",
              value: String(counts?.dead ?? 0),
              icon: "error",
              ...((counts?.dead ?? 0) > 0
                ? { trendTone: "danger" as const }
                : {}),
            },
          ]}
        />
      </Section>

      <Section
        title="按租户成本 / Token 用量"
        icon="coins"
        level={2}
        description="Atlas 真实用量汇总，已在 Metering 页展示，此处不重复维护同一份聚合逻辑。"
        action={
          <Button asChild variant="ghost" size="md">
            <Link href="/model/metering">
              前往 Metering
              <Icon name="chevron-right" size="sm" aria-hidden="true" />
            </Link>
          </Button>
        }
      >
        <p className="text-body-sm text-muted-foreground">
          请求数、Token 用量与事实成本按租户 × 结算周期回传，完整视图见 Metering
          页。
        </p>
      </Section>
    </ViewLayout>
  );
}
