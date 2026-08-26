"use client";

/* Dashboard — opera-top-level-design.md §10：平台状态 / Atlas 状态 / 请求统计。
 * 阅读顺序由 DashboardTemplate 焊死：先看数、再选路、最后处理事项。
 *
 * 2026-08-12 接真实数据：此前顶部四格（24h 请求/Token/TTFT/事实成本）与
 * Provider 状态列（延迟/成功率）全部来自 mocks/atlas.ts 的虚构字段——Atlas
 * 真实的 `/capability/providers` 不回传健康/延迟数据，网关请求量/Token/延迟
 * 也没有任何遥测导出（见 liaison issue，待 Atlas 侧交付）。这里换成当前真实
 * 能拿到的运营信号：Provider/Model 启用数（真实 CRUD 已接）、待处理维护窗口
 * （真实）、后台任务失败数（真实 job-scheduler）；"最近事件"从虚构日志换成
 * 真实审计留痕（与 Security/Audit 同源）。网关吞吐类指标暂缺，不接假数字。
 *
 * 2026-08-12 补 Provider 健康（liaison #245，vxture-atlas#147 已合并到 main，
 * 但接口文档自己写明"最近部署 tag 落后 main 11 个 commit"——生产环境可能还
 * 没有这个字段）。`health` 字段做成可选：没有时按 unknown 处理，不假设它
 * 一定存在，避免线上 Atlas 还没升级到这个版本时整页崩掉。"unknown" 是
 * "还没有流量"或"字段还没上线"，不是"故障"——刚接入或只服务
 * embed/parse/rerank（还没有真实 provider 实现，TD-003）的 provider 也会
 * 一直显示 unknown，这里不把它渲染成红色。 */

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionMenu,
  Banner,
  Button,
  DashboardTemplate,
  DataTable,
  EmptyState,
  EntryCard,
  Icon,
  MetricGrid,
  Section,
  StatusBadge,
  TableTitleCell,
  ViewHeader,
  useToast,
  type StatusBadgeTone,
} from "@vxture/design-system";
import { isEnabled, isServing } from "@/features/atlas/state";
import { api, OperaApiError } from "@/lib/api";

type ProviderHealthStatus = "healthy" | "degraded" | "down" | "unknown";

interface ModelProviderRecord {
  id: string;
  providerCode: string;
  providerType: string;
  providerName: string;
  state: string;
  health?: { status: ProviderHealthStatus };
}

interface AiModelRecord {
  id: string;
  providerId: string | null;
  modelCode: string;
  modelName: string;
  /** 三值：deprecated 仍在服务。 */
  state: string;
}

interface MaintenanceWindowItem {
  id: string;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
}

type JobStatus = "idle" | "running" | "success" | "failed";

interface JobHeartbeatItem {
  jobName: string;
  status: JobStatus;
  lastError: string | null;
}

interface JobSchedulerSnapshot {
  jobs: JobHeartbeatItem[];
  queue: {
    counts: {
      pending: number;
      delivering: number;
      delivered: number;
      failed: number;
      dead: number;
    };
    recentIssues: unknown[];
  };
}

