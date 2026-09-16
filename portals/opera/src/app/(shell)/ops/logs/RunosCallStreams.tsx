"use client";

/* Runos 能力调用与任务反馈 — 两条**运行事实**流。
 *
 * 2026-08-14 自 `/runos/audit`（原安全审计域）迁入（设计文件 §5）。搬家的判据不是
 * 「哪个产品产的」而是**这条记录是什么性质**：
 *
 *   问责数据（谁改了什么）  → 安全审计 · 变更审计
 *   运行事实（系统怎么样了）→ 本页
 *
 * 调用流水与请求日志、指标同类——延迟、裁决、错误类，看的人在排障不在追责。摆在
 * 「安全审计」下面，是把**监测信号**错分成了**问责证据**；真要追责时，它又淹没在
 * 每一次正常调用里。
 *
 * **两条流分开呈现，不合并成一张时间线**——它们的**可信度不同**：
 *   - `capability_call`：网关每次「解析到操作」的尝试恰好写一条，是网关记录的事实
 *   - `task_outcome`：**纯断言层**（ADR-006），agent **自报**的成败，只喂贡献度评分，
 *     从不参与强制执行
 * 混排会让人以为后者与前者同等可信。所以是切换而不是并列。
 *
 * **游标翻页**（product_251 A-3）：runos 三条流水都是 keyset 游标 + 服务端 clamp 的
 * `limit`。此前这里只取第一页、`nextCursor` 一次都没消费，界面上换成了「最近
 * 100 / 500 / 1000 条」的档位选择器——**超出 1000 条的历史根本够不着，而界面没有任何
 * 地方说明这一点**。那不是 UI 欠账，是平台侧漏读了上游已经满足的契约。
 *
 * 现在与同一页 Atlas 那半同形：固定页大小 + 「已加载 N 条，还有更多 / 加载更多」。
 * 页脚**必须显式说到没到末尾**——「加载完了」与「加载不动了」在界面上长得一样，而
 * 前者是答案、后者是故障。
 *
 * 关键词做**精确**过滤（`capabilityId` / `taskId`），不做跨字段模糊匹配：对
 * append-only 的无界流做无界模糊查询，是把页面变成拖垮数据库的方式。
 *
 * 不轮询：明细流按设计文件 §7.3 归「翻页即取」一类，自动刷新会打断正在读的人。 */

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useTableLabels } from "@/lib/table";
import {
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  Icon,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  SegmentedControl,
  StatusBadge,
  useToast,
  type StatusBadgeTone,
  ActionButton,
  TableTitleCell,
} from "@vxture/design-system";
import { useTenancyDirectory } from "@/features/tenancy/directory";
import { WorkspaceCell } from "@/features/tenancy/WorkspaceCell";
import { api, OperaApiError } from "@/lib/api";
import { DateCell } from "@/components/table/ConfigCells";
import { LoadMoreFooter } from "@/modules/shared/LoadMoreFooter";
import { visibleIdOr } from "@/lib/visible-id";

type StreamKey = "calls" | "outcomes";

/**
 * 字段名跟随 runos v0.8.0：`status` → `outcome`。上游那次改名的分工是一句话——
 * **`state` 是这个对象算不算数，`outcome` 是这一次尝试怎么结束的**，调用是后者。
 */
interface CapabilityCallRecord {
  /** 主键。`callId` **不唯一**（上游只有非唯一索引，配 `retryOf`——一次调用可以落
   *  多条事件行），所以行标识用这个。
   *
   *  原先这里还列着 `sequenceNo`，那一列已退役（runos TD-015）：计数器在网关进程内存
   *  里，淘汰或重启都会让同一个任务从 1 重来。排序用 `occurredAt` + `eventId`。 */
  eventId: string;
  callId: string;
  occurredAt: string;
  taskId: string | null;
  capabilityId: string | null;
  workspaceId: string | null;
  agentId: string | null;
  outcome: string | null;
  decision: string | null;
  errorClass: string | null;
  errorCode: string | null;
  /** 端到端。上游把延迟拆成 total / gateway / capability 三个，**没有 `latencyMs`**
   *  ——本页此前读的正是那个不存在的名字，于是延迟列恒为「—」且不报错。 */
  latencyTotalMs: number | null;
  latencyGatewayMs: number | null;
  latencyCapabilityMs: number | null;
  /** `Decimal(18,6)` 上线是**字符串**（实测确认）。别转 number 再算。 */
  costAmount: string | null;
  /** 开放词表（`call` / `token` / `candidate` / `page` …），必须与量同时显示。 */
  costUnit: string | null;
  bytesIn: number | null;
  bytesOut: number | null;
  matchedPolicyIds: string[];
  degradedMode: boolean;
}

