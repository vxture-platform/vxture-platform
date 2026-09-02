"use client";

/* 平台留痕 — opera-bff 的 `support.audit_logs`（`actor_type='operator'`）。
 *
 * 三个来源里**唯一跨域的一份**：模型面、能力面、产品登记，凡是经过 opera 的写都在
 * 这里，所以它是「先看哪个 tab」的答案。代价是它**只**看得到经过 opera 的写——直连
 * 上游管理面做的改动这份完全不知道，那正是另外两个 tab 存在的理由。
 *
 * 2026-08-12 接真实数据时确立的一条口径保留至今：如实展示点分动词与资源类型
 * （`provider.update` / `endpoint.create`），不翻译成「Router 变更」这类中文动作名。
 * 运营者在别处（跨仓 issue、上游日志）看到的就是点分动词，控制台自造一套中文词表
 * 只会在两者相接的地方还回去。admin 与 opera 写的是同一张平台级审计表。 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ActionMenu,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  Icon,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  NativeSelect,
  StatusBadge,
  type DataTableSort,
  type StatusBadgeTone,
  useListPagination,
  useToast,
} from "@vxture/design-system";
import { ListPagination } from "@/modules/shared/ListPagination";
import { api, OperaApiError } from "@/lib/api";

/** 字段名对齐 product_251 X-3 的统一审计记录（见 opera-bff 同名接口）。 */
interface AuditLogEntry {
  eventId: string;
  occurredAt: string;
  actorId: string;
  actorConsole: string | null;
  actorName: string;
  action: string;
  outcome: string;
  objectType: string;
  objectId: string;
  errorCode: string | null;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

const OUTCOME_TONE: Record<string, StatusBadgeTone> = {
  success: "success",
  denied: "warning",
  failure: "danger",
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

export function PlatformChangeTable() {
  const locale = useLocale();
  const tShared = useTranslations();
  const { toast } = useToast();
  const [rows, setRows] = useState<AuditLogEntry[]>([]);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [keyword, setKeyword] = useState("");
  const [action, setAction] = useState("all");
  const [sort, setSort] = useState<DataTableSort>({
    columnId: "occurredAt",
    direction: "desc",
  });

  const reload = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const data = await api.get<AuditLogEntry[]>("/api/audit-logs?limit=200");
      setRows(data);
      setLoad({ kind: "ready" });
    } catch (error) {
      setLoad({
        kind: "error",
        message:
          error instanceof OperaApiError ? error.message : "读取审计留痕失败",
      });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const ACTIONS = useMemo(
    () => Array.from(new Set(rows.map((r) => r.action))).sort(),
    [rows],
  );

  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const filtered = rows.filter(
      (r) =>
        (action === "all" || r.action === action) &&
        (kw === "" ||
          r.objectId.toLowerCase().includes(kw) ||
          r.objectType.toLowerCase().includes(kw) ||
          r.actorName.toLowerCase().includes(kw)),
    );
    return [...filtered].sort((a, b) =>
      sort.direction === "asc"
        ? a.occurredAt.localeCompare(b.occurredAt)
        : b.occurredAt.localeCompare(a.occurredAt),
    );
  }, [rows, keyword, action, sort]);

  const filtered = keyword !== "" || action !== "all";
  const pager = useListPagination(visible, 20);
  /* 选择列全站占位（owner 定）：留痕只读，列先在。 */
  const [selected, setSelected] = useState<readonly string[]>([]);

  const copyRow = async (r: AuditLogEntry) => {
    const text = [
      formatTime(r.occurredAt, locale),
      r.actorName,
      r.action,
      `${r.objectType} · ${r.objectId}`,
      r.errorCode ? `${r.outcome} · ${r.errorCode}` : r.outcome,
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

  const emptyState =
    load.kind === "loading" ? (
      <EmptyState
        title={tShared("common.loading")}
        description="正在读取审计留痕。"
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
        title={filtered ? "没有匹配的留痕" : "暂无变更留痕"}
        description={
          filtered
            ? "换个动作或关键词再看。"
            : "配置尚未发生过变更。审计只记录写操作，读操作不留痕。"
        }
      />
    );

  return (
    <div className="flex flex-col gap-md">
      <FilterBar
        view="list"
        onViewChange={() => {}}
        cardsDisabledReason={tShared("common.cardsRetired")}
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
            placeholder="搜索对象 / 操作者…"
            aria-label="搜索留痕"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              pager.resetPage();
            }}
          />
        </InputGroup>
        <NativeSelect
          wrapperClassName="w-fit"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            pager.resetPage();
          }}
          aria-label="动作筛选"
        >
          <option value="all">全部动作</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </NativeSelect>
        <Button
          variant="secondary"
          onClick={() => void reload()}
          disabled={load.kind === "loading"}
        >
          <Icon name="refresh" size="sm" aria-hidden="true" />
          {tShared("common.refresh")}
        </Button>
      </FilterBar>

      <DataTable
        columns={[
          {
            id: "occurredAt",
            header: tShared("columns.time"),
            width: "sm",
            cell: (r: AuditLogEntry) => formatTime(r.occurredAt, locale),
            sortable: true,
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
            cell: (r: AuditLogEntry) => (
              <span className="text-label-md text-foreground">
                {r.objectType} · {r.objectId}
              </span>
            ),
          },
          {
            id: "action",
            header: tShared("columns.action"),
            align: "center",
            width: "xs",
            cell: (r: AuditLogEntry) => r.action,
          },
          {
            id: "outcome",
            header: "结果",
            align: "center",
            width: "xs",
            cell: (r: AuditLogEntry) => (
              <StatusBadge tone={OUTCOME_TONE[r.outcome] ?? "neutral"} dot>
                {r.errorCode ? `${r.outcome} · ${r.errorCode}` : r.outcome}
              </StatusBadge>
            ),
          },
        ]}
        rows={pager.pageRows}
        rowKey={(r: AuditLogEntry) => r.eventId}
        selectedKeys={selected}
        onSelectionChange={setSelected}
        indexStart={pager.indexStart}
        sort={sort}
        onSortChange={setSort}
        rowActions={(r: AuditLogEntry) => (
          <ActionMenu
            label="留痕操作"
            items={[
              {
                id: "copy",
                label: tShared("common.copyRow"),
                icon: "copy",
                onSelect: () => void copyRow(r),
              },
            ]}
          />
        )}
        footer={
          <ListPagination
            className="w-full"
            currentPage={pager.page}
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
    </div>
  );
}