/** 字段名对齐 product_251 X-3（见 opera-bff `audit-log-view.router.ts`）。 */
interface AuditLogEntry {
  eventId: string;
  occurredAt: string;
  actorName: string;
  action: string;
  objectType: string;
  objectId: string;
  outcome: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

function providerTone(state: string): StatusBadgeTone {
  return isEnabled(state) ? "success" : "neutral";
}

const HEALTH_META: Record<
  ProviderHealthStatus,
  { label: string; tone: StatusBadgeTone }
> = {
  healthy: { label: "健康", tone: "success" },
  degraded: { label: "降级", tone: "warning" },
  down: { label: "故障", tone: "danger" },
  unknown: { label: "无数据", tone: "neutral" },
};

/* 收 `locale` 而不是写死 `"zh-CN"`：日期的字段顺序属于语言——
   中文 `2026/8/18 10:37`，英文 `8/18/2026, 10:37`。写死的后果不是「没翻译」，
   是英文用户会把 8/18 读成 18 月。（数字与百分比两种语言逐字相同，所以那些
   没跟着改，见 scripts/guardrails 旁的说明。） */
function formatTime(iso: string, locale: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(locale, { hour12: false });
}

export default function DashboardPage() {
  const locale = useLocale();
  const tShared = useTranslations();
  const { toast } = useToast();
  const [providers, setProviders] = useState<ModelProviderRecord[]>([]);
  const [models, setModels] = useState<AiModelRecord[]>([]);
  const [windows, setWindows] = useState<MaintenanceWindowItem[]>([]);
  const [jobSnapshot, setJobSnapshot] = useState<JobSchedulerSnapshot | null>(
    null,
  );
  const [events, setEvents] = useState<AuditLogEntry[]>([]);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });

  /* 选择列全站占位（owner 定）：摘要表暂无批量动作，列先在。 */
  const [providerSel, setProviderSel] = useState<readonly string[]>([]);
  const [eventSel, setEventSel] = useState<readonly string[]>([]);

  const reload = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const [providersData, modelsData, windowsData, jobData, eventsData] =
        await Promise.all([
          api.get<ModelProviderRecord[]>("/api/atlas/providers"),
          api.get<AiModelRecord[]>("/api/atlas/models"),
          api.get<MaintenanceWindowItem[]>(
            "/api/maintenance-windows?status=scheduled,in_progress",
          ),
          api.get<JobSchedulerSnapshot>("/api/job-scheduler"),
          api.get<AuditLogEntry[]>("/api/audit-logs?limit=4"),
        ]);
      setProviders(providersData);
      setModels(modelsData);
      setWindows(windowsData);
      setJobSnapshot(jobData);
      setEvents(eventsData);
      setLoad({ kind: "ready" });
    } catch (error) {
      setLoad({
        kind: "error",
        message:
          error instanceof OperaApiError
            ? error.message
            : "读取 Dashboard 数据失败",
      });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const modelCountByProvider = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of models) {
      if (!m.providerId) continue;
      map.set(m.providerId, (map.get(m.providerId) ?? 0) + 1);
    }
    return map;
  }, [models]);

  const copyEvent = async (r: AuditLogEntry) => {
    const text = [
      formatTime(r.occurredAt, locale),
      r.actorName,
      r.action,
      `${r.objectType} · ${r.objectId}`,
      r.outcome,
    ].join(" · ");
    try {
      await navigator.clipboard.writeText(text);
      toast({ tone: "success", title: tShared("common.rowCopied") });
    } catch {
      toast({
        tone: "danger",
        title: tShared("common.copyFailed"),
        description: tShared("common.copyDenied"),
      });
    }
  };

  const activeProviders = providers.filter((p) => isEnabled(p.state)).length;
  /* 数**还能服务的**（`deprecated` 算能）：总览回答的是"现在撑着多少"，
     把已弃用但仍在服务的模型排除掉会低报真实服务面。 */
  const activeModels = models.filter((m) => isServing(m.state)).length;
  const failedJobs =
    jobSnapshot?.jobs.filter((j) => j.status === "failed") ?? [];

  const metrics = [
    {
      id: "providers",
      label: "启用中的 Provider",
      value: `${activeProviders} / ${providers.length}`,
      icon: "plugs-connected",
    },
    {
      id: "models",
      label: "启用中的 Model",
      value: `${activeModels} / ${models.length}`,
      icon: "stack",
    },
    {
      id: "maintenance",
      label: "待处理维护窗口",
      value: String(windows.length),
      icon: "clock",
      ...(windows.length > 0 ? { trendTone: "warning" as const } : {}),
    },
    {
      id: "jobs",
      label: "后台任务失败数",
      value: String(failedJobs.length),
      icon: "warning",
      trendTone: failedJobs.length > 0 ? "warning" : "success",
    },
  ] as const;

  const emptyState =
    load.kind === "loading" ? (
      <EmptyState
        title={tShared("common.loading")}
        description="正在读取 Dashboard 数据。"
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
    ) : (
      <EmptyState title="暂无数据" description="尚未接入任何 Provider。" />
    );

  return (
    <DashboardTemplate
      header={
        <ViewHeader
          icon="squares-four"
          title="总览"
          description="平台状态、Atlas 状态与运营待办。Opera 记录事实成本，销售价格归 Admin。"
        />
      }
      metrics={
        <MetricGrid
          items={[...metrics]}
          columns={4}
          loading={load.kind === "loading"}
        />
      }
      entries={
        <div className="grid gap-md sm:grid-cols-2 xl:grid-cols-3">
          <EntryCard
            href="/model/services"
            icon="plugs-connected"
            title="Provider"
            meta={`${activeProviders} 家启用`}
            description="模型供应商接入、健康检查与代理出口"
          />
          <EntryCard
            href="/model/routes"
            icon="plug"
            title="Endpoint"
            meta="统一能力入口"
            description="业务只依赖 Endpoint；Primary / Fallback 指派也在这里改"
          />
          <EntryCard
            href="/ops/logs"
            icon="terminal"
            title="Logs"
            meta={jobSnapshot ? `${failedJobs.length} 个失败任务` : "—"}
            description="后台任务心跳与 webhook 投递运行日志"
          />
        </div>
      }
    >
      {failedJobs.length > 0 ? (
        <Banner
          tone="warning"
          title="后台任务失败"
          description={`${failedJobs.map((j) => j.jobName).join("、")} 当前失败；详见 Logs 页。`}
        />
      ) : null}

      <Section
        title="Provider 状态"
        icon="plugs-connected"
        level={2}
        description="接入的模型供应商与启停状态；健康状态从真实 chat/stream 流量派生，无数据不代表故障。"
        action={
          <Button asChild variant="ghost" size="md">
            <Link href="/model/services">
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
              cell: (r: ModelProviderRecord) => (
                <TableTitleCell
                  icon="plugs-connected"
                  title={r.providerName}
                  description={r.providerCode}
                />
              ),
            },
            {
              id: "models",
              header: "模型数",
              align: "right",
              width: "xs",
              cell: (r: ModelProviderRecord) =>
                modelCountByProvider.get(r.id) ?? 0,
            },
            {
              id: "type",
              header: tShared("columns.kind"),
              align: "center",
              width: "xs",
              cell: (r: ModelProviderRecord) => r.providerType,
            },
            {
              id: "health",
              header: tShared("columns.health"),
              align: "center",
              width: "xs",
              cell: (r: ModelProviderRecord) => (
                <StatusBadge
                  tone={HEALTH_META[r.health?.status ?? "unknown"].tone}
                  dot
                >
                  {HEALTH_META[r.health?.status ?? "unknown"].label}
                </StatusBadge>
              ),
            },
            {
              id: "status",
              header: tShared("columns.state"),
              align: "center",
              width: "xs",
              cell: (r: ModelProviderRecord) => (
                <StatusBadge tone={providerTone(r.state)} dot>
                  {isEnabled(r.state)
                    ? tShared("actions.enable")
                    : tShared("actions.disable")}
                </StatusBadge>
              ),
            },
          ]}
          rows={providers}
          rowKey={(r) => r.id}
          selectedKeys={providerSel}
          onSelectionChange={setProviderSel}
          indexStart={1}
          empty={emptyState}
          rowActions={() => (
            <Button
              asChild
              variant="ghost"
              size="md"
              aria-label="前往 Provider 详情"
              title="前往 Provider 详情"
            >
              <Link href="/model/services">
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
        description="最近的运营操作审计留痕；完整检索进 Audit。"
        action={
          <Button asChild variant="ghost" size="md">
            <Link href="/audit/changes">
              查看全部
              <Icon name="chevron-right" size="sm" aria-hidden="true" />
            </Link>
          </Button>
        }
      >
        <DataTable
          columns={[
            {
              id: "occurredAt",
              header: tShared("columns.time"),
              width: "sm",
              cell: (r: AuditLogEntry) => formatTime(r.occurredAt, locale),
            },
            {
              id: "actor",
              header: tShared("columns.actor"),
              width: "sm",
              cell: (r: AuditLogEntry) => r.actorName,
            },
            {
              id: "target",
              header: tShared("columns.target"),
              cell: (r: AuditLogEntry) => `${r.objectType} · ${r.objectId}`,
            },
            {
              id: "action",
              header: tShared("columns.action"),
              align: "center",
              width: "xs",
              cell: (r: AuditLogEntry) => r.action,
            },
          ]}
          rows={events}
          rowKey={(r) => r.eventId}
          selectedKeys={eventSel}
          onSelectionChange={setEventSel}
          indexStart={1}
          rowActions={(r: AuditLogEntry) => (
            <ActionMenu
              label="留痕操作"
              items={[
                {
                  id: "copy",
                  label: tShared("common.copyRow"),
                  icon: "copy",
                  onSelect: () => void copyEvent(r),
                },
              ]}
            />
          )}
          empty={
            load.kind === "ready" ? (
              <EmptyState
                title="暂无事件"
                description="近期没有运营操作留痕。"
              />
            ) : (
              emptyState
            )
          }
        />
      </Section>
    </DashboardTemplate>
  );
}
