"use client";

/* 调用日志 — 请求级运行事实的检索面。
 *
 * 2026-08-14 收下 runos 的 `capability_call` 与 `task_outcome` 两条流（原在
 * `/runos/audit`，安全审计域）。判据是**记录的性质而非产地**：问责数据（谁改了什么）
 * 归安全审计，运行事实（系统怎么样了）归这里。调用流水与请求日志、指标同类——看的人
 * 在排障不在追责；摆在「安全审计」下面既让排障的人找不到，又让真正追责时它淹没在每
 * 一次正常调用里。判据与三张表的分配见设计文件 §5。
 *
 * 三块数据刻意分区、不混排：Atlas 请求日志（模型面流量）/ Runos 能力调用（能力面流量）
 * / 平台后台作业（opera-bff 自监控）。混在一张表里会让「哪个系统出问题了」这个判断
 * 变模糊。
 *
 * ── 以下为 2026-08-12 建区时的记录 ──────────────────────────────────────────
 *
 * 2026-08-12 补 Atlas 请求日志（本页主区）：Atlas 的 `/capability/logs` 早就
 * 交付了——请求级检索、多维过滤、游标分页，正是 `opera-atlas-design.md` §11
 * Observability 要的「Logs」。opera 此前**全站 0 处引用**：因为一直在照
 * liaison issue 里「这轮新交付了什么」做增量，从没拿产品设计稿逐条验收过。
 * 这是 opera 侧的漏，不是 Atlas 没给。方向已纠正——需求由设计稿定义、向
 * provider 提要求，不再由 provider 已有接口反推页面该有什么。
 *
 * 两块数据刻意分区、不混排：
 *   上区 = Atlas 请求日志（业务流量事实，运营真正要查的）；
 *   下区 = 平台自身后台作业心跳 + webhook 投递（opera-bff 的自监控信号，
 *          与 Atlas 无关，此前是本页全部内容）。
 * 混在一张表里会让「哪个系统出问题了」这个判断变模糊。
 *
 * 分页形态不同也是刻意的：两个上游侧（Atlas 请求日志、Runos 调用流）都是不透明
 * 游标（cursor/nextCursor），只能顺序前进，做成「加载更多」；平台侧是本地数组，
 * 沿用 useListPagination。硬把游标掰成页码需要在前端缓存所有历史游标，得不偿失。
 *
 * 2026-08-24：Runos 那半此前只取第一页、游标一次都没消费，界面上是「最近 N 条」的
 * 档位选择器——同一页两半对着同一类数据给出两种翻法，而其中一种还是个沉默的截断。
 * 现在两半同形。 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionMenu,
  Badge,
  Banner,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  Icon,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  NativeSelect,
  Pagination,
  Section,
  StatusBadge,
  ViewHeader,
  ViewLayout,
  useListPagination,
  useToast,
  type DataTableSort,
  type StatusBadgeTone,
} from "@vxture/design-system";
import { api, OperaApiError } from "@/lib/api";
import { LOG_LEVEL_META, type LogLevel } from "@/lib/status";
import { RunosCallStreams } from "./RunosCallStreams";

/* ── Atlas 请求日志 ──────────────────────────────────────────────────────── */

interface AtlasRequestLogRecord {
  id: string;
  requestId: string;
  /**
   * **两条流之间唯一的接缝**（product_251 X-2）：同一个 taskId 在下面 Runos 能力调用
   * 那张表里也在。一次 agent 任务在模型面烧了多少 token、在能力面调了什么、哪一段
   * 失败的——分区呈现让"哪个系统出问题"看得清，而这个字段让"同一件事"还能被串起来。
   *
   * **2026-08-24 之前这条接缝是半接的**：这张表没有 taskId 列（只在"复制整行"的文本
   * 里出现），而下面的 Runos 调用流根本没有 taskId 入口——关键词打在 `capabilityId`
   * 上。原注释写着"值可以直接对拷"，实际拷不过去。现在一个 taskId 驱动两张表，
   * 两边的值都可以直接点。
   */
  taskId: string | null;
  status: string;
  tenantId: string | null;
  modelCode: string | null;
  providerCode: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number | null;
  createdAt: string;
  error: Record<string, unknown> | null;
}

interface AtlasRequestLogPage {
  items: AtlasRequestLogRecord[];
  nextCursor: string | null;
}

/** Atlas 只认这三个值，非法值它回 400——下拉写死，不让用户拼错。 */
const ATLAS_STATUSES = ["success", "error", "timeout"] as const;

