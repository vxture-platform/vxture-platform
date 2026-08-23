"use client";

/* 能力面变更 — Runos 的 `mgmt_event`：谁、通过哪个控制台、改了什么。
 *
 * 这是 runos 三条审计流里**唯一的管理面流**。另外两条（`capability_call` 运行调用、
 * `task_outcome` 任务自报）是**运行事实**不是问责数据，2026-08-14 迁到「运行监控 ·
 * 调用日志」——把调用流水摆在安全审计下，是把监测信号错分成了问责证据（设计文件 §5）。
 *
 * 这条流的来历：`vxture-runos#65`。此前 runos 的功能表把 Audit 标成「已部署」，
 * 实际是「落库部署了，可读取从来没有」——它自己在 `280-management-apis.md` §5b.2
 * 里认了这个表述失当，随后补上 `GET /audit/{calls,mgmt-events,outcomes}`。
 *
 * **只读，且这不是待解除的限制**：runos 的 DB 授权只给 `runos_svc` INSERT+SELECT，
 * Prisma 侧也没有 update/delete 委托——审计的更正靠补偿事件，不靠改行。
 *
 * **游标翻页**（product_251 A-3）：keyset 游标 + 服务端 clamp 的 `limit`，逐页前进。
 * 此前这里写着「无分页」，界面上是「最近 100 / 500 / 1000 条」的档位——那不是页大小，
 * 是**能看到多远的上限**，而 runos 把 `limit` clamp 在 1000，所以第三档同时是天花板。
 * 对一条追责用的流水，够不着与没发生过在界面上长得一样，而且没有任何地方说明。
 *
 * 一次取一页仍然是对的（对 append-only 的无界流做无界查询会拖垮数据库）；错的是
 * 没把「还有更多」这个事实交给读的人。页脚现在明说到没到末尾。
 *
 * 关键词打在 `objectId` 上做**精确**过滤，不做跨字段模糊搜索：审计检索要精确，
 * 「像是这个」在合规场景里没有意义。 */

import { useCallback, useEffect, useState } from "react";
import {
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
  useToast,
} from "@vxture/design-system";
import { api, OperaApiError } from "@/lib/api";

/** 字段名跟随 runos v0.8.0（X-3 三方对齐）：`eventType` → `action`，新增 `outcome`。 */
interface MgmtEventRecord {
  eventId: string;
  action: string;
  outcome: string;
  occurredAt: string;
  actorId: string;
  actorConsole: string;
  objectType: string;
  objectId: string;
  objectVersionBefore: string | null;
  objectVersionAfter: string | null;
}

/**
 * keyset 游标分页（A-3），集合键是 `items`（A-4，两个上游同形）。
 *
 * 2026-08-24 起 `nextCursor` 真的被消费了。此前只取第一页，界面上换成「最近
 * 100 / 500 / 1000 条」的档位——**超出 1000 的变更记录够不着，而没有任何地方说明**。
 * 对一条追责用的流水来说这尤其糟：查不到与没发生过，在界面上长得一样。
 */
interface MgmtEventPage {
  items: MgmtEventRecord[];
  nextCursor: string | null;
}

/** 固定页大小。换掉的「最近 N 条」不是页大小，是能看到多远的上限——游标之后没有上限。 */
const PAGE_SIZE = 100;

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("zh-CN", { hour12: false });
}

