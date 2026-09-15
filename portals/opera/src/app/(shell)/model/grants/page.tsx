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
 * 都留在变更流水里；原地改只会留下终点、丢掉起点。
 *
 * ── 按产品归集（owner 2026-09-15）───────────────────────────────────────────
 *
 * 「一条路由一行，一个产品会有很多条，很不直观」。一行是一个产品（持有几条、有没有
 * 停用 / 过期），展开是它持有的路由，每条路由在子表里单独管理。分页按产品计。
 *
 * 发授权仍在「产品管理 · 权益配置」（E1）——产品行的「追加路由」带着产品码跳过去，
 * 这里不再长出第二个新建入口，两处都能新建会立刻产生「以哪边为准」。
 *
 * **不做批量写**：Atlas 没有批量接口，前端逐条串发的「全部停用」一旦半途失败就是
 * 半截状态；而且 owner 2026-08-25 定的线是单条可逆可豁免、批量一律拦。
 *
 * ── PATCH 会重写应用范围 ────────────────────────────────────────────────────
 *
 * Atlas 的 `updateProductGrant` 对 `applicationId` / `applicationType` 是**无条件写**：
 * 请求里不带就当 null。所以任何修改都必须把范围原样带回去——只改到期或理由的
 * 「快捷动作」会把一条应用级授权悄悄变成产品级。编辑对话框整份回传，就是这个原因；
 * 不另做单字段的菜单项。 */

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
import { useTableLabels } from "@/lib/table";
import { useRouter, useSearchParams } from "next/navigation";
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
import { FIELD_LABEL_A11Y } from "@/lib/form-labels";
import { ListPagination } from "@/modules/shared/ListPagination";
import { useOperatorSession } from "@/features/session/SessionProvider";
import {
  STALE_ATLAS_HINT,
  deleteFailureToast,
} from "@/features/atlas/lifecycle";
import { isEnabled, type ObjectState } from "@/features/atlas/state";
import { useConfirmLabels } from "@/lib/destructive";
import { api, OperaApiError } from "@/lib/api";
import { useTableSort, type SortAccessor } from "@/lib/table-sort";
import { visibleIdOr } from "@/lib/visible-id";

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

/** 一个产品持有的全部路由授权，按入口码排序。计数在归集时算好，排序与状态摘要共用。 */
interface GrantGroup {
  productCode: string;
  grants: ProductGrantRecord[];
  /** 启用且未过期——真在放行的条数。 */
  live: number;
  inactive: number;
  /** 启用但已过期：state 说有效，读时判定说无效。 */
  expired: number;
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
  const tableLabels = useTableLabels();
  const withLabels = useConfirmLabels();
  const { toast } = useToast();
  const { can } = useOperatorSession();
  const canManage = can(MANAGE);
  /* 两条入口深链，都下推给上游（`/capability/product-grants` 两个参数都收）：
     - `?endpointCode=` 模型路由页带着入口码进来看「谁在持有这个入口」
     - `?productCode=` 权益配置页带着产品码进来看「这个产品有哪些路由」
     下推而不是本地过滤，是因为本地过滤会在"取回的这一页里没有"时显示成"没有"。 */
  const search = useSearchParams();
  const router = useRouter();
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

  const endpointMeta = useMemo(
    () => new Map(endpoints.map((e) => [e.code, e])),
    [endpoints],
  );

  const groups = useMemo<GrantGroup[]>(() => {
    const byProduct = new Map<string, ProductGrantRecord[]>();
    for (const r of filtered) {
      const list = byProduct.get(r.productCode);
      if (list) list.push(r);
      else byProduct.set(r.productCode, [r]);
    }
    return [...byProduct.entries()].map(([productCode, grants]) => ({
      productCode,
      grants: [...grants].sort((a, b) =>
        a.endpointCode.localeCompare(b.endpointCode),
      ),
      live: grants.filter((g) => isEnabled(g.state) && !isExpired(g)).length,
      inactive: grants.filter((g) => !isEnabled(g.state)).length,
      expired: grants.filter((g) => isEnabled(g.state) && isExpired(g)).length,
    }));
  }, [filtered]);

