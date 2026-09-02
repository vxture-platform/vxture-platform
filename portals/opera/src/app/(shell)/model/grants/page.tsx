"use client";

/* Product Grant — 产品维授权：一个产品持有哪些**能力入口**。
 *
 * 2026-08-13 新建。此前 opera 完全没有这个面，而它是 Atlas 授权模型的当前主轴
 * （vxture-atlas `docs/30-design/110-management-plane.md`「授权在移向
 * (product, endpoint)」）。
 *
 * ── 为什么归 opera、以及它和 admin 那个 grant 不是一回事 ──────────────────────
 *
 * 卖出去的是**产品服务**，不是模型服务：客户买 karda，而 karda 需要哪些能力是产品
 * 工程问题，不是逐客户的商业问题。三行关系表：
 *
 *   tenant ↔ product    商业关系   平台（C2 权益）
 *   product ↔ endpoint  工程关系   **Atlas —— 就是这一页**
 *   tenant ↔ model      不应存在   —
 *
 * 最后一行正是旧的 `model_grants`：一张运营逐租户逐模型维护的表，把商业决定编码进
 * 了技术注册表。它还活着（两根轴同时生效，先前能用的不会突然不能用），管理面留在
 * admin——**两个都叫 grant，不是同一个东西，不要合并成一页**。
 *
 * ── 为什么授权命名的是入口而不是模型 ─────────────────────────────────────────
 *
 * 改 endpoint 的指向对调用方应当是无感的——这正是 endpoint 存在的意义。模型维授权
 * 会恰好在最不能破的那一层破坏这个抽象，还会让一个入口的 fallback 需要自己再拿一次
 * 授权才能顶上。入口也是**策展过的**命名空间（三十来个），模型不是（一百三十多个
 * 且还在长）。
 *
 * 直接点名 modelCode 的调用按**推导集合**鉴权：该产品持有的入口能触达的模型
 * （primary 与 fallback）。所以这一页没有、也不该有任何按模型发放的东西。
 *
 * ── 唯一性就是「撤销要真的是撤销」 ───────────────────────────────────────────
 *
 * 一条授权在 (product, endpoint, 应用范围) 上唯一，由 Atlas 侧唯一索引保证。运行时
 * 按**任意一条**命中的有效授权放行，所以少了这个约束，运营停用了眼前这一条之后
 * 另一条还在继续放行——一个看起来生效了、实际没有的操作。
 *
 * `productCode`/`endpointCode` 创建后不可变：改指向 = 一次撤销加一次新建，两个决定
 * 都留在变更流水里；原地改只会留下终点、丢掉起点。 */

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import {
  ActionMenu,
  Badge,
  Banner,
  Button,
  Combobox,
  DataTable,
  DialogForm,
  EmptyState,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FilterBar,
  Icon,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  ListPageTemplate,
  NativeSelect,
  StatusBadge,
  TableTitleCell,
  ViewHeader,
  useListPagination,
  useToast,
} from "@vxture/design-system";
import { ListPagination } from "@/modules/shared/ListPagination";
import { useOperatorSession } from "@/features/session/SessionProvider";
import {
  STALE_ATLAS_HINT,
  deleteFailureToast,
} from "@/features/atlas/lifecycle";
import { isEnabled, type ObjectState } from "@/features/atlas/state";
import { useConfirmLabels } from "@/lib/destructive";
import { api, OperaApiError } from "@/lib/api";

/** 与 opera-bff atlas.router.ts 同名能力码——与 endpoints 同一批人管（授权的是
 * 入口），活库 admin.operator_permission 里也没有更细的码。 */
const MANAGE = "model:model.manage";