interface TaskOutcomeRecord {
  taskId: string;
  occurredAt: string;
  workspaceId: string | null;
  agentId: string | null;
  outcome: string;
  note: string | null;
}

/** keyset 游标分页（A-3），集合键 `items`（A-4，两个上游同形）。 */
interface AuditPage<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * 固定页大小，与同一页 Atlas 请求日志那半保持同一个数量级。
 *
 * 换掉的是「最近 100 / 500 / 1000 条」——那不是页大小，是**能看到多远的上限**，
 * 而 runos 把 `limit` clamp 在 1000，所以第三档同时也是天花板。有了游标之后
 * 上限消失了，档位就没有意义了。
 */
const PAGE_SIZE = 100;

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

const STREAM_META: Record<StreamKey, { label: string; placeholder: string }> = {
  calls: { label: "能力调用", placeholder: "按 capabilityId 精确过滤…" },
  outcomes: { label: "任务反馈", placeholder: "按 taskId 精确过滤…" },
};

/* 收 `locale` 而不是写死 `"zh-CN"`：日期的字段顺序属于语言——
   中文 `2026/8/18 10:37`，英文 `8/18/2026, 10:37`。写死的后果不是「没翻译」，
   是英文用户会把 8/18 读成 18 月。（数字与百分比两种语言逐字相同，所以那些
   没跟着改，见 scripts/guardrails 旁的说明。） */

function callTone(outcome: string | null): StatusBadgeTone {
  if (outcome === "success") return "success";
  if (outcome === "error" || outcome === "rejected") return "danger";
  if (outcome === "timeout") return "warning";
  return "neutral";
}

function outcomeTone(outcome: string): StatusBadgeTone {
  if (outcome === "success") return "success";
  if (outcome === "failure") return "danger";
  if (outcome === "partial") return "warning";
  return "neutral";
}

/**
 * `taskId` 由页面持有而不是本组件——它是**两张表共用的那一根键**（product_251 X-2），
 * 上面的 Atlas 请求日志用同一个值过滤。放在任一侧都会让另一侧变成"跟随者"，而这条
 * 接缝的意义恰恰是两边平权：从模型面点进来，和从能力面点过去，是同一个动作。
 */