function atlasStatusTone(status: string): StatusBadgeTone {
  if (status === "success") return "success";
  if (status === "timeout") return "warning";
  if (status === "error") return "danger";
  return "neutral";
}

/* ── 平台后台作业（本页原有内容）───────────────────────────────────────── */

type JobStatus = "idle" | "running" | "success" | "failed";

interface JobHeartbeatItem {
  jobName: string;
  status: JobStatus;
  lastFinishedAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

interface WebhookDeliveryIssue {
  id: string;
  eventType: string;
  status: "pending" | "delivering" | "delivered" | "failed" | "dead";
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  lastAttemptAt: string | null;
}

interface JobSchedulerSnapshot {
  jobs: JobHeartbeatItem[];
  queue: { recentIssues: WebhookDeliveryIssue[] };
}

interface PlatformLogRow {
  id: string;
  time: string;
  level: LogLevel;
  source: string;
  message: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

function jobLevel(status: JobStatus): LogLevel {
  return status === "failed" ? "error" : "info";
}

function toPlatformRows(snapshot: JobSchedulerSnapshot): PlatformLogRow[] {
  const jobRows: PlatformLogRow[] = snapshot.jobs.map((j) => ({
    id: `job:${j.jobName}`,
    time: j.lastFinishedAt ?? j.updatedAt,
    level: jobLevel(j.status),
    source: `job:${j.jobName}`,
    message:
      j.status === "failed"
        ? (j.lastError ?? "作业失败，无错误详情")
        : `当前状态：${j.status}`,
  }));
  const webhookRows: PlatformLogRow[] = snapshot.queue.recentIssues.map(
    (d) => ({
      id: `webhook:${d.id}`,
      time: d.lastAttemptAt ?? "",
      level: d.status === "dead" ? "error" : "warn",
      source: "webhook",
      message: `${d.eventType} 投递${d.status === "dead" ? "已死信" : "失败"}（尝试 ${d.attempts}/${d.maxAttempts}）：${d.lastError ?? "未知错误"}`,
    }),
  );
  return [...jobRows, ...webhookRows];
}

function formatTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("zh-CN", { hour12: false });
}

export default function LogsPage() {
  const { toast } = useToast();

  /* ── Atlas 侧状态 ─────────────────────────────────────────────────────── */
  const [atlasRows, setAtlasRows] = useState<AtlasRequestLogRecord[]>([]);
  const [atlasCursor, setAtlasCursor] = useState<string | null>(null);
  const [atlasLoad, setAtlasLoad] = useState<LoadState>({ kind: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [atlasStatus, setAtlasStatus] = useState<string>("all");
  const [modelCode, setModelCode] = useState("");
  const [providerCode, setProviderCode] = useState("");
  /**
   * **两张表共用的那一根键**（product_251 X-2），所以它住在页面上而不是任一张表里。
   *
   * 此前它叫 `atlasTaskId` 且只驱动上面那张，下面的 Runos 调用流根本没有 taskId 入口
   * ——那条"把值贴到两边"的注释是想法，不是实现。
   */
  const [taskId, setTaskId] = useState("");
  const [atlasSel, setAtlasSel] = useState<readonly string[]>([]);

  /* ── 平台侧状态 ───────────────────────────────────────────────────────── */
  const [rows, setRows] = useState<PlatformLogRow[]>([]);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [keyword, setKeyword] = useState("");
  const [level, setLevel] = useState<LogLevel | "all">("all");
  const [sort, setSort] = useState<DataTableSort>({
    columnId: "time",
    direction: "desc",
  });
  const [selected, setSelected] = useState<readonly string[]>([]);

  const atlasQuery = useCallback(
    (cursor?: string) => {
      const p = new URLSearchParams();
      if (atlasStatus !== "all") p.set("status", atlasStatus);
      if (modelCode.trim()) p.set("modelCode", modelCode.trim());
      if (providerCode.trim()) p.set("providerCode", providerCode.trim());
      if (taskId.trim()) p.set("taskId", taskId.trim());
      p.set("limit", "50");
      if (cursor) p.set("cursor", cursor);
      return `/api/atlas/logs?${p.toString()}`;
    },
    [atlasStatus, modelCode, providerCode, taskId],
  );

  const reloadAtlas = useCallback(async () => {
    setAtlasLoad({ kind: "loading" });
    try {
      const data = await api.get<AtlasRequestLogPage>(atlasQuery());
      setAtlasRows(data.items);
      setAtlasCursor(data.nextCursor);
      setAtlasLoad({ kind: "ready" });
    } catch (error) {
      setAtlasLoad({
        kind: "error",
        message:
          error instanceof OperaApiError
            ? error.message
            : "读取 Atlas 请求日志失败",
      });
    }
  }, [atlasQuery]);

  const loadMoreAtlas = async () => {
    if (!atlasCursor) return;
    setLoadingMore(true);
    try {
      const data = await api.get<AtlasRequestLogPage>(atlasQuery(atlasCursor));
      setAtlasRows((prev) => [...prev, ...data.items]);
      setAtlasCursor(data.nextCursor);
    } catch (error) {
      toast({
        tone: "danger",
        title: "加载更多失败",
        ...(error instanceof OperaApiError && error.message
          ? { description: error.message }
          : {}),
      });
    } finally {
      setLoadingMore(false);
    }
  };

  const reloadPlatform = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const data = await api.get<JobSchedulerSnapshot>("/api/job-scheduler");
      setRows(toPlatformRows(data));
      setLoad({ kind: "ready" });
    } catch (error) {
      setLoad({
        kind: "error",
        message:
          error instanceof OperaApiError ? error.message : "读取运行日志失败",
      });
    }
  }, []);

