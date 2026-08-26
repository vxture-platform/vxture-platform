"use client";

/* 模型面变更 — Atlas 自己那份 append-only 的 `audit.change_records`。
 *
 * 与「平台留痕」tab **不重复，且不能互相替代**：
 *
 *   平台留痕   opera-bff 的 `support.audit_logs`，只记**经过 opera 的写**
 *   本 tab     Atlas 收到的**每一次** `/capability/*` 写
 *
 * 差在两处，而这两处正是审计要抓的：直接打 Atlas 管理面（不经过本门户）的写，
 * 以及**被守卫在任何 handler 跑之前就挡掉的失败尝试**（那种记 `operatorSub:
 * "unknown"`——一次没有可归属操作者的写尝试，恰恰是审计员要找的东西）。只看
 * opera 那份，等于只审计自己。
 *
 * ── 这份流水的三条性质，都影响该怎么读它 ─────────────────────────────────────
 *
 * 1. **数据库层面 append-only**，不是靠约定：`atlas_svc` 在这张表上只有 INSERT 和
 *    SELECT，没有 UPDATE，而且与其它 append-only 表不同，连 DELETE 都没有（reqlog
 *    保留 DELETE 是因为它靠 DROP PARTITION 清理，这张表根本不清理）。所以这里没有
 *    任何写入口，也不可能有。
 *
 * 2. **从路由推导，不是每个 handler 各自调一次**。中间件把
 *    `POST /capability/providers/:id/deactivate` 读成资源、id 与动作。逐 handler
 *    显式埋点只会审计到"有人记得标注"的那些路由，漏一条是静默失败；按路由推导的
 *    话，新的写路由从存在的那一刻起就被审计到。
 *
 * 3. **只记字段名，不记值**。这个面的请求体里带 provider 密钥和网关密钥明文，一张
 *    变成密钥库第二份未加密副本的审计表，比它要堵的缺口更糟。所以「改了哪些字段」
 *    能回答，「改成了什么」不能——那是价格规则与策略的追加式版本化负责的事。
 *
 * 读操作从不记录：把 GET 也记下来，会让真正要看的写操作淹没在每次刷新产生的列表
 * 调用里。
 *
 * 分页是不透明游标、只能顺序前进，所以做成「加载更多」而不是页码。筛选条件变化会
 * 重新从头取——游标是跟着一组筛选条件走的，不能跨条件复用。
 *
 * 2026-08-14 由独立页 `/audit/atlas` 并入变更审计的来源 tab（设计文件 §5）。表结构
 * 与另外两个来源**刻意不做字段合并**：三张表形状不同，合并需要映射层，而映射层会
 * 悄悄决定"哪些字段不重要"。 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
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
  StatusBadge,
  useToast,
  type StatusBadgeTone,
} from "@vxture/design-system";
import { useOperatorSession } from "@/features/session/SessionProvider";
import { api, OperaApiError } from "@/lib/api";

/** 与 opera-bff atlas.router.ts 同名能力码。**已知缺口**：提交给平台能力码词表的
 * 那套只覆盖配置类写操作，所以「可以读变更流水」目前没法与「可以轮换密钥」分开
 * 授予。不在门户侧自造一个平台不认的码来假装分开了。 */
const MANAGE = "model:model.manage";

/**
 * 字段名对齐 product_251 X-3（atlas#204 已合并 #215）。
 *
 * **上游两代都保证有这些名字**：新 atlas 直接返回，旧 atlas 由 opera-bff 的
 * `atlas-compat.ts` 从 `id`/`operatorSub`/`actorClientId`/`objectType`/`resourceId`
 * 补出来——所以这里只读新名，不写 `??` 兜底。
 */
interface AtlasChangeRecord {
  eventId: string;
  objectType: string;
  objectId: string | null;
  action: string;
  /** 守卫先挡掉的尝试记为 "unknown"。 */
  actorId: string;
  /** 从哪个管理面发起（`act.sub`，即铸票的 workforce RP）。 */
  actorConsole: string | null;
  /** 一次写碰过哪些字段的**名字**——不带值。 */
  changedFields: string[];
  requestId: string | null;
  outcome: string;
  occurredAt: string;
}

interface AtlasChangeRecordPage {
  items: AtlasChangeRecord[];
  nextCursor: string | null;
}