  const groupSortAccessors = useMemo<
    Readonly<Record<string, SortAccessor<GrantGroup>>>
  >(
    () => ({
      product: (g) => productName.get(g.productCode) ?? g.productCode,
      routes: (g) => g.grants.length,
      status: (g) => g.inactive + g.expired,
    }),
    [productName],
  );
  const groupSort = useTableSort(groups, groupSortAccessors);
  const pager = useListPagination(groupSort.rows, 20);

  const productTotal = useMemo(
    () => new Set(rows.map((r) => r.productCode)).size,
    [rows],
  );

  const [expandedKeys, setExpandedKeys] = useState<readonly string[]>([]);
  /* 有筛选时（深链、关键词、状态）展开命中的产品：筛出来的就是要看的那几条，
     再点一下才看得见是多余的一步。无筛选时默认收起，一屏先看全貌。 */
  const filtering =
    keyword.trim() !== "" ||
    statusFilter !== "all" ||
    productCodeFilter !== "" ||
    endpointCodeFilter !== "";
  useEffect(() => {
    if (filtering) setExpandedKeys(groups.map((g) => g.productCode));
  }, [filtering, groups]);
  const allExpanded =
    pager.pageRows.length > 0 &&
    pager.pageRows.every((g) => expandedKeys.includes(g.productCode));

  function toggleGroup(productCode: string) {
    setExpandedKeys((prev) =>
      prev.includes(productCode)
        ? prev.filter((k) => k !== productCode)
        : [...prev, productCode],
    );
  }

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