interface ProductGrantRecord {
  id: string;
  productCode: string;
  endpointCode: string;
  applicationId: string | null;
  applicationType: string | null;
  state: ObjectState;
  reason: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProductSummary {
  productCode: string;
  productName: string;
}

interface EndpointSummary {
  code: string;
  category: string;
  state: ObjectState;
}

/* 没有 `delete` 档：删除的确认由 DS 的 `ConfirmDestructive` 接管（菜单项的
   `confirm`）。留一个只为开确认框而存在的 dialog 档，是把同一件事记两遍。 */
type DialogState = { kind: "edit"; row: ProductGrantRecord } | null;

interface GrantDraft {
  productCode: string;
  endpointCode: string;
  applicationId: string;
  applicationType: string;
  reason: string;
  expiresAt: string;
}

const EMPTY_DRAFT: GrantDraft = {
  productCode: "",
  endpointCode: "",
  applicationId: "",
  applicationType: "",
  reason: "",
  expiresAt: "",
};

function draftFromRecord(row: ProductGrantRecord): GrantDraft {
  return {
    productCode: row.productCode,
    endpointCode: row.endpointCode,
    applicationId: row.applicationId ?? "",
    applicationType: row.applicationType ?? "",
    reason: row.reason ?? "",
    expiresAt: row.expiresAt ? row.expiresAt.slice(0, 10) : "",
  };
}

function describeError(error: unknown): { description?: string } {
  return error instanceof OperaApiError && error.message
    ? { description: error.message }
    : {};
}

/** 到期是读时判定的事实，不是一个会被谁翻转的开关：没有到期清扫任务。一条
 *  `state: "active"` 但已过期的授权不再放行，页面要把这件事说出来。 */
function isExpired(row: ProductGrantRecord): boolean {
  return (
    row.expiresAt !== null && new Date(row.expiresAt).getTime() <= Date.now()
  );
}

type LoadState =
  | { kind: "loading" }
  /** 上游根本没有这条路由——与"读取失败"分开：一个是 Atlas 版本还没到，一个是
   *  真出错了，混成一句红色的「读取失败」会让人去查网络、查权限、查会话。 */
  | { kind: "unavailable" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

/** Atlas 没有这条路由时，Express 的默认 404 体（不是 Atlas 自己的结构化错误）。
 *  所以判据是「404 且不带 Atlas 的 code」——Atlas 自己的 404 一定带 code。 */
function isRouteMissing(error: unknown): boolean {
  return (
    error instanceof OperaApiError &&
    error.status === 404 &&
    error.code === undefined
  );
}

/** `useSearchParams` 需要 Suspense 边界。 */
export default function ProductGrantsPage() {
  return (
    <Suspense fallback={null}>
      <ProductGrantsPageContent />
    </Suspense>
  );
}

function ProductGrantsPageContent() {
  const tShared = useTranslations();
  const withLabels = useConfirmLabels();
  const { toast } = useToast();
  const { can } = useOperatorSession();
  const canManage = can(MANAGE);
  /* 两条入口深链，都下推给上游（`/capability/product-grants` 两个参数都收）：
     - `?endpointCode=` 模型路由页带着入口码进来看「谁在持有这个入口」
     - `?productCode=` 权益配置页带着产品码进来看「这个产品有哪些路由」
     下推而不是本地过滤，是因为本地过滤会在"取回的这一页里没有"时显示成"没有"。 */
  const search = useSearchParams();
  const endpointCodeFilter = search.get("endpointCode") ?? "";
  const productCodeFilter = search.get("productCode") ?? "";

  const [rows, setRows] = useState<ProductGrantRecord[]>([]);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [endpoints, setEndpoints] = useState<EndpointSummary[]>([]);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "inactive"
  >("all");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [draft, setDraft] = useState<GrantDraft>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const grants = await api.get<ProductGrantRecord[]>(
        `/api/atlas/product-grants?includeInactive=true${
          endpointCodeFilter
            ? `&endpointCode=${encodeURIComponent(endpointCodeFilter)}`
            : ""
        }${
          productCodeFilter
            ? `&productCode=${encodeURIComponent(productCodeFilter)}`
            : ""
        }`,
      );
      setRows(grants);
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
                  : "读取产品授权失败",
            },
      );
    }
  }, [endpointCodeFilter, productCodeFilter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /* 两个下拉的数据源单独取、失败不挡页面：读不到时退化成手填，总比整页打不开好。 */
  useEffect(() => {
    void api
      .get<ProductSummary[]>("/api/products")
      .then(setProducts)
      .catch(() => setProducts([]));
    void api
      .get<EndpointSummary[]>("/api/atlas/endpoints?includeInactive=true")
      .then(setEndpoints)
      .catch(() => setEndpoints([]));
  }, []);

  const productName = useMemo(
    () => new Map(products.map((p) => [p.productCode, p.productName])),
    [products],
  );

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (statusFilter === "all" ||
          (statusFilter === "active"
            ? isEnabled(r.state)
            : !isEnabled(r.state))) &&
        (kw === "" ||
          r.productCode.toLowerCase().includes(kw) ||
          r.endpointCode.toLowerCase().includes(kw)),
    );
  }, [rows, keyword, statusFilter]);

  const pager = useListPagination(filtered, 20);

  /** 启用中却已过期的：`state` 说它有效，读时判定说它没有。 */
  const expiredButActive = useMemo(
    () => rows.filter((r) => isEnabled(r.state) && isExpired(r)),
    [rows],
  );

  const productItems = useMemo(
    () =>
      products.map((p) => ({
        value: p.productCode,
        label: `${p.productName}（${p.productCode}）`,
      })),
    [products],
  );

  /** 已停用的入口也列出来但标注：授权一个停用入口不是错误（入口可能稍后再开），
   *  但要让人知道这条授权现在放行不了任何东西。 */
  const endpointItems = useMemo(
    () =>
      endpoints.map((e) => ({
        value: e.code,
        label: isEnabled(e.state) ? e.code : `${e.code}（入口已停用）`,
      })),
    [endpoints],
  );

  function openEdit(row: ProductGrantRecord) {
    setDraft(draftFromRecord(row));
    setDialog({ kind: "edit", row });
  }

  async function runAction(label: string, action: () => Promise<unknown>) {
    setSubmitting(true);
    try {
      await action();
      toast({ tone: "success", title: label });
      await reload();
    } catch (error) {
      toast({ tone: "danger", title: `${label}失败`, ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * 删除一条产品授权。落锤，由菜单项的 `confirm.onConfirm` 调用。
   *
   * **失败重新抛出**：DS 的确认件按 Promise 是否 rejected 决定关不关框——吞掉异常
   * 等于让一次失败的删除看起来成功了。Toast 仍在这里出。
   */
  async function removeGrant(row: ProductGrantRecord) {
    try {
      await api.delete(`/api/atlas/product-grants/${row.id}`);
      toast({
        tone: "success",
        title: `${row.productCode} → ${row.endpointCode} 已删除`,
      });
      await reload();
    } catch (error) {
      toast({ tone: "danger", ...deleteFailureToast(error, "删除失败") });
      throw error;
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;

    /* 应用范围为空 = 产品级授权（applicationId 存 NULL）。空串和 NULL 在唯一索引
       下不是一回事，所以这里必须显式送 null，不能送 ""。 */
    const scope = {
      applicationId: draft.applicationId.trim() || null,
      applicationType: draft.applicationType.trim() || null,
      reason: draft.reason.trim() || null,
      expiresAt: draft.expiresAt ? `${draft.expiresAt}T00:00:00.000Z` : null,
    };

    setSubmitting(true);
    try {
      /* productCode / endpointCode 不进 body：它们不可变，送过去也只会被忽略。 */
      await api.patch(`/api/atlas/product-grants/${dialog.row.id}`, scope);
      toast({ tone: "success", title: "授权已保存" });
      setDialog(null);
      await reload();
    } catch (error) {
      /* 唯一索引撞车（同一 product × endpoint × 应用范围已经有一条）在这里是
         409——如实透传，别把它变成一条"保存失败"让人反复重试。 */
      toast({ tone: "danger", title: "保存失败", ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  const editing = dialog?.kind === "edit";
  const draftValid =
    draft.productCode.trim() !== "" && draft.endpointCode.trim() !== "";

  const pagination = (
    <ListPagination
      className="w-full"
      currentPage={pager.page}
      pageCount={pager.pageCount}
      total={rows.length}
      filteredTotal={filtered.length}
      pageSize={pager.pageSize}
      onPageSizeChange={pager.onPageSizeChange}
      onPageChange={pager.onPageChange}
    />
  );

  const emptyState =
    load.kind === "loading" ? (
      <EmptyState
        title={tShared("common.loading")}
        description="正在读取产品授权。"
      />
    ) : load.kind === "unavailable" ? (
      /* 不画成红色的失败：没出错，是这台 Atlas 还没交付这条路由。写清楚要哪个提交
         才有，比让人去翻网络面板强。 */
      <EmptyState
        title="当前 Atlas 部署还没有产品授权接口"
        description={`${STALE_ATLAS_HINT} 这个面由 vxture-atlas#175（product grant management API）交付；在此之前授权只有旧的租户 × 模型轴，管理面在 admin。`}
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
    ) : filtered.length !== rows.length ? (
      <EmptyState
        title="没有匹配的授权"
        description={tShared("common.noMatchHint")}
      />
    ) : (
      <EmptyState
        title="暂无产品授权"
        description="点击「授予入口」把一个能力入口发给某个产品。"
      />
    );

  return (
    <>
      <ListPageTemplate
        header={
          <ViewHeader
            icon="list-checks"
            title="路由授权"
            description="产品持有哪些能力入口。授权命名的是入口而不是模型——改入口指向对调用方无感，正是入口存在的意义；产品能选的模型由它持有的入口推导出来，不在这里逐个发放。"
            action={
              /* **写入已移到「产品管理 · 权益配置」**（2026-08-16，E1）。授权主体是
                 产品（ADR-010），以入口为中心发授权等于从客体去挂主体；而且产品能不能
                 跑取决于模型路由与能力授权的**合集**，两者必须在同一处配。
                 本页保留的是**反向视图**——「这条入口被哪些产品持有」，那是下线一条
                 路由前必须看的方向，与发授权是两个不同的问题。 */
              <Button variant="secondary" asChild>
                <Link
                  href={`/product/entitlements${productCodeFilter ? `?productCode=${encodeURIComponent(productCodeFilter)}` : ""}`}
                >
                  <Icon name="arrow-right" size="sm" aria-hidden="true" />
                  去权益配置发授权
                </Link>
              </Button>
            }
          />
        }
        summary={
          <div className="flex flex-col gap-sm">
            {endpointCodeFilter ? (
              <Banner
                tone="info"
                title={`只显示持有 ${endpointCodeFilter} 的产品`}
                action={
                  <Button asChild variant="secondary" size="sm">
                    <Link href="/model/grants">
                      {tShared("common.showAll")}
                    </Link>
                  </Button>
                }
              />
            ) : null}
            {productCodeFilter ? (
              /* 深链进来的过滤必须说出来。否则看到的是一张短列表，而"短"与"这个
                 产品只有这么几条"在界面上长得一模一样。 */
              <Banner
                tone="info"
                title={`只显示 ${productCodeFilter} 的路由授权`}
                action={
                  <Button asChild variant="secondary" size="sm">
                    <Link href="/model/grants">
                      {tShared("common.showAll")}
                    </Link>
                  </Button>
                }
              />
            ) : null}
            {expiredButActive.length > 0 ? (
              /* 没有到期清扫任务，这是有意的：定时改写历史的作业会改掉它本该保全的
                 东西。到期在**读时**判定，所以「启用中但已过期」是一个真实存在、
                 且只有在这里说出来才看得见的状态。 */
              <Banner
                tone="warning"
                title={`${expiredButActive.length} 条授权仍标着启用，但已经过期`}
                description={`过期后不再放行，而 state 不会有人去翻——没有到期清扫任务（定时改写会改掉它本该保全的记录）。要么续期，要么停用：${expiredButActive
                  .map((r) => `${r.productCode} → ${r.endpointCode}`)
                  .join("、")}`}
              />
            ) : null}
          </div>
        }
        filters={
          <FilterBar
            view="list"
            onViewChange={() => {}}
            cardsDisabledReason={tShared("common.cardsRetired")}
            count={
              filtered.length === rows.length
                ? rows.length
                : `${filtered.length} / ${rows.length}`
            }
          >
            <InputGroup className="grow basis-media-3xl max-w-panel-sm">
              <InputGroupAddon>
                <Icon name="search" size="sm" aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="搜索产品码或入口码…"
                aria-label="搜索产品授权"
                value={keyword}
                onChange={(e) => {
                  setKeyword(e.target.value);
                  pager.resetPage();
                }}
              />
            </InputGroup>
            <NativeSelect
              wrapperClassName="w-fit"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as typeof statusFilter);
                pager.resetPage();
              }}
              aria-label={tShared("filters.stateLabel")}
            >
              <option value="all">{tShared("filters.allStates")}</option>
              <option value="active">{tShared("actions.enable")}</option>
              <option value="inactive">{tShared("actions.disable")}</option>
            </NativeSelect>
          </FilterBar>
        }
        table={
          <DataTable
            columns={[
              {
                id: "product",
                header: tShared("columns.product"),
                cell: (r: ProductGrantRecord) => (
                  <TableTitleCell
                    icon="package"
                    title={productName.get(r.productCode) ?? r.productCode}
                    description={r.productCode}
                    {...(canManage ? { onTitleClick: () => openEdit(r) } : {})}
                  />
                ),
              },
              {
                id: "endpoint",
                header: "能力入口",
                width: "sm",
                /* 不做成链接：Endpoint 页目前没有按入口码过滤的入参，配一个跳过去
                   也筛不动的链接，比不配更糟。 */
                cell: (r: ProductGrantRecord) => (
                  <span className="text-code-sm">{r.endpointCode}</span>
                ),
              },
              {
                /* 产品级 vs 应用级：`applicationId` 为空是**产品级**授权，不是
                   "没填"。唯一索引用 NULLS NOT DISTINCT，所以这两者在约束下是
                   不同的东西，显示上也不能混。 */
                id: "scope",
                header: "范围",
                width: "sm",
                cell: (r: ProductGrantRecord) =>
                  r.applicationId ? (
                    <span className="flex flex-col gap-2xs">
                      <span className="text-code-sm">{r.applicationId}</span>
                      {r.applicationType ? (
                        <span className="text-body-sm text-muted-foreground">
                          {r.applicationType}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <Badge variant="secondary">产品级</Badge>
                  ),
              },
              {
                id: "expires",
                header: "到期",
                align: "center",
                width: "xs",
                cell: (r: ProductGrantRecord) =>
                  r.expiresAt ? (
                    <span
                      className={
                        isExpired(r)
                          ? "text-warning-foreground"
                          : "text-body-sm"
                      }
                    >
                      {r.expiresAt.slice(0, 10)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">不限</span>
                  ),
              },
              {
                id: "status",
                header: tShared("columns.state"),
                align: "center",
                width: "xs",
                cell: (r: ProductGrantRecord) =>
                  isEnabled(r.state) && isExpired(r) ? (
                    <StatusBadge tone="warning" dot>
                      已过期
                    </StatusBadge>
                  ) : (
                    <StatusBadge
                      tone={isEnabled(r.state) ? "success" : "neutral"}
                      dot
                    >
                      {isEnabled(r.state)
                        ? "生效中"
                        : tShared("status.generic.disabled")}
                    </StatusBadge>
                  ),
              },
            ]}
            rows={pager.pageRows}
            rowKey={(r: ProductGrantRecord) => r.id}
            indexStart={pager.indexStart}
            {...(canManage
              ? {
                  rowActions: (r: ProductGrantRecord) => (
                    <ActionMenu
                      label={`${r.productCode} → ${r.endpointCode} 操作`}
                      disabled={submitting}
                      items={[
                        {
                          id: "edit",
                          label: tShared("common.edit"),
                          icon: "edit",
                          onSelect: () => openEdit(r),
                        },
                        isEnabled(r.state)
                          ? {
                              id: "revoke",
                              label: "撤销（停用）",
                              icon: "prohibit" as const,
                              separatorBefore: true,
                              onSelect: () =>
                                void runAction(
                                  `${r.productCode} → ${r.endpointCode} 已撤销`,
                                  () =>
                                    api.post(
                                      `/api/atlas/product-grants/${r.id}/deactivate`,
                                    ),
                                ),
                            }
                          : {
                              id: "grant",
                              label: "重新授予",
                              icon: "play" as const,
                              separatorBefore: true,
                              onSelect: () =>
                                void runAction(
                                  `${r.productCode} → ${r.endpointCode} 已重新授予`,
                                  () =>
                                    api.post(
                                      `/api/atlas/product-grants/${r.id}/activate`,
                                    ),
                                ),
                            },
                        {
                          id: "delete",
                          label: tShared("actions.delete"),
                          icon: "trash",
                          danger: true,
                          separatorBefore: true,
                          confirm: withLabels({
                            verb: tShared("actions.delete"),
                            target: `${r.productCode} → ${r.endpointCode} 的授权`,
                            consequence:
                              "删除只是把已经停用的记录清掉，不可恢复。日常收回权限用「撤销」就够了，那一步留在变更流水里。",
                            /* 「要先撤销才能删」此前只写在对话框描述里——那是描述，
                               不是门闩。接成 `met` 之后，一条还在放行的授权连确认钮
                               都按不下去。 */
                            preconditions: [
                              {
                                label: "这条授权已撤销（停用）",
                                met: !isEnabled(r.state),
                              },
                            ],
                            onConfirm: () => removeGrant(r),
                          }),
                        },
                      ]}
                    />
                  ),
                }
              : {})}
            footer={pagination}
            empty={emptyState}
          />
        }
      />

      {/* **只剩逐条精调**：新建移到「产品管理 · 权益配置」（E1）。这里能改的是应用
          范围、到期、原因这类细项——批量入口给的是「这个产品能走这些路由」的最常见
          形状，两处都能新建会立刻产生「以哪边为准」。 */}
      <DialogForm
        open={editing}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title="编辑产品授权"
        description="一个产品对一个入口、在一个应用范围上只能有一条授权。运行时按任意一条命中的有效授权放行，所以重复的那条会在你停用眼前这条之后继续放行——唯一索引堵的就是这个。"
        submitLabel={tShared("common.save")}
        submitting={submitting}
        submitDisabled={!draftValid}
        onSubmit={submit}
      >
        <FieldGroup>
          <Field>
            <FieldLabel>{tShared("columns.product")}</FieldLabel>
            <Combobox
              items={productItems}
              value={draft.productCode}
              onValueChange={(v) => setDraft({ ...draft, productCode: v })}
              placeholder="选择产品"
              searchPlaceholder="搜索产品码…"
              disabled={editing}
            />
            <FieldDescription>
              {editing
                ? "创建后不可变——改指向 = 一次撤销加一次新建，两个决定都要留在变更流水里。"
                : "产品码就是 S2S 令牌上的 act.sub，调用方伪造不了。"}
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel>能力入口</FieldLabel>
            <Combobox
              items={endpointItems}
              value={draft.endpointCode}
              onValueChange={(v) => setDraft({ ...draft, endpointCode: v })}
              placeholder="选择入口"
              searchPlaceholder="搜索入口码…"
              disabled={editing}
            />
            <FieldDescription>
              {editing
                ? "同上，不可变。"
                : "产品能调的模型由这个入口能触达的 primary / fallback 推导出来，不需要再逐个发放模型。"}
            </FieldDescription>
          </Field>

          <div className="grid grid-cols-2 gap-md">
            <Field>
              <FieldLabel htmlFor="grant-app-id">应用 ID（可选）</FieldLabel>
              <Input
                id="grant-app-id"
                value={draft.applicationId}
                onChange={(e) =>
                  setDraft({ ...draft, applicationId: e.target.value })
                }
                placeholder="留空 = 产品级"
                className="font-mono"
              />
              <FieldDescription>
                留空是**产品级授权**，不是「没填」——这两者在唯一索引下是不同的东西。
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="grant-app-type">应用类型（可选）</FieldLabel>
              <Input
                id="grant-app-type"
                value={draft.applicationType}
                onChange={(e) =>
                  setDraft({ ...draft, applicationType: e.target.value })
                }
                className="font-mono"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-md">
            <Field>
              <FieldLabel htmlFor="grant-expires">到期（可选）</FieldLabel>
              <Input
                id="grant-expires"
                type="date"
                value={draft.expiresAt}
                onChange={(e) =>
                  setDraft({ ...draft, expiresAt: e.target.value })
                }
              />
              <FieldDescription>
                到期在读时判定，没有清扫任务去翻 state——过期后不再放行，但这一行
                仍会显示成启用，页面会另外提示。
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="grant-reason">理由（可选）</FieldLabel>
              <Input
                id="grant-reason"
                value={draft.reason}
                onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                placeholder="为什么这个产品需要这个入口"
              />
            </Field>
          </div>
        </FieldGroup>
      </DialogForm>
    </>
  );
}