export function RunosCallStreams({
  taskId,
  onTaskIdChange,
}: {
  readonly taskId: string;
  readonly onTaskIdChange: (next: string) => void;
}) {
  const locale = useLocale();
  const tShared = useTranslations();
  const tableLabels = useTableLabels();
  const { toast } = useToast();
  const [stream, setStream] = useState<StreamKey>("calls");
  const [keyword, setKeyword] = useState("");
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [callRows, setCallRows] = useState<CapabilityCallRecord[]>([]);
  const [outcomeRows, setOutcomeRows] = useState<TaskOutcomeRecord[]>([]);
  /* 两条流各有各的游标：切流不是翻页，拿着上一条流的游标去问另一条流会被
     `AUDIT_INVALID_CURSOR` 拒掉——那是对的，但错在我们这边。 */
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const query = useCallback(
    (nextCursor?: string) => {
      const p = new URLSearchParams({ limit: String(PAGE_SIZE) });
      /* `taskId` 与关键词是**两根不同的轴**，同时生效：任务是"哪一次任务"，
         关键词在调用流上是"哪个能力"。此前调用流的关键词打在 `capabilityId` 上、
         而 `taskId` 根本没有入口——于是 Atlas 那侧写着"把值贴到两边"的注释，
         实际贴不进来，这条接缝从来没被真的走通过。 */
      const task = taskId.trim();
      if (task) p.set("taskId", task);
      const kw = keyword.trim();
      if (kw) p.set(stream === "calls" ? "capabilityId" : "taskId", kw);
      if (nextCursor) p.set("cursor", nextCursor);
      const path = stream === "calls" ? "calls" : "outcomes";
      return `/api/runos/audit/${path}?${p.toString()}`;
    },
    [stream, keyword, taskId],
  );

  const reload = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      if (stream === "calls") {
        const page = await api.get<AuditPage<CapabilityCallRecord>>(query());
        setCallRows(page.items);
        setCursor(page.nextCursor);
      } else {
        const page = await api.get<AuditPage<TaskOutcomeRecord>>(query());
        setOutcomeRows(page.items);
        setCursor(page.nextCursor);
      }
      setLoad({ kind: "ready" });
    } catch (error) {
      setLoad({
        kind: "error",
        message:
          error instanceof OperaApiError ? error.message : "读取调用流失败",
      });
    }
  }, [stream, query]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      if (stream === "calls") {
        const page = await api.get<AuditPage<CapabilityCallRecord>>(
          query(cursor),
        );
        setCallRows((prev) => [...prev, ...page.items]);
        setCursor(page.nextCursor);
      } else {
        const page = await api.get<AuditPage<TaskOutcomeRecord>>(query(cursor));
        setOutcomeRows((prev) => [...prev, ...page.items]);
        setCursor(page.nextCursor);
      }
    } catch (error) {
      /* 翻页失败不清空已读到的行，也不把整块变成错误态：手里那几页是真实数据，
         丢掉它们等于用一次网络抖动惩罚读者。 */
      toast({
        tone: "danger",
        title: tShared("common.loadMoreFailed"),
        ...(error instanceof OperaApiError && error.message
          ? { description: error.message }
          : {}),
      });
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    void reload();
  }, [reload]);

  /* 工作区一律以租户为主导显示（规则见 features/tenancy/directory.ts）：工作区名
     几乎全是「默认工作空间」，单独显示等于一屏重复的同一个词。 */
  const tenancy = useTenancyDirectory(
    [],
    [...callRows, ...outcomeRows]
      .map((r) => r.workspaceId)
      .filter((v): v is string => !!v),
  );

  const copyRow = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ tone: "success", title: tShared("common.copied") });
    } catch {
      toast({
        tone: "danger",
        title: tShared("common.copyFailed"),
        description: tShared("common.copyDenied"),
      });
    }
  };

  /**
   * 页脚**必须显式说到没到末尾**：「加载完了」与「加载不动了」在界面上长得一样，
   * 而前者是答案、后者是故障。此前这里既没有游标也没有这句话，运营者看到的是一个
   * 沉默的截断。
   */
  const streamFooter = (loaded: number) => (
    <LoadMoreFooter
      loaded={loaded}
      hasMore={Boolean(cursor)}
      loading={loadingMore}
      onLoadMore={() => void loadMore()}
    />
  );

  const emptyState =
    load.kind === "loading" ? (
      <EmptyState
        title={tShared("common.loading")}
        description="正在读取调用记录。"
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
      <EmptyState
        title={
          taskId.trim()
            ? "这次任务没有能力调用"
            : tShared("common.noMatchingRecords")
        }
        description={
          taskId.trim()
            ? /* 串联查询下的空**是一个答案，不是一次失败**。当前能力目录里没有
                 任何一条端点打到 Atlas（全指向 MCP 连接器与本地执行器），所以
                 "模型面有请求、能力面没有"是预期结果而不是故障。写成通用的
                 "没有匹配的记录"会让人去查权限和网络。 */
              `任务 ${taskId.trim()} 在能力面没有记录。若它在上方 Atlas 请求日志里有行，说明这次任务只碰了模型面——这在当前能力目录下是正常的。`
            : "换个过滤条件，或这条流还没有记录。"
        }
      />
    );

  return (
    <div className="flex flex-col gap-md">
      <FilterBar
        view="list"
        onViewChange={() => {}}
        cardsDisabledReason={tShared("common.cardsRetired")}
        count={stream === "calls" ? callRows.length : outcomeRows.length}
        scope={
          <SegmentedControl<StreamKey>
            ariaLabel="事件流"
            value={stream}
            onChange={(v) => {
              setStream(v);
              setKeyword("");
            }}
            items={(["calls", "outcomes"] as const).map((k) => ({
              value: k,
              label: STREAM_META[k].label,
            }))}
          />
        }
        search={
          <InputGroup className="min-w-media-2xl grow basis-0 max-w-panel-sm">
            <InputGroupAddon>
              <Icon name="search" size="sm" aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              placeholder={STREAM_META[stream].placeholder}
              aria-label="过滤调用记录"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void reload();
              }}
            />
          </InputGroup>
        }
        actions={
          <ActionButton
            variant="outline"
            icon="refresh"
            onClick={() => void reload()}
            disabled={load.kind === "loading"}
          >
            {tShared("common.refresh")}
          </ActionButton>
        }
      />

      {stream === "calls" ? (
        <DataTable
          labels={tableLabels}
          columns={[
            {
              id: "capability",
              header: "能力",
              cell: (r: CapabilityCallRecord) => (
                <TableTitleCell
                  icon="stack"
                  title={
                    <span className="font-mono">{r.capabilityId ?? "—"}</span>
                  }
                  description={visibleIdOr(r.callId, r.agentId ?? "—")}
                />
              ),
            },
            {
              id: "agent",
              header: "调用方 / 任务",
              cell: (r: CapabilityCallRecord) => (
                <span className="text-body-sm text-muted-foreground">
                  {r.agentId ?? "—"}
                  {r.taskId ? (
                    <>
                      {" · "}
                      <Button
                        variant="link"
                        size="sm"
                        className="font-mono text-code-sm"
                        title="按这个任务串联上下两张表"
                        onClick={() => onTaskIdChange(r.taskId ?? "")}
                      >
                        {r.taskId}
                      </Button>
                    </>
                  ) : null}
                </span>
              ),
            },
            {
              /**
               * 计量主体（ADR-010 §3）。授权与计量在这里是**两根不同的轴**，同一行
               * 上都要能读到：授权主体是产品（产品能用，它的租户就能用），而这一次
               * 调用记在哪个工作区，是账单要回答的问题。工作区与租户是一根轴的两个
               * 深度，workspace_id 蕴含 tenant_id，所以显示到工作区这一层就够了。
               */
              id: "workspace",
              header: "计量归属",
              width: "sm",
              cell: (r: CapabilityCallRecord) => (
                <WorkspaceCell
                  directory={tenancy}
                  workspaceId={r.workspaceId}
                />
              ),
            },
            {
              /* 显示端到端；网关与能力各自那段挂在 title 上——「慢在哪一段」是排障
                 的第一个分叉，但把三个数平铺在列里会把这张表挤成一堵数字墙。 */
              id: "latency",
              header: "延迟",
              align: "numeric",
              width: "xs",
              cell: (r: CapabilityCallRecord) =>
                r.latencyTotalMs != null ? (
                  <span
                    title={
                      r.latencyGatewayMs != null ||
                      r.latencyCapabilityMs != null
                        ? `网关 ${r.latencyGatewayMs ?? "—"}ms · 能力 ${r.latencyCapabilityMs ?? "—"}ms`
                        : undefined
                    }
                  >
                    {r.latencyTotalMs}ms
                  </span>
                ) : (
                  "—"
                ),
            },
            {
              /**
               * 匹配到的策略挂在 title 上——空数组是常态（默认放行不匹配任何策略），
               * 单独成列会是一整列的「—」。
               *
               * `degradedMode` 反过来必须**看得见**：它限定这一行其余数字的可信度。
               * 一个在降级模式下放行的调用，与一个正常放行的调用，不是同一件事，
               * 而两者的 `decision` 都是 `allow`。
               */
              id: "decision",
              header: "裁决",
              width: "xs",
              cell: (r: CapabilityCallRecord) => (
                <span
                  className="inline-flex items-center gap-xs"
                  title={
                    r.matchedPolicyIds.length
                      ? `匹配策略：${r.matchedPolicyIds.join("、")}`
                      : "未匹配任何策略（默认放行路径）"
                  }
                >
                  {r.decision ?? "—"}
                  {r.degradedMode ? (
                    <StatusBadge tone="warning" dot>
                      {tShared("status.generic.degraded")}
                    </StatusBadge>
                  ) : null}
                </span>
              ),
            },
            {
              id: "outcome",
              header: "结果",
              width: "xs",
              cell: (r: CapabilityCallRecord) => (
                <StatusBadge tone={callTone(r.outcome)} dot>
                  {r.outcome ?? "—"}
                </StatusBadge>
              ),
            },
            {
              /**
               * **量与单位同格**，不拆成两列也不只显示量：`costUnit` 是开放词表
               * （product_251 X-3 v0.4），同一列里 `rerank` 按 candidate、`parse`
               * 按 page、多数按 call。只显示数字，等于邀请人把 token 和页数加起来——
               * 那正是 X-3 举的 `SUM()` 例子。
               *
               * 原样显示字符串、不做 Number 转换：上游是 `Decimal(18,6)`，
               * 走一趟浮点就把它存在的理由丢了。
               */
              id: "cost",
              header: "计量",
              align: "numeric",
              width: "xs",
              cell: (r: CapabilityCallRecord) =>
                r.costAmount != null ? (
                  <span
                    className="font-mono text-code-sm"
                    title={`载荷 ${r.bytesIn ?? "—"} B 入 / ${r.bytesOut ?? "—"} B 出`}
                  >
                    {r.costAmount}
                    <span className="text-muted-foreground">
                      {" "}
                      {r.costUnit ?? "?"}
                    </span>
                  </span>
                ) : (
                  "—"
                ),
            },
            {
              id: "time",
              header: tShared("columns.time"),
              width: "sm",
              cell: (r: CapabilityCallRecord) => (
                <DateCell value={r.occurredAt} locale={locale} />
              ),
            },
          ]}
          rows={callRows}
          rowKey={(r) => r.eventId}
          indexStart={1}
          rowActions={(r: CapabilityCallRecord) => (
            <Button
              variant="ghost"
              size="icon-md"
              aria-label="复制调用 ID"
              title={
                r.errorCode
                  ? `${r.errorClass ?? ""} ${r.errorCode}`.trim()
                  : "复制调用 ID"
              }
              onClick={() => void copyRow(r.callId)}
            >
              <Icon name="copy" size="sm" aria-hidden="true" />
            </Button>
          )}
          empty={emptyState}
          footer={streamFooter(callRows.length)}
        />
      ) : (
        <DataTable
          labels={tableLabels}
          columns={[
            {
              id: "task",
              header: "任务",
              cell: (r: TaskOutcomeRecord) => (
                <TableTitleCell
                  icon="workflow"
                  title={<span className="font-mono">{r.taskId}</span>}
                  description={r.agentId ?? "—"}
                  tooltip="按这个任务串联上下两张表"
                  onTitleClick={() => onTaskIdChange(r.taskId)}
                />
              ),
            },
            {
              /* 同 calls 流：这条结果记在哪个工作区，是账单要回答的问题。 */
              id: "workspace",
              header: "计量归属",
              width: "sm",
              cell: (r: TaskOutcomeRecord) => (
                <WorkspaceCell
                  directory={tenancy}
                  workspaceId={r.workspaceId}
                />
              ),
            },
            {
              id: "note",
              header: "备注",
              cell: (r: TaskOutcomeRecord) => (
                <span className="text-body-sm text-muted-foreground">
                  {r.note ?? "—"}
                </span>
              ),
            },
            {
              id: "outcome",
              header: "自报结果",
              width: "xs",
              cell: (r: TaskOutcomeRecord) => (
                <StatusBadge tone={outcomeTone(r.outcome)} dot>
                  {r.outcome}
                </StatusBadge>
              ),
            },
            {
              id: "time",
              header: tShared("columns.time"),
              width: "sm",
              cell: (r: TaskOutcomeRecord) => (
                <DateCell value={r.occurredAt} locale={locale} />
              ),
            },
          ]}
          rows={outcomeRows}
          rowKey={(r) => `${r.taskId}:${r.occurredAt}`}
          indexStart={1}
          empty={emptyState}
          footer={streamFooter(outcomeRows.length)}
        />
      )}
    </div>
  );
}