  async function copyGrant(r: ProductGrantRecord) {
    const text = [
      `${r.productCode} → ${r.endpointCode}`,
      r.applicationId
        ? `应用 ${visibleIdOr(r.applicationId, "")}${r.applicationType ? `（${r.applicationType}）` : ""}`
        : "产品级",
      r.expiresAt ? `到期 ${r.expiresAt.slice(0, 10)}` : "不限期",
      isEnabled(r.state) ? (isExpired(r) ? "已过期" : "生效中") : "已停用",
      r.reason ? `理由 ${r.reason}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    try {
      await navigator.clipboard.writeText(text);
      toast({ tone: "success", title: tShared("common.rowCopied") });
    } catch {
      toast({ tone: "danger", title: tShared("common.copyFailed") });
    }
  }

  /** 一条路由授权的菜单。只读的人也有「查看路由」与「复制」——看与改分开给。 */
  function routeMenu(r: ProductGrantRecord) {
    const label = `${r.productCode} → ${r.endpointCode}`;
    return (
      <ActionMenu
        label={`${label} 操作`}
        disabled={submitting}
        items={[
          ...(canManage
            ? [
                {
                  id: "edit",
                  label: tShared("common.edit"),
                  icon: "edit" as const,
                  onSelect: () => openEdit(r),
                },
              ]
            : []),
          {
            id: "route",
            label: "查看路由",
            icon: "arrow-right",
            onSelect: () =>
              router.push(
                `/model/routes?endpointCode=${encodeURIComponent(r.endpointCode)}`,
              ),
          },
          {
            id: "copy",
            label: tShared("common.copyRow"),
            icon: "copy",
            onSelect: () => void copyGrant(r),
          },
          ...(canManage
            ? [
                isEnabled(r.state)
                  ? {
                      id: "revoke",
                      label: "撤销（停用）",
                      icon: "prohibit" as const,
                      separatorBefore: true,
                      onSelect: () =>
                        void runAction(`${label} 已撤销`, () =>
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
                        void runAction(`${label} 已重新授予`, () =>
                          api.post(
                            `/api/atlas/product-grants/${r.id}/activate`,
                          ),
                        ),
                    },
                {
                  id: "delete",
                  label: tShared("actions.delete"),
                  icon: "trash" as const,
                  danger: true as const,
                  separatorBefore: true,
                  confirm: withLabels({
                    verb: tShared("actions.delete"),
                    target: `${label} 的授权`,
                    consequence:
                      "删除只是把已经停用的记录清掉，不可恢复。日常收回权限用「撤销」就够了，那一步留在变更流水里。",
                    /* 「要先撤销才能删」接成 `met`：一条还在放行的授权连确认钮都按不下去。
                       Atlas 侧同样拒（assertDeactivated），这里是提前说出来。 */
                    preconditions: [
                      {
                        label: "这条授权已撤销（停用）",
                        met: !isEnabled(r.state),
                      },
                    ],
                    onConfirm: () => removeGrant(r),
                  }),
                },
              ]
            : []),
        ]}
      />
    );
  }

  /** 展开行：这个产品持有的路由。`leadingSpacer` 占住父表折叠列那一格，归属靠列对齐读出来。 */
  function routeSubTable(g: GrantGroup) {
    return (
      <DataTable
        labels={tableLabels}
        leadingSpacer
        indexStart={1}
        columns={[
          {
            id: "endpoint",
            header: "路由",
            cell: (r: ProductGrantRecord) => {
              const meta = endpointMeta.get(r.endpointCode);
              return (
                <TableTitleCell
                  icon="plug"
                  title={<span className="font-mono">{r.endpointCode}</span>}
                  description={meta?.category ?? "—"}
                  {...(canManage ? { onTitleClick: () => openEdit(r) } : {})}
                />
              );
            },
          },
          {
            /* 授权指向一个停用的入口不是错误（入口可能稍后再开），但这条授权此刻
               放行不了任何东西——和授权自己的状态是两件事，分两列说。 */
            id: "entry",
            header: "入口状态",
            width: "xs",
            cell: (r: ProductGrantRecord) => {
              const meta = endpointMeta.get(r.endpointCode);
              if (endpoints.length === 0) return "—";
              if (!meta)
                return (
                  <StatusBadge tone="danger" dot>
                    入口不存在
                  </StatusBadge>
                );
              return isEnabled(meta.state) ? (
                <StatusBadge tone="success" dot>
                  {tShared("actions.enable")}
                </StatusBadge>
              ) : (
                <StatusBadge tone="warning" dot>
                  入口已停用
                </StatusBadge>
              );
            },
          },
          {
            /* 产品级 vs 应用级：`applicationId` 为空是**产品级**授权，不是"没填"。
               唯一索引用 NULLS NOT DISTINCT，这两者在约束下是不同的东西。 */
            id: "scope",
            header: "范围",
            width: "sm",
            cell: (r: ProductGrantRecord) =>
              r.applicationId ? (
                <span className="flex flex-col items-center gap-2xs">
                  <span className="text-code-sm">
                    {visibleIdOr(r.applicationId, "应用级")}
                  </span>
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
            width: "xs",
            cell: (r: ProductGrantRecord) =>
              r.expiresAt ? (
                <span
                  className={
                    isExpired(r) ? "text-warning-foreground" : "text-body-sm"
                  }
                >
                  {r.expiresAt.slice(0, 10)}
                </span>
              ) : (
                <span className="text-muted-foreground">不限</span>
              ),
          },
          {
            id: "reason",
            header: "理由",
            cell: (r: ProductGrantRecord) =>
              r.reason ? (
                <span className="block truncate text-body-sm" title={r.reason}>
                  {r.reason}
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          {
            id: "status",
            header: tShared("columns.state"),
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
        rows={g.grants}
        rowKey={(r: ProductGrantRecord) => r.id}
        rowActions={routeMenu}
      />
    );
  }

  const editing = dialog?.kind === "edit";
  const draftValid =
    draft.productCode.trim() !== "" && draft.endpointCode.trim() !== "";

  const pagination = (
    <ListPagination
      className="w-full"
      currentPage={pager.page}
      pageCount={pager.pageCount}
      total={productTotal}
      filteredTotal={groups.length}
      countLabel={`共 ${groups.length} 个产品 · ${filtered.length} 条路由`}
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
        description="去「产品管理 · 权益配置」给产品发路由授权。"
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
                ? `${groups.length} 个产品 · ${rows.length} 条路由`
                : `${groups.length} 个产品 · ${filtered.length} / ${rows.length} 条路由`
            }
            scope={
              <Button
                variant="outline"
                size="sm"
                disabled={pager.pageRows.length === 0}
                onClick={() =>
                  setExpandedKeys(
                    allExpanded ? [] : pager.pageRows.map((g) => g.productCode),
                  )
                }
              >
                <Icon
                  name={allExpanded ? "chevron-up" : "chevron-down"}
                  size="sm"
                  aria-hidden="true"
                />
                {allExpanded ? "全部收起" : "全部展开"}
              </Button>
            }
            search={
              <InputGroup className="min-w-media-2xl grow basis-0 max-w-panel-sm">
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
            }
            resetLabel={tShared("filters.reset")}
            onReset={() => {
              setKeyword("");
              setStatusFilter("all");
              pager.resetPage();
            }}
          >
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
            labels={tableLabels}
            columns={[
              {
                id: "product",
                header: tShared("columns.product"),
                sortable: true,
                cell: (g: GrantGroup) => (
                  <TableTitleCell
                    icon="package"
                    title={productName.get(g.productCode) ?? g.productCode}
                    description={g.productCode}
                    tooltip={
                      expandedKeys.includes(g.productCode)
                        ? "收起路由"
                        : "展开路由"
                    }
                    onTitleClick={() => toggleGroup(g.productCode)}
                  />
                ),
              },
              {
                id: "routes",
                header: "路由",
                sortable: true,
                align: "numeric",
                width: "xs",
                cell: (g: GrantGroup) => g.grants.length,
              },
              {
                /* 摘要只说需要看的：全部在放行时一个绿标；有停用或过期就把条数说出来，
                   展开之前就知道这个产品里有没有要处理的。 */
                id: "status",
                header: tShared("columns.state"),
                sortable: true,
                cell: (g: GrantGroup) =>
                  g.inactive === 0 && g.expired === 0 ? (
                    <StatusBadge tone="success" dot>
                      全部生效
                    </StatusBadge>
                  ) : (
                    <span className="inline-flex flex-wrap justify-center gap-2xs">
                      {g.live > 0 ? (
                        <StatusBadge tone="success" dot>
                          {g.live} 条生效
                        </StatusBadge>
                      ) : null}
                      {g.expired > 0 ? (
                        <StatusBadge tone="warning" dot>
                          {g.expired} 条已过期
                        </StatusBadge>
                      ) : null}
                      {g.inactive > 0 ? (
                        <StatusBadge tone="neutral" dot>
                          {g.inactive} 条已停用
                        </StatusBadge>
                      ) : null}
                    </span>
                  ),
              },
            ]}
            rows={pager.pageRows}
            {...(groupSort.sort ? { sort: groupSort.sort } : {})}
            onSortChange={(next) => {
              groupSort.onSortChange(next);
              pager.resetPage();
            }}
            rowKey={(g: GrantGroup) => g.productCode}
            indexStart={pager.indexStart}
            expandedKeys={expandedKeys}
            onExpandedChange={setExpandedKeys}
            expandedContent={routeSubTable}
            rowActions={(g: GrantGroup) => (
              <ActionMenu
                label={`${g.productCode} 操作`}
                items={[
                  {
                    id: "toggle",
                    label: expandedKeys.includes(g.productCode)
                      ? "收起路由"
                      : "展开路由",
                    icon: expandedKeys.includes(g.productCode)
                      ? "chevron-up"
                      : "chevron-down",
                    onSelect: () => toggleGroup(g.productCode),
                  },
                  {
                    /* 发授权的唯一入口在权益配置（E1），带着产品码过去。 */
                    id: "add",
                    label: "追加路由",
                    icon: "plus",
                    onSelect: () =>
                      router.push(
                        `/product/entitlements?productCode=${encodeURIComponent(g.productCode)}`,
                      ),
                  },
                  {
                    id: "product",
                    label: "产品详情",
                    icon: "package",
                    onSelect: () =>
                      router.push(
                        `/product/catalog/${encodeURIComponent(g.productCode)}`,
                      ),
                  },
                ]}
              />
            )}
            footer={pagination}
            empty={emptyState}
          />
        }
      />

      {/* **只剩逐条精调**：新建移到「产品管理 · 权益配置」（E1）。这里能改的是应用
          范围、到期、原因这类细项——批量入口给的是「这个产品能走这些路由」的最常见
          形状，两处都能新建会立刻产生「以哪边为准」。 */}
      <DialogForm
        size="lg"
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
        cancelLabel={tShared("actions.cancel")}
      >
        <FieldGroup columns={2}>
          <Field>
            <FieldLabel
              required
              hint={
                editing
                  ? "创建后不可变——改指向 = 一次撤销加一次新建，两个决定都要留在变更流水里。"
                  : "产品码就是 S2S 令牌上的 act.sub，调用方伪造不了。"
              }
              {...FIELD_LABEL_A11Y}
            >
              {tShared("columns.product")}
            </FieldLabel>
            <Combobox
              items={productItems}
              value={draft.productCode}
              onValueChange={(v) => setDraft({ ...draft, productCode: v })}
              placeholder="选择产品"
              searchPlaceholder="搜索产品码…"
              disabled={editing}
            />
          </Field>

          <Field>
            <FieldLabel
              required
              hint={
                editing
                  ? "同上，不可变。"
                  : "产品能调的模型由这个入口能触达的 primary / fallback 推导出来，不需要再逐个发放模型。"
              }
              {...FIELD_LABEL_A11Y}
            >
              能力入口
            </FieldLabel>
            <Combobox
              items={endpointItems}
              value={draft.endpointCode}
              onValueChange={(v) => setDraft({ ...draft, endpointCode: v })}
              placeholder="选择入口"
              searchPlaceholder="搜索入口码…"
              disabled={editing}
            />
          </Field>

          <Field>
            <FieldLabel
              hint={
                <>
                  留空是<b>产品级授权</b>
                  ，不是「没填」——这两者在唯一索引下是不同的东西。
                </>
              }
              {...FIELD_LABEL_A11Y}
              htmlFor="grant-app-id"
            >
              应用 ID
            </FieldLabel>
            <Input
              id="grant-app-id"
              value={draft.applicationId}
              onChange={(e) =>
                setDraft({ ...draft, applicationId: e.target.value })
              }
              placeholder="留空 = 产品级"
              className="font-mono"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="grant-app-type">应用类型</FieldLabel>
            <Input
              id="grant-app-type"
              value={draft.applicationType}
              onChange={(e) =>
                setDraft({ ...draft, applicationType: e.target.value })
              }
              className="font-mono"
            />
          </Field>

          <Field>
            <FieldLabel
              hint="到期在读时判定，没有清扫任务去翻 state——过期后不再放行，但这一行仍会显示成启用，页面会另外提示。"
              {...FIELD_LABEL_A11Y}
              htmlFor="grant-expires"
            >
              到期
            </FieldLabel>
            <Input
              id="grant-expires"
              type="date"
              value={draft.expiresAt}
              onChange={(e) =>
                setDraft({ ...draft, expiresAt: e.target.value })
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="grant-reason">理由</FieldLabel>
            <Input
              id="grant-reason"
              value={draft.reason}
              onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
              placeholder="为什么这个产品需要这个入口"
            />
          </Field>
        </FieldGroup>
      </DialogForm>
    </>
  );
}