const OUTCOME_TONE: Record<string, StatusBadgeTone> = {
  success: "success",
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

type LoadState =
  | { kind: "loading" }
  /**
   * 这个 Atlas 部署还没有这条路由。
   *
   * platform#257 交付说明里要求「`v0.4.0` 部署前不要开放入口」。这里的做法不是把
   * tab 藏起来——藏起来意味着门户要自己维护一份"上游部署到哪一版"的判断，而那份
   * 判断只会漂移，且没有任何东西会提醒它漂了。改成**入口照常在、进来如实说明**：
   * 部署上去的那一刻自动恢复，不需要谁记得回来改门户。
   */
  | { kind: "unavailable" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

/** Atlas 没有这条路由时是 Express 的默认 404（不带 Atlas 自己的结构化 `code`）。 */
function isRouteMissing(error: unknown): boolean {
  return (
    error instanceof OperaApiError &&
    error.status === 404 &&
    error.code === undefined
  );
}

export function AtlasChangeTable() {
  const locale = useLocale();
  const tShared = useTranslations();
  const { toast } = useToast();
  const { can } = useOperatorSession();
  const canRead = can(MANAGE);

  const [rows, setRows] = useState<AtlasChangeRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [outcome, setOutcome] = useState("all");
  const [objectType, setObjectType] = useState("all");
  const [selected, setSelected] = useState<readonly string[]>([]);

  /* 结果与资源类型下推给上游，关键词在本地筛：上游没有全文检索入参，把关键词
     伪装成一个服务端过滤，会得到一个"筛完是空的、但其实只是没翻到那一页"的结果。 */
  const query = useCallback(
    (next?: string) => {
      const p = new URLSearchParams({ limit: "100" });
      if (outcome !== "all") p.set("outcome", outcome);
      if (objectType !== "all") p.set("objectType", objectType);
      if (next) p.set("cursor", next);
      return `/api/atlas/audit-logs?${p.toString()}`;
    },
    [outcome, objectType],
  );

  const reload = useCallback(async () => {
    if (!canRead) return;
    setLoad({ kind: "loading" });
    try {
      const data = await api.get<AtlasChangeRecordPage>(query());
      setRows(data.items);
      setCursor(data.nextCursor);
      setLoad({ kind: "ready" });
    } catch (error) {
      setLoad(
        isRouteMissing(error)
          ? { kind: "unavailable" }
          : {
              kind: "error",
              message:
                error instanceof OperaApiError
                  ? error.message
                  : "读取 Atlas 变更流水失败",
            },
      );
    }
  }, [query, canRead]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const data = await api.get<AtlasChangeRecordPage>(query(cursor));
      setRows((prev) => [...prev, ...data.items]);
      setCursor(data.nextCursor);
    } catch (error) {
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

  const objectTypes = useMemo(
    () => Array.from(new Set(rows.map((r) => r.objectType))).sort(),
    [rows],
  );

  /** 没有可归属操作者的写尝试——审计员第一个要找的就是这些。 */
  const unattributed = useMemo(
    () => rows.filter((r) => r.actorId === "unknown"),
    [rows],
  );

  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return kw === ""
      ? rows
      : rows.filter(
          (r) =>
            (r.objectId ?? "").toLowerCase().includes(kw) ||
            r.objectType.toLowerCase().includes(kw) ||
            r.action.toLowerCase().includes(kw) ||
            r.actorId.toLowerCase().includes(kw),
        );
  }, [rows, keyword]);

  const copyRow = async (r: AtlasChangeRecord) => {
    const text = [
      formatTime(r.occurredAt, locale),
      r.actorId,
      `${r.objectType} · ${r.objectId ?? "—"}`,
      r.action,
      r.outcome,
      r.changedFields.join(",") || "—",
      r.requestId ?? "—",
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

  if (!canRead) {
    return (
      <EmptyState title="没有权限" description={`需要 ${MANAGE} 能力码。`} />
    );
  }

  const emptyState =
    load.kind === "loading" ? (
      <EmptyState
        title={tShared("common.loading")}
        description="正在读取 Atlas 变更流水。"
      />
    ) : load.kind === "unavailable" ? (
      <EmptyState
        title="当前 Atlas 部署还没有变更流水接口"
        description="这个读端点由 vxture-atlas#159 §6 交付（应用镜像 v0.4.0）。数据库侧的 audit schema 可能已经建好，但只有部署了带这条路由的镜像，这里才读得到——写入本身不受影响：变更一直在记，只是还取不出来。"
        action={
          <Button variant="secondary" onClick={() => void reload()}>
            {tShared("common.retry")}
          </Button>
        }
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
    ) : visible.length !== rows.length ? (
      <EmptyState
        title={tShared("common.noMatchingRecords")}
        description="关键词只在已经取回的这几页里筛——再「加载更多」几页可能会有。"
      />
    ) : (
      <EmptyState
        title="暂无变更记录"
        description="Atlas 管理面尚未发生过写操作。读操作从不记录。"
      />
    );

  return (
    <div className="flex flex-col gap-md">
      {unattributed.length > 0 ? (
        <Banner
          tone="warning"
          title={`${unattributed.length} 次写尝试没有可归属的操作者`}
          description="operatorSub 记为 unknown，表示守卫在任何 handler 跑之前就把它挡回去了——令牌没过校验，所以没有身份可记。零星几次通常是配错了的调用方在重试；持续出现值得查是谁在打这个面。"
        />
      ) : null}

      <FilterBar
        view="list"
        onViewChange={() => {}}
        cardsDisabledReason={tShared("common.cardsRetired")}
        count={
          visible.length === rows.length
            ? `${rows.length}${cursor ? "+" : ""}`
            : `${visible.length} / ${rows.length}`
        }
      >
        <InputGroup className="grow basis-media-3xl max-w-panel-sm">
          <InputGroupAddon>
            <Icon name="search" size="sm" aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="搜索对象 / 动作 / 操作者…"
            aria-label="搜索变更记录"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </InputGroup>
        <NativeSelect
          wrapperClassName="w-fit"
          value={objectType}
          onChange={(e) => setObjectType(e.target.value)}
          aria-label="资源类型筛选"
        >
          <option value="all">全部资源</option>
          {objectTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          wrapperClassName="w-fit"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          aria-label="结果筛选"
        >
          <option value="all">全部结果</option>
          <option value="success">成功</option>
          <option value="failure">失败</option>
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
            id: "time",
            header: tShared("columns.time"),
            width: "sm",
            cell: (r: AtlasChangeRecord) => formatTime(r.occurredAt, locale),
          },
          {
            id: "operator",
            header: tShared("columns.actor"),
            width: "sm",
            cell: (r: AtlasChangeRecord) => (
              <span className="flex flex-col gap-2xs">
                {r.actorId === "unknown" ? (
                  <Badge variant="outline" className="w-fit">
                    未归属
                  </Badge>
                ) : (
                  <span className="text-code-sm">{r.actorId}</span>
                )}
                {r.actorConsole ? (
                  <span className="text-body-sm text-muted-foreground">
                    来自 {r.actorConsole}
                  </span>
                ) : null}
              </span>
            ),
          },
          {
            id: "target",
            header: tShared("columns.target"),
            cell: (r: AtlasChangeRecord) => (
              <span className="flex flex-col gap-2xs">
                <span className="text-label-md text-foreground">
                  {r.objectType}
                </span>
                <span className="text-code-sm text-muted-foreground">
                  {r.objectId ?? "—"}
                </span>
              </span>
            ),
          },
          {
            id: "action",
            header: tShared("columns.action"),
            align: "center",
            width: "xs",
            cell: (r: AtlasChangeRecord) => r.action,
          },
          {
            /* 只有字段名。想知道改成了什么，那不是这张表能回答的——它故意不存值。 */
            id: "fields",
            header: "改动字段",
            width: "sm",
            cell: (r: AtlasChangeRecord) =>
              r.changedFields.length === 0 ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <span className="flex flex-wrap gap-2xs">
                  {r.changedFields.slice(0, 4).map((f) => (
                    <Badge key={f} variant="secondary">
                      {f}
                    </Badge>
                  ))}
                  {r.changedFields.length > 4 ? (
                    <Badge variant="secondary">
                      +{r.changedFields.length - 4}
                    </Badge>
                  ) : null}
                </span>
              ),
          },
          {
            id: "outcome",
            header: "结果",
            align: "center",
            width: "xs",
            cell: (r: AtlasChangeRecord) => (
              <StatusBadge tone={OUTCOME_TONE[r.outcome] ?? "neutral"} dot>
                {r.outcome === "success" ? "成功" : r.outcome}
              </StatusBadge>
            ),
          },
        ]}
        rows={visible}
        rowKey={(r: AtlasChangeRecord) => r.eventId}
        selectedKeys={selected}
        onSelectionChange={setSelected}
        rowActions={(r: AtlasChangeRecord) => (
          <ActionMenu
            label="变更记录操作"
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
        empty={emptyState}
        footer={
          /* 游标不透明、只能顺序前进，所以没有页码也没有总数——"共 N 条"这个数
             上游根本没给，编一个出来就是编。 */
          cursor ? (
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore
                ? tShared("common.loading")
                : tShared("common.loadMore")}
            </Button>
          ) : rows.length > 0 ? (
            <p className="text-body-sm text-muted-foreground">已经到底了。</p>
          ) : null
        }
      />
    </div>
  );
}
