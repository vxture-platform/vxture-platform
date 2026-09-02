"use client";

/* 任务调度 — 后台作业心跳 + webhook 投递队列观测。
 *
 * 2026-08-11 自 admin 迁入（继维护窗口、服务监控之后的第三批）。**换了整个数据源，
 * 不是同一份代码搬家**：admin 那份读 admin.governance_record（kind='jobs'），这张
 * 表设计已被明确弃用、从未建过（docs/30-design/data_admin_200_schema.md），admin-bff
 * 自己的路由探测不到表就直接返回空数组——搬一张空表没有意义。
 *
 * 真实数据分两块（见 opera-bff job-scheduler.router.ts 文件头的完整口径）：
 *   1. 后台作业心跳（provisioning.background_jobs，本次migration新建）：
 *      platform-api 四个 @Interval 作业（provisioning-dispatch / sharing-expiry /
 *      trial-expiry / order-payment-expiry）各占一行、每 tick 原地更新——此前从未
 *      有任何观测面盯着这四个作业是否还在跑。
 *   2. webhook 投递队列（provisioning.webhook_deliveries，早已在生产运行，但此前
 *      零观测面——admin 自己的整改计划把它登记为运维盲区）。这里只读，不碰
 *      claim/retry/死信逻辑——那些已经在 @vxture/service-provisioning 里跑。
 *
 * 骨架与 opera 的 Metrics 页同构（ViewLayout + Section + MetricGrid + DataTable），
 * 不用 ListPageTemplate——本页两个独立数据块（作业心跳、投递队列），不是单张列表
 * 加筛选。只读页面，无能力门（同 product-health.router.ts 的口径：没有专属能力码
 * 就不额外设卡）。刷新节奏 30s，另留手动刷新按钮。 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ActionMenu,
  Badge,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  Icon,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  MetricGrid,
  Section,
  StatusBadge,
  ViewHeader,
  ViewLayout,
  useListPagination,
  useToast,
  type StatusBadgeTone,
} from "@vxture/design-system";
import { ListPagination } from "@/modules/shared/ListPagination";
import { api, OperaApiError } from "@/lib/api";
import { useVisiblePolling } from "@/lib/useVisiblePolling";

const REFRESH_INTERVAL_MS = 30_000;

type JobStatus = "idle" | "running" | "success" | "failed";

interface JobHeartbeatItem {
  jobName: string;
  status: JobStatus;
  intervalMs: number | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastDurationMs: number | null;
  lastItemsProcessed: number | null;
  lastError: string | null;
  runCount: number;
  failureCount: number;
  updatedAt: string;
}

type WebhookDeliveryStatus =
  | "pending"
  | "delivering"
  | "delivered"
  | "failed"
  | "dead";

interface WebhookQueueCounts {
  pending: number;
  delivering: number;
  delivered: number;
  failed: number;
  dead: number;
}

interface WebhookDeliveryIssue {
  id: string;
  eventType: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  nextRetryAt: string | null;
  lastAttemptAt: string | null;
  tenantName: string | null;
  productName: string | null;
}

interface JobSchedulerSnapshot {
  jobs: JobHeartbeatItem[];
  queue: {
    counts: WebhookQueueCounts;
    recentIssues: WebhookDeliveryIssue[];
  };
}

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

const QUEUE_STATUS_LABELS: Record<WebhookDeliveryStatus, string> = {
  pending: "待处理",
  delivering: "投递中",
  delivered: "已投递",
  failed: "失败重试中",
  dead: "死信",
};

function queueStatusTone(status: WebhookDeliveryStatus): StatusBadgeTone {
  if (status === "delivered") return "success";
  if (status === "delivering") return "info";
  if (status === "failed") return "warning";
  if (status === "dead") return "danger";
  return "neutral";
}

const TIME_FORMAT = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : TIME_FORMAT.format(d);
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatIntervalMs(ms: number | null): string {
  if (ms === null) return "—";
  return ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

const EMPTY_SNAPSHOT: JobSchedulerSnapshot = {
  jobs: [],
  queue: {
    counts: { pending: 0, delivering: 0, delivered: 0, failed: 0, dead: 0 },
    recentIssues: [],
  },
};

async function copyRowText(
  toast: ReturnType<typeof useToast>["toast"],
  text: string,
) {
  try {
    await navigator.clipboard.writeText(text);
    toast({ tone: "success", title: "已复制到剪贴板" });
  } catch {
    toast({
      tone: "danger",
      title: "复制失败",
      description: "浏览器拒绝了剪贴板访问，请手动选中复制。",
    });
  }
}

export default function JobSchedulerPage() {
  const tShared = useTranslations();
  const { toast } = useToast();
  const [snapshot, setSnapshot] =
    useState<JobSchedulerSnapshot>(EMPTY_SNAPSHOT);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);

  const [jobKeyword, setJobKeyword] = useState("");
  const [jobSelected, setJobSelected] = useState<readonly string[]>([]);
  const [issueKeyword, setIssueKeyword] = useState("");
  const [issueSelected, setIssueSelected] = useState<readonly string[]>([]);

  const reload = useCallback(async (opts?: { silent?: boolean }) => {
    if (opts?.silent) {
      setRefreshing(true);
    } else {
      setLoad({ kind: "loading" });
    }
    try {
      const data = await api.get<JobSchedulerSnapshot>("/api/job-scheduler");
      setSnapshot(data);
      setLastFetchedAt(new Date());
      setLoad({ kind: "ready" });
    } catch (error) {
      setLoad({
        kind: "error",
        message:
          error instanceof OperaApiError
            ? error.message
            : "读取任务调度数据失败",
      });
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /* 隐藏即停、回前台补取、卸载即清（`useVisiblePolling` 文件头讲了原来那份错在哪）。
     30 秒这个频次来自设计文件 §7.3：存活/就绪探测对被测方是真实请求，没人看时不该
     继续打。 */
  useVisiblePolling(() => void reload({ silent: true }), REFRESH_INTERVAL_MS);

  const { jobs, queue } = snapshot;
  const failedJobs = jobs.filter((j) => j.status === "failed").length;
  const queueDepth = queue.counts.pending + queue.counts.delivering;

  const filteredJobs = useMemo(() => {
    const kw = jobKeyword.trim().toLowerCase();
    return kw === ""
      ? jobs
      : jobs.filter((j) => j.jobName.toLowerCase().includes(kw));
  }, [jobs, jobKeyword]);
  const jobPager = useListPagination(filteredJobs, 20);

  const filteredIssues = useMemo(() => {
    const kw = issueKeyword.trim().toLowerCase();
    return kw === ""
      ? queue.recentIssues
      : queue.recentIssues.filter(
          (i) =>
            i.eventType.toLowerCase().includes(kw) ||
            (i.productName ?? "").toLowerCase().includes(kw) ||
            (i.tenantName ?? "").toLowerCase().includes(kw),
        );
  }, [queue.recentIssues, issueKeyword]);
  const issuePager = useListPagination(filteredIssues, 20);

  return (
    <ViewLayout>
      <ViewHeader
        icon="workflow"
        title="任务调度"
        description="后台作业心跳与 webhook 投递队列；探测目标来自 platform-api 的作业心跳表与生产投递队列，非静态清单。"
        secondary={
          lastFetchedAt ? (
            <Badge>上次刷新 {formatTime(lastFetchedAt.toISOString())}</Badge>
          ) : null
        }
        action={
          <Button
            variant="outline"
            onClick={() => void reload()}
            disabled={load.kind === "loading" || refreshing}
          >
            <Icon name="refresh" size="sm" aria-hidden="true" />
            {tShared("common.refresh")}
          </Button>
        }
      />

      {load.kind === "error" ? (
        <EmptyState
          title={tShared("common.loadFailed")}
          description={load.message}
          action={
            <Button variant="secondary" onClick={() => void reload()}>
              {tShared("common.retry")}
            </Button>
          }
        />
      ) : (
        <>
          <Section
            title="后台作业"
            icon="workflow"
            level={2}
            description="platform-api 上四个 @Interval 驱动的周期作业；每格是最近一次 tick 的状态，不是执行日志。"
          >
            <MetricGrid
              aria-label="后台作业概览"
              loading={load.kind === "loading" && jobs.length === 0}
              columns={4}
              items={[
                {
                  id: "total",
                  label: "作业数",
                  value: String(jobs.length),
                  icon: "workflow",
                },
                {
                  id: "failed",
                  label: "异常作业",
                  value: String(failedJobs),
                  icon: "warning",
                  ...(failedJobs > 0 ? { tone: "danger" as const } : {}),
                },
                {
                  id: "runs",
                  label: "累计运行 / 失败",
                  value: `${jobs.reduce((s, j) => s + j.runCount, 0)} / ${jobs.reduce((s, j) => s + j.failureCount, 0)}`,
                  icon: "success",
                },
                {
                  id: "queueDepth",
                  label: "队列积压",
                  value: String(queueDepth),
                  icon: "clock",
                  ...(queueDepth > 0 ? { tone: "warning" as const } : {}),
                },
              ]}
            />
            <FilterBar
              view="list"
              onViewChange={() => {}}
              cardsDisabledReason={tShared("common.cardsRetired")}
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
                  value={jobKeyword}
                  onChange={(e) => {
                    setJobKeyword(e.target.value);
                    jobPager.resetPage();
                  }}
                />
              </InputGroup>
            </FilterBar>
            <DataTable
              columns={[
                {
                  id: "jobName",
                  header: "作业",
                  cell: (r: JobHeartbeatItem) => (
                    <span className="text-label-md text-foreground">
                      {r.jobName}
                    </span>
                  ),
                },
                {
                  id: "lastStarted",
                  header: "上次开始",
                  width: "sm",
                  cell: (r: JobHeartbeatItem) => (
                    <span className="text-body-sm text-muted-foreground">
                      {formatTime(r.lastStartedAt)}
                    </span>
                  ),
                },
                {
                  id: "lastError",
                  header: "最后报错",
                  cell: (r: JobHeartbeatItem) =>
                    r.lastError ? (
                      <span
                        className="text-body-sm text-destructive-text truncate block"
                        title={r.lastError}
                      >
                        {r.lastError}
                      </span>
                    ) : (
                      <span className="text-body-sm text-muted-foreground">
                        —
                      </span>
                    ),
                },
                {
                  id: "interval",
                  header: "心跳间隔",
                  align: "right",
                  width: "xs",
                  cell: (r: JobHeartbeatItem) => formatIntervalMs(r.intervalMs),
                },
                {
                  id: "duration",
                  header: "耗时",
                  align: "right",
                  width: "xs",
                  cell: (r: JobHeartbeatItem) =>
                    formatDuration(r.lastDurationMs),
                },
                {
                  id: "items",
                  header: "处理项数",
                  align: "right",
                  width: "xs",
                  cell: (r: JobHeartbeatItem) => r.lastItemsProcessed ?? "—",
                },
                {
                  id: "counts",
                  header: "运行 / 失败次数",
                  align: "right",
                  width: "sm",
                  cell: (r: JobHeartbeatItem) =>
                    `${r.runCount} / ${r.failureCount}`,
                },
                {
                  id: "status",
                  header: tShared("columns.state"),
                  align: "center",
                  width: "xs",
                  cell: (r: JobHeartbeatItem) => (
                    <StatusBadge tone={jobStatusTone(r.status)}>
                      {JOB_STATUS_LABELS[r.status]}
                    </StatusBadge>
                  ),
                },
              ]}
              rows={jobPager.pageRows}
              rowKey={(r: JobHeartbeatItem) => r.jobName}
              selectedKeys={jobSelected}
              onSelectionChange={setJobSelected}
              indexStart={jobPager.indexStart}
              rowActions={(r: JobHeartbeatItem) => (
                <ActionMenu
                  label={`${r.jobName} 操作`}
                  items={[
                    {
                      id: "copy",
                      label: tShared("common.copyRow"),
                      icon: "copy",
                      onSelect: () =>
                        void copyRowText(
                          toast,
                          [
                            r.jobName,
                            JOB_STATUS_LABELS[r.status],
                            formatIntervalMs(r.intervalMs),
                            formatTime(r.lastStartedAt),
                            formatDuration(r.lastDurationMs),
                            `运行 ${r.runCount} / 失败 ${r.failureCount}`,
                            r.lastError ?? "",
                          ].join(" · "),
                        ),
                    },
                  ]}
                />
              )}
              footer={
                <ListPagination
                  className="w-full"
                  currentPage={jobPager.page}
                  pageCount={jobPager.pageCount}
                  total={jobs.length}
                  filteredTotal={filteredJobs.length}
                  pageSize={jobPager.pageSize}
                  onPageSizeChange={jobPager.onPageSizeChange}
                  onPageChange={jobPager.onPageChange}
                />
              }
              empty={
                <EmptyState
                  title={
                    load.kind === "loading"
                      ? tShared("common.loading")
                      : "暂无作业心跳"
                  }
                  description={
                    load.kind === "loading"
                      ? "正在读取后台作业状态。"
                      : "platform-api 的作业还没有写入过心跳，可能尚未启动过一次 tick。"
                  }
                />
              }
            />
          </Section>

          <Section
            title="Webhook 投递队列"
            icon="plug"
            level={2}
            description="平台 → 产品的 outbound 事件投递；只读观测，claim/retry/死信裁决在 provisioning 服务内部完成。"
          >
            <MetricGrid
              aria-label="投递队列概览"
              loading={load.kind === "loading" && jobs.length === 0}
              columns={5}
              items={[
                {
                  id: "pending",
                  label: "待处理",
                  value: String(queue.counts.pending),
                  icon: "clock",
                },
                {
                  id: "delivering",
                  label: "投递中",
                  value: String(queue.counts.delivering),
                  icon: "plug",
                },
                {
                  id: "delivered",
                  label: "已投递",
                  value: String(queue.counts.delivered),
                  icon: "success",
                  tone: "success",
                },
                {
                  id: "failed",
                  label: "失败重试中",
                  value: String(queue.counts.failed),
                  icon: "warning",
                  ...(queue.counts.failed > 0
                    ? { tone: "warning" as const }
                    : {}),
                },
                {
                  id: "dead",
                  label: "死信",
                  value: String(queue.counts.dead),
                  icon: "error",
                  ...(queue.counts.dead > 0 ? { tone: "danger" as const } : {}),
                },
              ]}
            />
            <FilterBar
              view="list"
              onViewChange={() => {}}
              cardsDisabledReason={tShared("common.cardsRetired")}
              count={
                filteredIssues.length === queue.recentIssues.length
                  ? queue.recentIssues.length
                  : `${filteredIssues.length} / ${queue.recentIssues.length}`
              }
            >
              <InputGroup className="grow basis-media-3xl max-w-panel-sm">
                <InputGroupAddon>
                  <Icon name="search" size="sm" aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  placeholder="搜索事件 / 租户 / 产品…"
                  aria-label="搜索投递记录"
                  value={issueKeyword}
                  onChange={(e) => {
                    setIssueKeyword(e.target.value);
                    issuePager.resetPage();
                  }}
                />
              </InputGroup>
            </FilterBar>
            <DataTable
              columns={[
                {
                  id: "event",
                  header: "事件",
                  cell: (r: WebhookDeliveryIssue) => (
                    <div className="flex flex-col gap-2xs">
                      <span className="text-label-md text-foreground">
                        {r.eventType}
                      </span>
                      <span className="text-body-sm text-muted-foreground">
                        {r.tenantName ?? "—"} · {r.productName ?? "—"}
                      </span>
                    </div>
                  ),
                },
                {
                  id: "lastError",
                  header: "最后报错",
                  cell: (r: WebhookDeliveryIssue) =>
                    r.lastError ? (
                      <span
                        className="text-body-sm text-destructive-text truncate block"
                        title={r.lastError}
                      >
                        {r.lastError}
                      </span>
                    ) : (
                      <span className="text-body-sm text-muted-foreground">
                        —
                      </span>
                    ),
                },
                {
                  id: "nextRetry",
                  header: "下次重试",
                  width: "sm",
                  cell: (r: WebhookDeliveryIssue) => (
                    <span className="text-body-sm text-muted-foreground">
                      {formatTime(r.nextRetryAt)}
                    </span>
                  ),
                },
                {
                  id: "lastAttempt",
                  header: "最后尝试",
                  width: "sm",
                  cell: (r: WebhookDeliveryIssue) => (
                    <span className="text-body-sm text-muted-foreground">
                      {formatTime(r.lastAttemptAt)}
                    </span>
                  ),
                },
                {
                  id: "attempts",
                  header: "尝试次数",
                  align: "right",
                  width: "xs",
                  cell: (r: WebhookDeliveryIssue) =>
                    `${r.attempts} / ${r.maxAttempts}`,
                },
                {
                  id: "status",
                  header: tShared("columns.state"),
                  align: "center",
                  width: "xs",
                  cell: (r: WebhookDeliveryIssue) => (
                    <StatusBadge tone={queueStatusTone(r.status)}>
                      {QUEUE_STATUS_LABELS[r.status]}
                    </StatusBadge>
                  ),
                },
              ]}
              rows={issuePager.pageRows}
              rowKey={(r: WebhookDeliveryIssue) => r.id}
              selectedKeys={issueSelected}
              onSelectionChange={setIssueSelected}
              indexStart={issuePager.indexStart}
              rowActions={(r: WebhookDeliveryIssue) => (
                <ActionMenu
                  label={`${r.eventType} 操作`}
                  items={[
                    {
                      id: "copy",
                      label: tShared("common.copyRow"),
                      icon: "copy",
                      onSelect: () =>
                        void copyRowText(
                          toast,
                          [
                            r.eventType,
                            r.tenantName ?? "—",
                            r.productName ?? "—",
                            QUEUE_STATUS_LABELS[r.status],
                            `尝试 ${r.attempts}/${r.maxAttempts}`,
                            r.lastError ?? "",
                          ].join(" · "),
                        ),
                    },
                  ]}
                />
              )}
              footer={
                <ListPagination
                  className="w-full"
                  currentPage={issuePager.page}
                  pageCount={issuePager.pageCount}
                  total={queue.recentIssues.length}
                  filteredTotal={filteredIssues.length}
                  pageSize={issuePager.pageSize}
                  onPageSizeChange={issuePager.onPageSizeChange}
                  onPageChange={issuePager.onPageChange}
                />
              }
              empty={
                <EmptyState
                  title={
                    load.kind === "loading"
                      ? tShared("common.loading")
                      : "没有失败或死信投递"
                  }
                  description={
                    load.kind === "loading"
                      ? "正在读取投递队列。"
                      : "所有 webhook 投递都在正常轨道上，没有需要关注的失败/死信记录。"
                  }
                />
              }
            />
          </Section>
        </>
      )}
    </ViewLayout>
  );
}
