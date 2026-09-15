"use client";

/* 产品目录 — product.products 的注册与生命周期管理；同时装着草稿与正式的台账。
 *
 * 2026-08-14（B4a-1）拆出「接入凭据」到 `/product/clients`，本页少了 440 行。拆的
 * 判据是**频次**而不是主题：产品登记是一次性的，OIDC 凭据要轮换、要按渠道加、要临时
 * 禁用——两者塞在同一页，改一次产品名要滚过一屏凭据；而且抽屉按产品过滤，
 * 「哪些客户端还开着」这类横向问题在任何一个抽屉里都答不出来。行操作「接入凭据」
 * 改成带 `?productId=` 跳过去，等价于原来的抽屉但地址可分享、可后退。
 *
 * 「接入检查单」抽屉**留在本页**：它是 product × 检查项的完成态，天然属于某一个产品，
 * 没有横向看的需求。B4b 的产品上线流程会在它上面长出自动验证。
 *
 * 2026-08-12 新建：此前全仓（admin/opera 两侧）都没有任何地方能新建或编辑一行
 * 产品记录，admin-bff 的 products.router.ts 只读 + 发布 plan-version，是纯商业
 * 展示层。这里补的是基础设施登记本身——opera-bff 直连 product.products（没有
 * 独立微服务可代理），admin 现有的产品展示/订阅套餐发布原样不动，两侧零交叉
 * 引用。
 *
 * origin/origin_provider 是这次一并加的来源轴：self=平台自建、
 * third_party=第三方接入、other。新产品默认落 draft 状态，上线前操作员手动
 * 切到 active。 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionMenu,
  Banner,
  Button,
  DataTable,
  DialogForm,
  EmptyState,
  FilterBar,
  Icon,
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
  ActionButton,
} from "@vxture/design-system";
import { ListPagination } from "@/modules/shared/ListPagination";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useTableLabels } from "@/lib/table";
import {
  productSurfaceLabel,
  productTypeLabel,
  isValidProductType,
} from "@vxture/core-utils";
import {
  ConfigPopover,
  MonoList,
  StackCell,
  formatUpdatedAt,
} from "@/components/table/ConfigCells";
import { isEnabled } from "@/features/atlas/state";
import { useRouter, useSearchParams } from "next/navigation";
import {
  actionsFor,
  productStateMeta,
  VERIFICATION_META,
  verificationOf,
  type ChecklistItem,
  type ProductAction,
  type ProductState,
} from "@/features/product/lifecycle";
import { useOperatorSession } from "@/features/session/SessionProvider";
import { isStepUpCancelled, useStepUp } from "@/features/stepup/StepUpProvider";

import { api, OperaApiError } from "@/lib/api";
import { useConfirmLabels } from "@/lib/destructive";
import { useTableSort, type SortAccessor } from "@/lib/table-sort";

const MANAGE = "integration:product.manage";

type ProductOrigin = "self" | "third_party" | "other";

interface ProductRecord {
  id: string;
  productCode: string;
  productType: string;
  categoryId: number | null;
  productName: string;
  productNick: string | null;
  description: string | null;
  capabilityKeys: string[];
  tags: string[];
  standaloneSubscribable: boolean;
  state: ProductState;
  isCustomerVisible: boolean;
  isWorkforceVisible: boolean;
  origin: ProductOrigin;
  originProvider: string | null;
  createdAt: string;
  updatedAt: string;
  /** 产品图标。console 应用中心磁贴在读它。 */
  iconUrl: string | null;
  /** 可露出的端（受管枚举）。一个都没勾时是空数组，不是 null。 */
  surfaces: string[];
  /** 列表接口带出的接入摘要（边缘与回调、登录客户端、计量指标）。 */
  integration?: {
    edgeDomain: string | null;
    edgeUpstream: string | null;
    webhookUrl: string | null;
    homeUrl: string | null;
    hasWebhookSecret: boolean;
    clients: { clientId: string; channel: string; state: string }[];
    metricKeys: string[];
  };
}

const ORIGIN_LABELS: Record<ProductOrigin, string> = {
  self: "平台自建",
  third_party: "第三方接入",
  other: "其他",
};

/**
 * 删除影响面（`GET /api/products/:id/deletion-preview`）。两步删除第一步取回它，
 * 第二步照 `deletable` 决定放不放行。判据是「无客户足迹即可删」——`blockers`
 * 非空即只能退役。`cascade` 是删除会连带处理的东西，摊给操作者看清再落锤。
 */
interface ProductDeletionImpact {
  deletable: boolean;
  blockers: string[];
  footprint: {
    hasUsage: boolean;
    hasBilling: boolean;
    hasProvisioning: boolean;
    hasEntitlements: boolean;
    blocked: boolean;
  };
  upstreamAtlas: number;
  upstreamRunos: number;
  cascade: { plans: number; oidcClients: string[] };
}