  useEffect(() => {
    void reloadAtlas();
  }, [reloadAtlas]);

  useEffect(() => {
    void reloadPlatform();
  }, [reloadPlatform]);

  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const filteredRows = rows.filter(
      (r) =>
        (level === "all" || r.level === level) &&
        (kw === "" || r.message.toLowerCase().includes(kw)),
    );
    return [...filteredRows].sort((a, b) =>
      sort.direction === "asc"
        ? a.time.localeCompare(b.time)
        : b.time.localeCompare(a.time),
    );
  }, [rows, keyword, level, sort]);

  const pager = useListPagination(visible, 20);

  const copyAtlasRow = async (r: AtlasRequestLogRecord) => {
    const text = [
      formatTime(r.createdAt),
      r.requestId,
      /* 带上 taskId：复制一行最常见的下一步就是拿它去 Runos 那张表里对。 */
      r.taskId ?? "—",
      r.status,
      r.modelCode ?? "—",
      r.providerCode ?? "—",
      `${r.totalTokens ?? 0} tokens`,
      r.latencyMs != null ? `${r.latencyMs}ms` : "—",
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

  const copyPlatformRow = async (r: PlatformLogRow) => {
    const text = [
      r.time || "—",
      LOG_LEVEL_META[r.level].label,
      r.source,
      r.message,
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

  const atlasEmpty =
    atlasLoad.kind === "loading" ? (
      <EmptyState title="读取中…" description="正在读取 Atlas 请求日志。" />
    ) : atlasLoad.kind === "error" ? (
      <EmptyState
        title="读取失败"
        description={atlasLoad.message}
        action={
          <Button variant="secondary" onClick={() => void reloadAtlas()}>
            重试
          </Button>
        }
      />
    ) : (
      <EmptyState
        title={taskId.trim() ? "这次任务没有模型请求" : "没有匹配的请求"}
        description={
          taskId.trim()
            ? /* 串联查询下的空**是一个答案，不是一次失败**——与下方 Runos 那侧同理。
                 写成通用的「没有匹配的请求」会让人去查权限和网络。 */
              `任务 ${taskId.trim()} 在模型面没有请求记录。若它在下方 Runos 能力调用里有行，说明这次任务只碰了能力面。`
            : "换个筛选条件，或该时间段内网关没有流量。"
        }
      />
    );

  const platformEmpty =
    load.kind === "loading" ? (
      <EmptyState title="读取中…" description="正在读取平台运行日志。" />
    ) : load.kind === "error" ? (
      <EmptyState
        title="读取失败"
        description={load.message}
        action={
          <Button variant="secondary" onClick={() => void reloadPlatform()}>
            重试
          </Button>
        }
      />
    ) : (
      <EmptyState
        title="暂无运行日志"
        description="后台任务与投递队列当前没有异常。"
      />
    );

  return (
    <ViewLayout>
      <ViewHeader
        icon="terminal"
        title="调用日志"
        description="请求级运行事实，按来源分区：Atlas 网关请求、Runos 能力调用、平台自身后台作业。追责类记录不在这里，在「安全审计 · 变更审计」。"
      />

      {/* 串联态必须**说出来**。两张表同时被同一个 taskId 筛过之后，如果哪一侧空了，
          「被筛掉了」与「本来就没有」在界面上长得一样——而这条接缝下空是常态：
          当前能力目录里没有任何一条端点打到 Atlas。 */}
      {taskId.trim() ? (
        <Banner
          tone="info"
          title={`正在按任务 ${taskId.trim()} 串联两张表`}
          description="Atlas 请求日志与 Runos 能力调用都已按这个 taskId 过滤——同一次任务在模型面与能力面各发生了什么，在这一屏里对齐。任一侧为空是一个答案，不是故障。"
          action={
            <Button variant="secondary" size="sm" onClick={() => setTaskId("")}>
              取消串联
            </Button>
          }
        />
      ) : null}

      <Section
        title="Atlas 请求日志"
        icon="terminal"
        level={2}
        description="来自 Atlas 的 /capability/logs：请求级事实，含模型、Provider、Token、延迟与错误。游标分页，只能顺序前进。"
        action={
          <Button
            variant="ghost"
            size="md"
            onClick={() => void reloadAtlas()}
            disabled={atlasLoad.kind === "loading"}
          >
            <Icon name="refresh" size="sm" aria-hidden="true" />
            刷新
          </Button>
        }
      >
        <FilterBar
          view="list"
          onViewChange={() => {}}
          cardsDisabledReason="卡片视图已下线，改用列表"
          count={atlasCursor ? `${atlasRows.length}+` : atlasRows.length}
        >
          <InputGroup className="grow basis-media-3xl max-w-panel-sm">
            <InputGroupAddon>
              <Icon name="search" size="sm" aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="模型编码（modelCode）…"
              aria-label="按模型编码筛选"
              value={modelCode}
              onChange={(e) => setModelCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void reloadAtlas();
              }}
            />
          </InputGroup>
          <InputGroup className="grow basis-media-2xl max-w-panel-sm">
            <InputGroupAddon>
              <Icon name="plugs-connected" size="sm" aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="Provider 编码…"
              aria-label="按 Provider 编码筛选"
              value={providerCode}
              onChange={(e) => setProviderCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void reloadAtlas();
              }}
            />
          </InputGroup>
          {/* 精确匹配，**同时驱动下方 Runos 能力调用**：一个值，两张表。
              两张表里的 taskId 都可以直接点，点哪边都填到这里——接缝是双向的，
              「从模型面查到能力面」和反过来是同一个动作。 */}
          <InputGroup className="grow basis-media-2xl max-w-panel-sm">
            <InputGroupAddon>
              <Icon name="workflow" size="sm" aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="任务 ID（taskId）…"
              aria-label="按任务 ID 筛选"
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void reloadAtlas();
              }}
            />
          </InputGroup>
          <NativeSelect
            wrapperClassName="w-fit"
            value={atlasStatus}
            onChange={(e) => setAtlasStatus(e.target.value)}
            aria-label="状态筛选"
          >
            <option value="all">全部状态</option>
            {ATLAS_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </NativeSelect>
        </FilterBar>

        <DataTable
          columns={[
            {
              id: "time",
              header: "时间",
              width: "sm",
              cell: (r: AtlasRequestLogRecord) => formatTime(r.createdAt),
            },
            {
              id: "requestId",
              header: "Request ID",
              width: "sm",
              cell: (r: AtlasRequestLogRecord) => (
                <span className="font-mono text-code-sm">{r.requestId}</span>
              ),
            },
            {
              /**
               * 与下方 Runos 调用流水共用的那一根键（product_251 X-2）。
               *
               * 此前这张表**没有这一列**——taskId 只出现在"复制整行"的文本里。
               * 一个只能过滤、看不见、点不了的接缝，等于没有接缝：想跨表对一次任务，
               * 得先复制一行、从文本里把它抠出来、再贴到另一个框里。
               */
              id: "task",
              header: "任务",
              width: "sm",
              cell: (r: AtlasRequestLogRecord) =>
                r.taskId ? (
                  <Button
                    variant="link"
                    size="sm"
                    className="font-mono text-code-sm"
                    title="按这个任务串联上下两张表"
                    onClick={() => setTaskId(r.taskId ?? "")}
                  >
                    {r.taskId}
                  </Button>
                ) : (
                  <span
                    className="text-muted-foreground"
                    title="这一行没有 taskId —— 早于 X-2 落地的请求，或不是 agent 发起的"
                  >
                    —
                  </span>
                ),
            },
            {
              id: "model",
              header: "模型 / Provider",
              cell: (r: AtlasRequestLogRecord) => (
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
              id: "tokens",
              header: "Token（入/出）",
              align: "right",
              width: "xs",
              cell: (r: AtlasRequestLogRecord) =>
                `${r.inputTokens ?? 0} / ${r.outputTokens ?? 0}`,
            },
            {
              id: "latency",
              header: "延迟",
              align: "right",
              width: "xs",
              cell: (r: AtlasRequestLogRecord) =>
                r.latencyMs != null ? `${r.latencyMs}ms` : "—",
            },
            {
              id: "status",
              header: "状态",
              align: "center",
              width: "xs",
              cell: (r: AtlasRequestLogRecord) => (
                <StatusBadge tone={atlasStatusTone(r.status)} dot>
                  {r.status}
                </StatusBadge>
              ),
            },
          ]}
          rows={atlasRows}
          rowKey={(r) => r.id}
          selectedKeys={atlasSel}
          onSelectionChange={setAtlasSel}
          indexStart={1}
          rowActions={(r: AtlasRequestLogRecord) => (
            <ActionMenu
              label="请求操作"
              items={[
                {
                  id: "copy",
                  label: "复制该行",
                  icon: "copy",
                  onSelect: () => void copyAtlasRow(r),
                },
              ]}
            />
          )}
          empty={atlasEmpty}
          footer={
            <div className="flex w-full items-center justify-between gap-sm">
              <span className="text-body-sm text-muted-foreground">
                已加载 {atlasRows.length} 条
                {atlasCursor ? "，还有更多" : "（已到末尾）"}
              </span>
              {atlasCursor ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loadingMore}
                  onClick={() => void loadMoreAtlas()}
                >
                  {loadingMore ? "加载中…" : "加载更多"}
                </Button>
              ) : null}
            </div>
          }
        />
      </Section>

      <Section
        title="Runos 能力调用"
        icon="stack"
        level={2}
        description="agent 实际调用了哪些能力：延迟、裁决、错误类，以及这次调用记在哪个工作区。「任务反馈」是 agent 自报的成败（纯断言层），可信度与网关记录不同，故切换而非并列。"
      >
        <RunosCallStreams taskId={taskId} onTaskIdChange={setTaskId} />
      </Section>

      <Section
        title="平台后台作业"
        icon="gauge"
        level={2}
        description="opera-bff 自身的作业心跳与 webhook 投递队列——平台自监控信号，与 Atlas 流量无关。"
      >
        <FilterBar
          view="list"
          onViewChange={() => {}}
          cardsDisabledReason="卡片视图已下线，改用列表"
          count={
            visible.length === rows.length
              ? rows.length
              : `${visible.length} / ${rows.length}`
          }
        >
          <InputGroup className="grow basis-media-3xl max-w-panel-sm">
            <InputGroupAddon>
              <Icon name="search" size="sm" aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="搜索日志内容…"
              aria-label="搜索日志"
              value={keyword}
              onChange={(e) => {
                setKeyword(e.target.value);
                pager.resetPage();
              }}
            />
          </InputGroup>
          <NativeSelect
            wrapperClassName="w-fit"
            value={level}
            onChange={(e) => {
              setLevel(e.target.value as LogLevel | "all");
              pager.resetPage();
            }}
            aria-label="级别筛选"
          >
            <option value="all">全部级别</option>
            <option value="error">ERROR</option>
            <option value="warn">WARN</option>
            <option value="info">INFO</option>
          </NativeSelect>
        </FilterBar>

        <DataTable
          columns={[
            {
              id: "time",
              header: "时间",
              width: "sm",
              cell: (r: PlatformLogRow) => formatTime(r.time),
              sortable: true,
            },
            {
              id: "source",
              header: "来源",
              width: "xs",
              cell: (r: PlatformLogRow) => (
                <Badge variant="secondary">{r.source}</Badge>
              ),
            },
            {
              id: "message",
              header: "内容",
              cell: (r: PlatformLogRow) => r.message,
            },
            {
              id: "level",
              header: "级别",
              align: "center",
              width: "xs",
              cell: (r: PlatformLogRow) => (
                <StatusBadge tone={LOG_LEVEL_META[r.level].tone}>
                  {LOG_LEVEL_META[r.level].label}
                </StatusBadge>
              ),
            },
          ]}
          rows={pager.pageRows}
          rowKey={(r) => r.id}
          selectedKeys={selected}
          onSelectionChange={setSelected}
          indexStart={pager.indexStart}
          sort={sort}
          onSortChange={setSort}
          rowActions={(r: PlatformLogRow) => (
            <ActionMenu
              label="日志操作"
              items={[
                {
                  id: "copy",
                  label: "复制该行",
                  icon: "copy",
                  onSelect: () => void copyPlatformRow(r),
                },
              ]}
            />
          )}
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
          empty={platformEmpty}
        />
      </Section>
    </ViewLayout>
  );
}