export function RunosChangeTable() {
  const { toast } = useToast();
  const [rows, setRows] = useState<MgmtEventRecord[]>([]);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [keyword, setKeyword] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const query = useCallback(
    (nextCursor?: string) => {
      const p = new URLSearchParams({ limit: String(PAGE_SIZE) });
      const kw = keyword.trim();
      if (kw) p.set("objectId", kw);
      if (nextCursor) p.set("cursor", nextCursor);
      return `/api/runos/audit/mgmt-events?${p.toString()}`;
    },
    [keyword],
  );

  const reload = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const page = await api.get<MgmtEventPage>(query());
      setRows(page.items);
      setCursor(page.nextCursor);
      setLoad({ kind: "ready" });
    } catch (error) {
      setLoad({
        kind: "error",
        message:
          error instanceof OperaApiError ? error.message : "读取管理事件失败",
      });
    }
  }, [query]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await api.get<MgmtEventPage>(query(cursor));
      setRows((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (error) {
      /* 翻页失败不清空已读到的行：手里那几页是真实数据，丢掉它们等于用一次网络
         抖动惩罚读者。 */
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

  useEffect(() => {
    void reload();
  }, [reload]);

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
      <EmptyState title="读取中…" description="正在读取管理事件。" />
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
        title="没有匹配的事件"
        description="换个对象 ID，或这条流还没有记录。"
      />
    );

  return (
    <div className="flex flex-col gap-md">
      <Banner
        tone="warning"
        title="保留期与擦除尚未实现（runos TD-011）"
        description="这条流 append-only 且由数据库授权强制（服务角色只有 INSERT+SELECT），更正靠补偿事件、不靠改行——这是对的。但 runos 的 200-audit-schema.md §5 规定了保留期限与工作区终止时的擦除义务，目前完全没有实现，事件会无限期留存。这是已登记的合规缺口，不是本页能解决的。"
      />

      <FilterBar
        view="list"
        onViewChange={() => {}}
        cardsDisabledReason="卡片视图已下线，改用列表"
        count={rows.length}
      >
        <InputGroup className="grow basis-media-3xl max-w-panel-sm">
          <InputGroupAddon>
            <Icon name="search" size="sm" aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="按对象 ID 精确过滤…"
            aria-label="过滤管理事件"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void reload();
            }}
          />
        </InputGroup>
        <Button
          variant="secondary"
          onClick={() => void reload()}
          disabled={load.kind === "loading"}
        >
          <Icon name="refresh" size="sm" aria-hidden="true" />
          刷新
        </Button>
      </FilterBar>

      <DataTable
        columns={[
          {
            id: "time",
            header: "时间",
            width: "sm",
            cell: (r: MgmtEventRecord) => formatTime(r.occurredAt),
          },
          {
            id: "event",
            header: "事件",
            cell: (r: MgmtEventRecord) => (
              <span className="font-mono text-code-sm">{r.action}</span>
            ),
          },
          {
            id: "object",
            header: "对象",
            cell: (r: MgmtEventRecord) => (
              <span className="text-body-sm">
                {r.objectType}
                <span className="text-muted-foreground">
                  {" · "}
                  {r.objectId}
                </span>
              </span>
            ),
          },
          {
            id: "version",
            header: "版本变化",
            width: "sm",
            cell: (r: MgmtEventRecord) =>
              r.objectVersionBefore
                ? `${r.objectVersionBefore} → ${r.objectVersionAfter}`
                : r.objectVersionAfter,
          },
          {
            id: "actor",
            header: "操作者",
            width: "sm",
            cell: (r: MgmtEventRecord) => (
              <span className="text-body-sm text-muted-foreground">
                {r.actorId}
              </span>
            ),
          },
          {
            id: "console",
            header: "控制台",
            align: "center",
            width: "xs",
            cell: (r: MgmtEventRecord) => (
              <Badge variant="secondary">{r.actorConsole}</Badge>
            ),
          },
        ]}
        rows={rows}
        rowKey={(r) => r.eventId}
        indexStart={1}
        rowActions={(r: MgmtEventRecord) => (
          <Button
            variant="ghost"
            size="md"
            aria-label="复制事件 ID"
            title="复制事件 ID"
            onClick={() => void copyRow(r.eventId)}
          >
            <Icon name="copy" size="sm" aria-hidden="true" />
          </Button>
        )}
        empty={emptyState}
        footer={
          /* 显式说到没到末尾：「加载完了」与「加载不动了」在界面上长得一样，
             而前者是答案、后者是故障。 */
          <div className="flex w-full items-center justify-between gap-sm">
            <span className="text-body-sm text-muted-foreground">
              已加载 {rows.length} 条{cursor ? "，还有更多" : "（已到末尾）"}
            </span>
            {cursor ? (
              <Button
                variant="outline"
                size="sm"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? "加载中…" : "加载更多"}
              </Button>
            ) : null}
          </div>
        }
      />
    </div>
  );
}