/** 把 BFF 的原因码翻成一句人话——判码不判文案（product_251 X-1）。 */
const BLOCKER_LABELS: Record<string, string> = {
  HAS_USAGE: "用量记录",
  HAS_BILLING: "账单",
  HAS_PROVISIONING: "开通记录",
  HAS_ENTITLEMENTS: "生效权益",
  HAS_UPSTREAM_ATLAS: "Atlas 模型路由授权",
  HAS_UPSTREAM_RUNOS: "Runos 能力授权",
};

function describeError(error: unknown): { description?: string } {
  return error instanceof OperaApiError && error.message
    ? { description: error.message }
    : {};
}

/**
 * 退役被 BFF 挡下来的两种情况（2026-08-31 闸门，`opera/40-product-registry.md` §6）。
 *
 * 不塞进 toast：toast 装不下链接，而这两种情况运营者接下来要做的事都在别的页
 * ——去权益配置把授权清掉、或者去看哪个上游没应答。做成页面顶部的 Banner，带
 * 出口，能关掉。
 */
type RetireBlock =
  | {
      kind: "grants";
      product: ProductRecord;
      atlas: { count: number; endpointCodes: string[] };
      runos: { count: number; capabilityIds: string[] };
    }
  | {
      kind: "unavailable";
      product: ProductRecord;
      upstream: string;
      message: string;
    };

/**
 * 从 409 `PRODUCT_HAS_ACTIVE_GRANTS` 的结构化体里取条数与样本。样本只取**可读码**
 * （路由码 / 能力 ID），`id` / `grantId` 是给机器的，不上屏。形状对不上就按 0 条
 * 处理——但 Banner 照样出：拦是拦住了，只是明细没读到。
 */
