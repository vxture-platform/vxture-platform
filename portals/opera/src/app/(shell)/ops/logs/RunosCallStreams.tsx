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
 * 无分页：runos 侧 `limit` 服务端 clamp（默认 100、上限 1000），不信调用方。需要更早
 * 的数据只能收窄过滤条件——对 append-only 的无界流做无界查询，是把页面变成拖垮数据库
 * 的方式。关键词做**精确**过滤（`capabilityId` / `taskId`），不做跨字段模糊匹配。
 *
 * 不轮询：明细流按设计文件 §7.3 归「翻页即取」一类，自动刷新会打断正在读的人。 */

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  Icon,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  NativeSelect,
  SegmentedControl,
  StatusBadge,
  useToast,
  type StatusBadgeTone,
} from "@vxture/design-system";
import { useTenancyDirectory } from "@/features/tenancy/directory";
import { WorkspaceCell } from "@/features/tenancy/WorkspaceCell";
import { api, OperaApiError } from "@/lib/api";

type StreamKey = "calls" | "outcomes";

/**
 * 字段名跟随 runos v0.8.0：`status` → `outcome`。上游那次改名的分工是一句话——
 * **`state` 是这个对象算不算数，`outcome` 是这一次尝试怎么结束的**，调用是后者。
 */
interface CapabilityCallRecord {
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
  latencyMs: number | null;
}

interface TaskOutcomeRecord {
  taskId: string;
  occurredAt: string;
  workspaceId: string | null;
  agentId: string | null;
  outcome: string;
  note: string | null;
}

/** 上游改成 keyset 游标分页（A-3）；本页暂只取第一页，`nextCursor` 先不消费。 */
interface AuditPage<T> {
  rows: T[];
  nextCursor: string | null;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

const STREAM_META: Record<StreamKey, { label: string; placeholder: string }> = {
  calls: { label: "能力调用", placeholder: "按 capabilityId 精确过滤…" },
  outcomes: { label: "任务反馈", placeholder: "按 taskId 精确过滤…" },
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("zh-CN", { hour12: false });
}

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

export function RunosCallStreams() {
  const { toast } = useToast();
  const [stream, setStream] = useState<StreamKey>("calls");
  const [keyword, setKeyword] = useState("");
  const [limit, setLimit] = useState("100");
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [callRows, setCallRows] = useState<CapabilityCallRecord[]>([]);
  const [outcomeRows, setOutcomeRows] = useState<TaskOutcomeRecord[]>([]);

  const reload = useCallback(async () => {
    setLoad({ kind: "loading" });
    const p = new URLSearchParams({ limit });
    const kw = keyword.trim();
    try {
      if (stream === "calls") {
        if (kw) p.set("capabilityId", kw);
        const page = await api.get<AuditPage<CapabilityCallRecord>>(
          `/api/runos/audit/calls?${p.toString()}`,
        );
        setCallRows(page.rows);
      } else {
        if (kw) p.set("taskId", kw);
        const page = await api.get<AuditPage<TaskOutcomeRecord>>(
          `/api/runos/audit/outcomes?${p.toString()}`,
        );
        setOutcomeRows(page.rows);
      }
      setLoad({ kind: "ready" });
    } catch (error) {
      setLoad({
        kind: "error",
        message:
          error instanceof OperaApiError ? error.message : "读取调用流失败",
      });
    }
  }, [stream, keyword, limit]);

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
      toast({ tone: "success", title: "已复制到剪贴板" });
    } catch {
      toast({
        tone: "danger",
        title: "复制失败",
        description: "浏览器拒绝了剪贴板访问，请手动选中复制。",
      });
    }
  };

  const emptyState =
    load.kind === "loading" ? (
      <EmptyState title="读取中…" description="正在读取调用记录。" />
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
        title="没有匹配的记录"
        description="换个过滤条件，或该条数范围内这条流没有记录。"
      />
    );

  return (
    <div className="flex flex-col gap-md">
      <FilterBar
        view="list"
        onViewChange={() => {}}
        cardsDisabledReason="卡片视图已下线，改用列表"
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
      >
        <InputGroup className="grow basis-media-3xl max-w-panel-sm">
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
        <NativeSelect
          wrapperClassName="w-fit"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          aria-label="返回条数"
        >
          <option value="100">最近 100 条</option>
          <option value="500">最近 500 条</option>
          <option value="1000">最近 1000 条</option>
        </NativeSelect>
        <Button
          variant="secondary"
          onClick={() => void reload()}
          disabled={load.kind === "loading"}
        >
          <Icon name="refresh" size="sm" aria-hidden="true" />
          刷新
        </Button>
      </FilterBar>

      {stream === "calls" ? (
        <DataTable
          columns={[
            {
              id: "time",
              header: "时间",
              width: "sm",
              cell: (r: CapabilityCallRecord) => formatTime(r.occurredAt),
            },
            {
              id: "capability",
              header: "能力",
              cell: (r: CapabilityCallRecord) => (
                <span className="font-mono text-code-sm">
                  {r.capabilityId ?? "—"}
                </span>
              ),
            },
            {
              id: "agent",
              header: "调用方 / 任务",
              cell: (r: CapabilityCallRecord) => (
                <span className="text-body-sm text-muted-foreground">
                  {r.agentId ?? "—"}
                  {r.taskId ? ` · ${r.taskId}` : ""}
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
              id: "latency",
              header: "延迟",
              align: "right",
              width: "xs",
              cell: (r: CapabilityCallRecord) =>
                r.latencyMs != null ? `${r.latencyMs}ms` : "—",
            },
            {
              id: "decision",
              header: "裁决",
              align: "center",
              width: "xs",
              cell: (r: CapabilityCallRecord) => r.decision ?? "—",
            },
            {
              id: "outcome",
              header: "结果",
              align: "center",
              width: "xs",
              cell: (r: CapabilityCallRecord) => (
                <StatusBadge tone={callTone(r.outcome)} dot>
                  {r.outcome ?? "—"}
                </StatusBadge>
              ),
            },
          ]}
          rows={callRows}
          rowKey={(r) => r.callId}
          indexStart={1}
          rowActions={(r: CapabilityCallRecord) => (
            <Button
              variant="ghost"
              size="md"
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
        />
      ) : (
        <DataTable
          columns={[
            {
              id: "time",
              header: "时间",
              width: "sm",
              cell: (r: TaskOutcomeRecord) => formatTime(r.occurredAt),
            },
            {
              id: "task",
              header: "任务",
              cell: (r: TaskOutcomeRecord) => (
                <span className="font-mono text-code-sm">{r.taskId}</span>
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
              id: "agent",
              header: "Agent",
              width: "sm",
              cell: (r: TaskOutcomeRecord) => r.agentId ?? "—",
            },
            {
              id: "outcome",
              header: "自报结果",
              align: "center",
              width: "xs",
              cell: (r: TaskOutcomeRecord) => (
                <StatusBadge tone={outcomeTone(r.outcome)} dot>
                  {r.outcome}
                </StatusBadge>
              ),
            },
          ]}
          rows={outcomeRows}
          rowKey={(r) => `${r.taskId}:${r.occurredAt}`}
          indexStart={1}
          empty={emptyState}
        />
      )}
    </div>
  );
}