function grantsBlockOf(
  product: ProductRecord,
  body: Record<string, unknown> | null,
): RetireBlock {
  const side = (
    key: "atlas" | "runos",
    codeKey: "endpointCode" | "capabilityId",
  ): { count: number; codes: string[] } => {
    const raw = body?.[key];
    if (!raw || typeof raw !== "object") return { count: 0, codes: [] };
    const rec = raw as { count?: unknown; sample?: unknown };
    const count = typeof rec.count === "number" ? rec.count : 0;
    const codes = Array.isArray(rec.sample)
      ? rec.sample
          .map((s) =>
            s && typeof s === "object"
              ? (s as Record<string, unknown>)[codeKey]
              : undefined,
          )
          .filter((c): c is string => typeof c === "string")
      : [];
    return { count, codes };
  };
  const atlas = side("atlas", "endpointCode");
  const runos = side("runos", "capabilityId");
  return {
    kind: "grants",
    product,
    atlas: { count: atlas.count, endpointCodes: atlas.codes },
    runos: { count: runos.count, capabilityIds: runos.codes },
  };
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

/** `useSearchParams` 需要 Suspense 边界。 */
export default function ProductsPage() {
  return (
    <Suspense fallback={null}>
      <ProductsPageContent />
    </Suspense>
  );
}

function ProductsPageContent() {
  const locale = useLocale();
  /* 查表函数收的是 "zh" | "en"，而 next-intl 给的是 zh-CN / en-US。 */
  const typeLocale = locale.startsWith("en") ? "en" : "zh";
  const tShared = useTranslations();
  const tableLabels = useTableLabels();
  const withLabels = useConfirmLabels();
  const { toast } = useToast();
  const router = useRouter();
  const dateLocale = useLocale();
  const { can } = useOperatorSession();
  /* 删除是高危写路由（BFF 挂 `@RequireStepUp()`）——命中闸门弹 TOTP、换 300s 凭证、
     重试，与 model/keys 那批同一套。 */
  const { runWithStepUp } = useStepUp();
  const canManage = can(MANAGE);

  /* 接入凭据页与权益配置页都会带产品 id 点回来（「在产品目录里查看」）。 */
  const productIdFilter = useSearchParams().get("productId") ?? "";

  const [rows, setRows] = useState<ProductRecord[]>([]);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [keyword, setKeyword] = useState("");
  const [originFilter, setOriginFilter] = useState<"all" | ProductOrigin>(
    "all",
  );
  const [stateFilter, setStateFilter] = useState<"all" | ProductState>("all");
  const [selectedKeys, setSelectedKeys] = useState<readonly string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  /* 全部产品的检查单完成态，一次取回（`GET /api/products/checklist-summary`）。
     验证态要显示在**列表**上，逐行去调单产品那条就是 N 次往返。 */
  const [checklistByProduct, setChecklistByProduct] = useState<
    Record<string, ChecklistItem[]>
  >({});
  /* 权益计数：路由授权（Atlas）与能力授权（Runos）各一份。null = 没读到（或还在读），
     界面显示「—」而不是 0——「没有授权」与「没查到」不能长得一样。 */
  const [routeCounts, setRouteCounts] = useState<Record<
    string,
    { live: number; total: number }
  > | null>(null);
  const [capCounts, setCapCounts] = useState<Record<
    string,
    { direct: number; derived: number }
  > | null>(null);
  const [capFailed, setCapFailed] = useState<string[]>([]);
  /* 需要二次确认的生命周期动作。退役不可逆、恢复要提醒重新验证——两者都不该
     点一下就发生。 */
  const [pendingAction, setPendingAction] = useState<{
    product: ProductRecord;
    action: ProductAction;
  } | null>(null);
  /** 最近一次被挡下来的退役。成功退役任何产品、或人手关掉，都清空。 */
  const [retireBlock, setRetireBlock] = useState<RetireBlock | null>(null);
  /* 两步删除：菜单点「删除」先拉影响面预览（impact=null 即加载中），看清能不能删、
     连带处理什么，再在对话框里落锤。loadError 记预览读取失败。 */
  const [deletion, setDeletion] = useState<{
    product: ProductRecord;
    impact: ProductDeletionImpact | null;
    loadError: string | null;
  } | null>(null);

  const reload = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      /* 分类清单不再在这一页取：登记对话框已经不收分类了（搬去详情页），
         而列表本身不显示它。留着就是每次进目录页多一次没人用的请求。 */
      const [products, summary] = await Promise.all([
        api.get<ProductRecord[]>("/api/products"),
        /* 汇总失败不该让整页读不出来——验证态是附加信息，产品目录本身不依赖它。
           所以这一条单独兜底成空对象，全部行显示「未验证」。 */
        api
          .get<
            Record<string, ChecklistItem[]>
          >("/api/products/checklist-summary")
          .catch(() => ({}) as Record<string, ChecklistItem[]>),
      ]);
      setRows(products);
      setChecklistByProduct(summary);
      setLoad({ kind: "ready" });
      /* 权益计数是附加信息：不阻塞目录，失败只让那一格显示「—」并点名没读到。 */
      const codes = products.map((p) => p.productCode);
      void Promise.all([
        api
          .get<
            { productCode: string; state: string }[]
          >("/api/atlas/product-grants?includeInactive=true")
          .catch(() => null),
        codes.length === 0
          ? Promise.resolve({ byProduct: {}, failed: [] as string[] })
          : api
              .get<{
                byProduct: Record<string, { grantType: string }[]>;
                failed: string[];
              }>(
                "/api/runos/grants/summary?productCodes=" +
                  encodeURIComponent(codes.join(",")),
              )
              .catch(() => null),
      ]).then(([routes, caps]) => {
        if (routes) {
          const next: Record<string, { live: number; total: number }> = {};
          for (const g of routes) {
            const c = next[g.productCode] ?? { live: 0, total: 0 };
            c.total += 1;
            if (isEnabled(g.state)) c.live += 1;
            next[g.productCode] = c;
          }
          setRouteCounts(next);
        } else {
          setRouteCounts(null);
        }
        if (caps) {
          const next: Record<string, { direct: number; derived: number }> = {};
          for (const [code, grants] of Object.entries(
            caps.byProduct as Record<string, { grantType: string }[]>,
          )) {
            const direct = grants.filter(
              (g) => g.grantType === "direct",
            ).length;
            next[code] = { direct, derived: grants.length - direct };
          }
          setCapCounts(next);
          setCapFailed(caps.failed);
        } else {
          setCapCounts(null);
          setCapFailed(codes);
        }
      });
    } catch (error) {
      setLoad({
        kind: "error",
        message:
          error instanceof OperaApiError ? error.message : "读取产品目录失败",
      });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (productIdFilter === "" || r.id === productIdFilter) &&
        (originFilter === "all" || r.origin === originFilter) &&
        (stateFilter === "all" || r.state === stateFilter) &&
        (kw === "" ||
          r.productCode.toLowerCase().includes(kw) ||
          r.productName.toLowerCase().includes(kw)),
    );
  }, [rows, keyword, originFilter, stateFilter, productIdFilter]);

  const productSortAccessors = useMemo<
    Readonly<Record<string, SortAccessor<ProductRecord>>>
  >(
    () => ({
      name: (r) => r.productName,
      origin: (r) => r.origin,
      type: (r) => r.productType,
      state: (r) => r.state,
      verification: (r) => verificationOf(checklistByProduct[r.id] ?? []),
      updated: (r) => r.updatedAt,
    }),
    [checklistByProduct],
  );
  const productSort = useTableSort(filtered, productSortAccessors);
  const pager = useListPagination(productSort.rows, 20);

  /**
   * 进产品详情页。
   *
   * 此前这里是 `openEdit`——开一个编辑对话框。owner 2026-09-11:「一个产品接入，
   * 分散在多个弹出页面，感觉很乱……一个详情页争取配置完所有」。同一批字段留两个
   * 写入面比分散更糟:两处都能改、两处的校验与文案会各自漂。
   *
   * 新建也进同一张页（`/product/catalog/new`）：2026-09-14 起目录页不再有登记、webhook、
   * 计量、检查单这些弹窗——它们与产品页上的同一批字段是两个写入面。
   */
  function openDetail(row: ProductRecord) {
    router.push(`/product/catalog/${encodeURIComponent(row.productCode)}`);
  }

  /** 生命周期动作入口：该确认的先确认，该查检查单的先查。 */
  /**
   * 非破坏性生命周期动作的入口。
   *
   * **破坏性动作不走这里**：它们的确认由 DS 的 `ConfirmDestructive` 接管（菜单项
   * 的 `confirm`），落锤直接进 `applyLifecycle`。这里剩下两件事：上线前的检查单
   * 门槛，以及「恢复」那一档的提醒（`advisory`——提醒不是门闩，没有条件可以不
   * 满足）。
   */
  function runLifecycle(product: ProductRecord, action: ProductAction) {
    if (action.requiresChecklist) {
      const items = checklistByProduct[product.id];
      /* **读不到检查单时挡住，不是放行。** 汇总接口失败会让这里拿到 undefined，
         而「没有未满足项」与「不知道有没有未满足项」在数组上长得一模一样——
         按"空数组=全通过"处理，等于上游一挂就人人可上线。门槛失效必须失效在
         保守那一侧。 */
      if (!items || items.length === 0) {
        toast({
          tone: "danger",
          title: "读不到接入检查单，不能确认上线",
          description:
            "上线要求必填检查项全部满足，而现在拿不到检查结果——拿不到不等于通过。刷新页面重试；持续失败说明 opera-bff 的 checklist-summary 读不出来。",
        });
        return;
      }
      const pending = items.filter((i) => i.isRequired && !i.isSatisfied);
      if (pending.length > 0) {
        /* 不是"禁用按钮"而是"点了告诉他还差什么"：禁用状态的菜单项只说明"不行"，
           说不出"差哪几项"，而后者才是运营者接下来要做的事。 */
        toast({
          tone: "danger",
          title: `还有 ${pending.length} 项接入检查未完成`,
          description:
            "上线前必填项要全部满足。打开「接入检查单」看差哪几项，以及各自卡在我方还是对方。",
        });
        return;
      }
    }
    if (action.advisory) {
      setPendingAction({ product, action });
      return;
    }
    void applyLifecycle(product, action);
  }

  async function applyLifecycle(product: ProductRecord, action: ProductAction) {
    const label = `${product.productName} · ${action.label}`;
    setSubmitting(true);
    try {
      await api.patch(`/api/products/${product.id}/state`, {
        state: action.to,
      });
      toast({ tone: "success", title: label });
      if (action.to === "deprecated") setRetireBlock(null);
      await reload();
    } catch (error) {
      /* 退役闸门的两种拒绝（BFF `assertNoActiveUpstreamGrants`）各有各的下一步，
         **判码不判文案**：409 = 上游还有生效授权，出口是权益配置页；502 = 上游没
         查到，退役没有执行，出口是稍后重试。其它错误（403、非法迁移）照旧一条
         toast。 */
      if (
        action.to === "deprecated" &&
        error instanceof OperaApiError &&
        error.code === "PRODUCT_HAS_ACTIVE_GRANTS"
      ) {
        setRetireBlock(grantsBlockOf(product, error.body));
        toast({
          tone: "danger",
          title: `${product.productName} 未退役：上游还有生效中的授权`,
          description: "先去权益配置把它们撤掉。条数与出口见页顶。",
        });
      } else if (
        action.to === "deprecated" &&
        error instanceof OperaApiError &&
        error.status === 502
      ) {
        const upstream =
          typeof error.body?.["upstream"] === "string"
            ? error.body["upstream"]
            : "上游";
        setRetireBlock({
          kind: "unavailable",
          product,
          upstream,
          message: error.message,
        });
        toast({
          tone: "danger",
          title: `${product.productName} 未退役：上游授权检查失败`,
          description: "查不到不等于没有——退役没有执行。",
        });
      } else {
        toast({
          tone: "danger",
          title: `${label}失败`,
          ...describeError(error),
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * 删除入口（两步删除第一步）。先拉影响面预览再开对话框——不预览就打开等于让操作者
   * 对着一个「不知道会连带删掉什么、也不知道能不能删」的确认框落锤。预览读失败时
   * 对话框照开，但显示错误、禁掉删除按钮：读不到影响面不能删。
   */
  async function openDeletion(product: ProductRecord) {
    setDeletion({ product, impact: null, loadError: null });
    try {
      const impact = await api.get<ProductDeletionImpact>(
        `/api/products/${encodeURIComponent(product.id)}/deletion-preview`,
      );
      /* 期间没被换成删别的产品才落库——两步之间用户可能关掉又开另一个。 */
      setDeletion((cur) =>
        cur && cur.product.id === product.id
          ? { product, impact, loadError: null }
          : cur,
      );
    } catch (error) {
      setDeletion((cur) =>
        cur && cur.product.id === product.id
          ? {
              product,
              impact: null,
              loadError:
                describeError(error).description ?? "读取删除影响面失败",
            }
          : cur,
      );
    }
  }

  /**
   * 删除落锤（两步删除第二步）。走 step-up；BFF 会再复核一次判据，所以预览之后到
   * 这里之间新长出的客户足迹/上游授权仍会被 409 挡下——那时收起对话框，把出口
   * （去权益配置撤销 / 改用退役）给到位。
   */
  async function confirmDeletion() {
    if (!deletion?.impact?.deletable) return;
    const product = deletion.product;
    setSubmitting(true);
    try {
      await runWithStepUp(() =>
        api.delete(`/api/products/${product.id}`, { confirm: true }),
      );
      toast({
        tone: "success",
        title: `${product.productName} 已删除`,
        description: "已从产品目录移除（软删除）。",
      });
      setDeletion(null);
      await reload();
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      /* 判码不判文案（product_251 X-1）。两种 409 各有各的出口，和退役闸门共用
         同一套 Banner/toast 呈现：都是「删不成，去做另一件事」。 */
      if (
        error instanceof OperaApiError &&
        error.code === "PRODUCT_HAS_ACTIVE_GRANTS"
      ) {
        setDeletion(null);
        setRetireBlock(grantsBlockOf(product, error.body));
        toast({
          tone: "danger",
          title: `${product.productName} 未删除：上游还有生效中的授权`,
          description: "先去权益配置把它们撤掉。条数与出口见页顶。",
        });
      } else if (
        error instanceof OperaApiError &&
        error.code === "PRODUCT_HAS_CUSTOMER_FOOTPRINT"
      ) {
        setDeletion(null);
        toast({
          tone: "danger",
          title: `${product.productName} 未删除：已有客户使用记录`,
          description:
            "有用量 / 账单 / 开通 / 权益记录的产品不能删除，只能退役。",
        });
      } else {
        toast({
          tone: "danger",
          title: `删除 ${product.productName} 失败`,
          ...describeError(error),
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

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
        description="正在读取产品目录。"
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
        title="没有匹配的产品"
        description={tShared("common.noMatchHint")}
      />
    ) : (
      <EmptyState
        title="暂无产品"
        description="点击「接入产品」开始——登记会先建一条草稿，然后进入上线流程。"
      />
    );

  return (
    <>
      <ListPageTemplate
        summary={
          productIdFilter || retireBlock ? (
            <div className="flex flex-col gap-sm">
              {productIdFilter ? (
                <Banner
                  tone="info"
                  title={`只显示 ${rows.find((r) => r.id === productIdFilter)?.productName ?? "一个产品"}`}
                  description="从接入凭据或权益配置页点回来的。"
                  action={
                    <Button asChild variant="secondary" size="sm">
                      <Link href="/product/catalog">
                        {tShared("common.showAll")}
                      </Link>
                    </Button>
                  }
                />
              ) : null}
              {retireBlock?.kind === "grants" ? (
                <Banner
                  tone="danger"
                  title={`${retireBlock.product.productName} 未退役：Atlas ${retireBlock.atlas.count} 条模型路由授权、Runos ${retireBlock.runos.count} 条能力授权仍在生效`}
                  description={[
                    "退役前要先把它们全部撤销——目录是唯一权威，上游按产品码挂着的授权不会随退役自动消失。",
                    retireBlock.atlas.endpointCodes.length > 0
                      ? `路由：${retireBlock.atlas.endpointCodes.join("、")}${retireBlock.atlas.count > retireBlock.atlas.endpointCodes.length ? " 等" : ""}`
                      : "",
                    retireBlock.runos.capabilityIds.length > 0
                      ? `能力：${retireBlock.runos.capabilityIds.join("、")}${retireBlock.runos.count > retireBlock.runos.capabilityIds.length ? " 等" : ""}`
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  action={
                    <Button asChild variant="secondary" size="sm">
                      <Link
                        href={`/product/entitlements?productCode=${encodeURIComponent(retireBlock.product.productCode)}`}
                      >
                        去权益配置撤销
                      </Link>
                    </Button>
                  }
                  onDismiss={() => setRetireBlock(null)}
                />
              ) : retireBlock?.kind === "unavailable" ? (
                <Banner
                  tone="warning"
                  title={`${retireBlock.product.productName} 未退役：${retireBlock.upstream} 的授权没有查到`}
                  description={`${retireBlock.message} 查不到不等于没有——退役要求先确认上游没有生效中的授权，所以这次没有执行；上游恢复后再试。`}
                  onDismiss={() => setRetireBlock(null)}
                />
              ) : null}
            </div>
          ) : undefined
        }
        header={
          <ViewHeader
            icon="package"
            title="产品目录"
            description="平台产品的基础设施登记；数据来自 product.products。商业定价/套餐发布仍在 admin。"
          />
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
            search={
              <InputGroup className="min-w-media-2xl grow basis-0 max-w-panel-sm">
                <InputGroupAddon>
                  <Icon name="search" size="sm" aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  placeholder="搜索产品…"
                  aria-label="搜索产品"
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
              setOriginFilter("all");
              setStateFilter("all");
              pager.resetPage();
            }}
            actions={
              canManage ? (
                <ActionButton
                  icon="plus"
                  onClick={() => router.push("/product/catalog/new")}
                >
                  接入产品
                </ActionButton>
              ) : null
            }
          >
            <NativeSelect
              wrapperClassName="w-fit"
              value={originFilter}
              onChange={(e) => {
                setOriginFilter(e.target.value as typeof originFilter);
                pager.resetPage();
              }}
              aria-label="来源筛选"
            >
              <option value="all">全部来源</option>
              <option value="self">平台自建</option>
              <option value="third_party">第三方接入</option>
              <option value="other">其他</option>
            </NativeSelect>
            <NativeSelect
              wrapperClassName="w-fit"
              value={stateFilter}
              onChange={(e) => {
                setStateFilter(e.target.value as typeof stateFilter);
                pager.resetPage();
              }}
              aria-label={tShared("filters.stateLabel")}
            >
              <option value="all">{tShared("filters.allStates")}</option>
              <option value="draft">草稿</option>
              <option value="active">已上线</option>
              <option value="inactive">
                {tShared("status.generic.disabled")}
              </option>
              <option value="deprecated">已退役</option>
            </NativeSelect>
          </FilterBar>
        }
        table={
          <DataTable
            labels={tableLabels}
            columns={[
              {
                id: "name",
                header: tShared("columns.product"),
                sortable: true,
                /* 点标题进详情页。只读的人也该看得到配置，详情页自己按权限决定可不可改。 */
                cell: (r: ProductRecord) => (
                  <TableTitleCell
                    icon="package"
                    title={r.productName}
                    description={r.productCode}
                    onTitleClick={() => openDetail(r)}
                  />
                ),
              },
              {
                /* 类型为主、来源为辅（owner 2026-09-16「相似的两列合并，上下主辅」）。
                   受管枚举外的 product_type 仍标「非合规」——显影而非静默。 */
                id: "type",
                header: "类型 / 来源",
                sortable: true,
                width: "md",
                cell: (r: ProductRecord) => (
                  <StackCell
                    main={
                      <span className="inline-flex items-center justify-center gap-1.5">
                        <span
                          className={
                            isValidProductType(r.productType)
                              ? undefined
                              : "text-code-sm"
                          }
                        >
                          {productTypeLabel(r.productType, typeLocale)}
                        </span>
                        {isValidProductType(r.productType) ? null : (
                          <StatusBadge tone="warning" dot>
                            {tShared("common.nonCompliant")}
                          </StatusBadge>
                        )}
                      </span>
                    }
                    sub={
                      ORIGIN_LABELS[r.origin] +
                      (r.origin === "third_party" && r.originProvider
                        ? " · " + r.originProvider
                        : "")
                    }
                  />
                ),
              },
              {
                id: "integration",
                header: "接入配置",
                width: "lg",
                cell: (r: ProductRecord) => (
                  <IntegrationCell product={r} locale={typeLocale} />
                ),
              },
              {
                id: "entitlements",
                header: "权益",
                width: "md",
                cell: (r: ProductRecord) => {
                  const routes = routeCounts?.[r.productCode];
                  const caps = capCounts?.[r.productCode];
                  const capMissing =
                    capCounts === null || capFailed.includes(r.productCode);
                  const notes = [
                    routeCounts === null ? "路由授权没读到" : null,
                    capMissing ? "能力授权没读到" : null,
                    routes && routes.total > routes.live
                      ? routes.total - routes.live + " 条路由已停用"
                      : null,
                    caps && caps.derived > 0
                      ? "推导能力 " + caps.derived
                      : null,
                  ].filter((x): x is string => x !== null);
                  return (
                    <StackCell
                      main={
                        <Link
                          href={
                            "/product/entitlements?productCode=" +
                            encodeURIComponent(r.productCode)
                          }
                          className="hover:text-primary-text"
                        >
                          {"路由 " +
                            (routeCounts === null ? "—" : (routes?.live ?? 0)) +
                            " · 能力 " +
                            (capMissing ? "—" : (caps?.direct ?? 0))}
                        </Link>
                      }
                      sub={notes.length > 0 ? notes.join(" · ") : undefined}
                    />
                  );
                },
              },
              {
                /* 生命周期为主、验证态为辅。两者仍是两个事实（设计文件 §6.4 不合并字段），
                   只是同一格上下展示。 */
                id: "state",
                header: "状态",
                sortable: true,
                width: "sm",
                cell: (r: ProductRecord) => {
                  const v = verificationOf(checklistByProduct[r.id] ?? []);
                  return (
                    <StackCell
                      main={
                        <StatusBadge tone={productStateMeta(r.state).tone} dot>
                          {productStateMeta(r.state).label}
                        </StatusBadge>
                      }
                      sub={VERIFICATION_META[v].label}
                    />
                  );
                },
              },
              {
                id: "updated",
                header: "更新时间",
                sortable: true,
                width: "sm",
                cell: (r: ProductRecord) => (
                  <span className="text-body-sm text-muted-foreground">
                    {formatUpdatedAt(r.updatedAt, dateLocale)}
                  </span>
                ),
              },
            ]}
            rows={pager.pageRows}
            {...(productSort.sort ? { sort: productSort.sort } : {})}
            onSortChange={(next) => {
              productSort.onSortChange(next);
              pager.resetPage();
            }}
            rowKey={(r: ProductRecord) => r.id}
            selectedKeys={selectedKeys}
            onSelectionChange={setSelectedKeys}
            indexStart={pager.indexStart}
            rowActions={(r: ProductRecord) => {
              const code = encodeURIComponent(r.productCode);
              const detail = "/product/catalog/" + code;
              return (
                <ActionMenu
                  label={r.productName + " 操作"}
                  disabled={submitting}
                  items={[
                    {
                      id: "edit",
                      label: "配置详情",
                      icon: "edit",
                      onSelect: () => openDetail(r),
                    },
                    /* 接入：跳产品页并直接打开对应面板（owner 2026-09-16 选定）——复用产品页的
                       抽屉与深链，列表页不另存一份会漂的抽屉。 */
                    {
                      id: "checks",
                      label: "接入检查",
                      icon: "list-checks",
                      separatorBefore: true,
                      onSelect: () => router.push(detail + "?panel=checks"),
                    },
                    {
                      id: "secrets",
                      label: "密钥管理",
                      icon: "key",
                      onSelect: () => router.push(detail + "?panel=secrets"),
                    },
                    {
                      id: "login",
                      label: "登录接入",
                      icon: "fingerprint",
                      onSelect: () => router.push(detail + "#section-login"),
                    },
                    {
                      id: "metrics",
                      label: "计量指标",
                      icon: "gauge",
                      onSelect: () => router.push(detail + "#section-metrics"),
                    },
                    /* 授权：三处各管一段——权益配置看合集，路由 / 能力各去自己的域页。 */
                    {
                      id: "entitlements",
                      label: "权益配置",
                      icon: "ticket",
                      separatorBefore: true,
                      onSelect: () =>
                        router.push(
                          "/product/entitlements?productCode=" + code,
                        ),
                    },
                    {
                      id: "model-grants",
                      label: "模型路由授权",
                      icon: "plug",
                      onSelect: () =>
                        router.push("/model/grants?productCode=" + code),
                    },
                    {
                      id: "capability-grants",
                      label: "能力授权",
                      icon: "shield",
                      onSelect: () =>
                        router.push("/capability/grants?productCode=" + code),
                    },
                    /* 生命周期与删除只给有管理权的人；上面的查看与跳转人人都有。
                       生命周期动作由 PRODUCT_ACTIONS 那张表生成，破坏性与否也由表决定。 */
                    ...(canManage
                      ? [
                          ...actionsFor(r.state).map((a, index) =>
                            a.danger
                              ? {
                                  id: a.id,
                                  label: a.label,
                                  icon: a.icon,
                                  danger: true as const,
                                  separatorBefore:
                                    index === 0 ||
                                    a.id === "launch" ||
                                    a.id === "suspend",
                                  confirm: withLabels({
                                    verb: a.destructive.verb,
                                    target: "产品 " + r.productName,
                                    consequence: a.destructive.consequence,
                                    onConfirm: () => applyLifecycle(r, a),
                                  }),
                                }
                              : {
                                  id: a.id,
                                  label: a.label,
                                  icon: a.icon,
                                  separatorBefore:
                                    index === 0 ||
                                    a.id === "launch" ||
                                    a.id === "suspend",
                                  onSelect: () => runLifecycle(r, a),
                                },
                          ),
                          {
                            /* 删除（两步）：先拉影响面预览，再在专用对话框里落锤。 */
                            id: "delete",
                            label: "删除",
                            icon: "trash" as const,
                            danger: true as const,
                            separatorBefore: true,
                            confirmExempt:
                              "两步删除自带确认：先拉影响面预览，再在专用对话框里落锤",
                            onSelect: () => void openDeletion(r),
                          },
                        ]
                      : []),
                  ]}
                />
              );
            }}
            footer={pagination}
            empty={emptyState}
          />
        }
      />

      {/* 二次确认。退役不可逆、恢复要提醒重新验证——两者都不该点一下就发生。 */}
      <DialogForm
        size="sm"
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null);
        }}
        title={pendingAction?.action.advisory?.title ?? ""}
        description={pendingAction?.action.advisory?.description}
        submitLabel={pendingAction?.action.label ?? "确认"}
        submitting={submitting}
        onSubmit={(e) => {
          e.preventDefault();
          const p = pendingAction;
          setPendingAction(null);
          if (p) void applyLifecycle(p.product, p.action);
        }}
        cancelLabel={tShared("actions.cancel")}
      >
        <p className="text-body-sm text-muted-foreground">
          对象：{pendingAction?.product.productName}（
          <span className="font-mono text-code-sm">
            {pendingAction?.product.productCode}
          </span>
          ）
        </p>
      </DialogForm>

      {/* 删除确认（两步删除第二步）。先看影响面：能删就摊开连带处理，不能删就说清
          为什么、禁掉按钮、指向退役。删除按钮走 DialogForm 的 danger（红）。 */}
      <DialogForm
        size="sm"
        open={deletion !== null}
        danger
        onOpenChange={(open) => {
          if (!open) setDeletion(null);
        }}
        title={
          deletion ? `删除产品 · ${deletion.product.productName}` : "删除产品"
        }
        description="删除把产品从目录彻底移除（软删除），区别于退役——退役是可见的终态「已退役」、老订阅照付。仅当没有任何客户使用记录时可删。"
        submitLabel="确认删除"
        submitting={submitting}
        submitDisabled={!deletion?.impact?.deletable}
        onSubmit={(e) => {
          e.preventDefault();
          void confirmDeletion();
        }}
        cancelLabel={tShared("actions.cancel")}
      >
        {deletion?.loadError ? (
          /* 读不到影响面不能删——同 webhook 那条判据：读失败时放行等于蒙着眼动手。 */
          <EmptyState
            title={tShared("common.loadFailed")}
            description={`${deletion.loadError}。读不到影响面不能删，先解决读取失败。`}
          />
        ) : !deletion?.impact ? (
          <EmptyState
            title={tShared("common.loading")}
            description="正在核对客户足迹与连带处理项。"
          />
        ) : (
          <div className="flex flex-col gap-md">
            <p className="text-body-sm text-muted-foreground">
              对象：{deletion.product.productName}（
              <span className="font-mono text-code-sm">
                {deletion.product.productCode}
              </span>
              ）
            </p>
            {deletion.impact.deletable ? (
              <Banner
                tone="warning"
                title="确认后将从产品目录移除（软删除）"
                description={[
                  deletion.impact.cascade.plans > 0
                    ? `连带软删 ${deletion.impact.cascade.plans} 个套餐。`
                    : "",
                  deletion.impact.cascade.oidcClients.length > 0
                    ? `停用登录客户端 ${deletion.impact.cascade.oidcClients.join("、")}——该产品登录会中断。`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              />
            ) : (
              <Banner
                tone="danger"
                title={`${deletion.product.productName} 不能删除，只能退役`}
                description={`已有${deletion.impact.blockers
                  .map((b) => BLOCKER_LABELS[b] ?? b)
                  .join(
                    "、",
                  )}——有客户使用记录或上游生效授权的产品不能删除。改用操作菜单里的「退役」。`}
              />
            )}
          </div>
        )}
      </DialogForm>
    </>
  );
}

/**
 * 「接入配置」一格：边缘域名为主，登录渠道与计量指标数为辅；辅行点开是整份接入摘要。
 * 字段都来自列表接口带出的 integration 摘要，不逐行再打请求。
 */
function IntegrationCell({
  product,
  locale,
}: {
  readonly product: ProductRecord;
  readonly locale: Parameters<typeof productSurfaceLabel>[1];
}) {
  const s = product.integration;
  const clients = s?.clients ?? [];
  const metrics = s?.metricKeys ?? [];
  const channels = [...new Set(clients.map((c) => c.channel))];
  const visibility =
    [
      product.isCustomerVisible ? "客户域" : null,
      product.isWorkforceVisible ? "运营域" : null,
    ]
      .filter((x): x is string => x !== null)
      .join(" / ") || "—";
  return (
    <StackCell
      main={
        s?.edgeDomain ? (
          <span className="font-mono text-code-sm">{s.edgeDomain}</span>
        ) : (
          <span className="text-muted-foreground">未配置边缘域名</span>
        )
      }
      sub={
        <ConfigPopover
          trigger={
            "登录 " +
            (channels.length > 0 ? channels.join(" · ") : "未配置") +
            " · 计量 " +
            metrics.length
          }
          title={product.productName + " · 接入配置"}
          rows={[
            {
              label: "边缘域名",
              value: <MonoList items={s?.edgeDomain ? [s.edgeDomain] : []} />,
            },
            {
              label: "边缘上游",
              value: (
                <MonoList items={s?.edgeUpstream ? [s.edgeUpstream] : []} />
              ),
            },
            {
              label: "回调地址",
              value: <MonoList items={s?.webhookUrl ? [s.webhookUrl] : []} />,
            },
            {
              label: "签名密钥",
              value: s?.hasWebhookSecret ? "已登记" : "未登记",
            },
            {
              label: "产品主页",
              value: <MonoList items={s?.homeUrl ? [s.homeUrl] : []} />,
            },
            { label: "可见性", value: visibility },
            {
              label: "终端",
              value:
                product.surfaces.length > 0
                  ? product.surfaces
                      .map((x) =>
                        productSurfaceLabel(
                          x as Parameters<typeof productSurfaceLabel>[0],
                          locale,
                        ),
                      )
                      .join("、")
                  : "—",
            },
            {
              label: "登录客户端",
              value: (
                <MonoList
                  items={clients.map(
                    (c) =>
                      c.clientId +
                      " · " +
                      c.channel +
                      (c.state === "active" ? "" : " · 已停用"),
                  )}
                />
              ),
            },
            { label: "计量指标", value: <MonoList items={metrics} /> },
          ]}
          href={"/product/catalog/" + encodeURIComponent(product.productCode)}
          hrefLabel="去产品页配置"
        />
      }
    />
  );
}
