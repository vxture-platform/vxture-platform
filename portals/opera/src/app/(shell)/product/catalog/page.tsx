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

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  ActionMenu,
  Badge,
  Banner,
  Button,
  Checkbox,
  DataTable,
  DialogForm,
  Drawer,
  EmptyState,
  Field,
  FieldDescription,
  FieldGroup,
  FieldTier,
  FieldLabel,
  FilterBar,
  Icon,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  ListPageTemplate,
  NativeSelect,
  Pagination,
  StatusBadge,
  Switch,
  TableTitleCell,
  Textarea,
  ViewHeader,
  useListPagination,
  useToast,
} from "@vxture/design-system";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { PRODUCT_TYPE_DEFS, isValidProductType } from "@vxture/core-utils";
import { useRouter, useSearchParams } from "next/navigation";
import {
  actionsFor,
  PRODUCT_STATE_META,
  VERIFICATION_META,
  verificationOf,
  type ChecklistItem,
  type ProductAction,
  type ProductState,
} from "@/features/product/lifecycle";
import { useOperatorSession } from "@/features/session/SessionProvider";
import { isStepUpCancelled, useStepUp } from "@/features/stepup/StepUpProvider";
import { buildAdminAtlasGrantsUrl } from "@/lib/admin-entry";
import { api, OperaApiError } from "@/lib/api";
import { useConfirmLabels } from "@/lib/destructive";

const MANAGE = "platform:product.manage";

interface ChecklistItemRecord {
  itemCode: string;
  itemName: string;
  description: string | null;
  isRequired: boolean;
  sort: number;
  isSatisfied: boolean;
  checkedAt: string | null;
  remark: string | null;
}

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
}

interface ProductCategoryRecord {
  id: number;
  parentId: number | null;
  code: string;
  name: string;
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

type DialogState =
  | { kind: "create" }
  | { kind: "edit"; row: ProductRecord }
  | { kind: "webhook"; row: ProductRecord }
  | null;

/** `product.product_webhooks` 一行。三列都可空——见 BFF `putWebhook` 的注释。 */
interface WebhookDraft {
  homeUrl: string;
  webhookUrl: string;
  webhookSecretRef: string;
}

const EMPTY_WEBHOOK: WebhookDraft = {
  homeUrl: "",
  webhookUrl: "",
  webhookSecretRef: "",
};

interface ProductDraft {
  productCode: string;
  productType: string;
  categoryId: string;
  productName: string;
  productNick: string;
  description: string;
  origin: ProductOrigin;
  originProvider: string;
  standaloneSubscribable: boolean;
  isCustomerVisible: boolean;
  isWorkforceVisible: boolean;
}

const EMPTY_DRAFT: ProductDraft = {
  productCode: "",
  productType: "",
  categoryId: "",
  productName: "",
  productNick: "",
  description: "",
  origin: "self",
  originProvider: "",
  standaloneSubscribable: true,
  isCustomerVisible: true,
  isWorkforceVisible: true,
};

function draftFromRecord(row: ProductRecord): ProductDraft {
  return {
    productCode: row.productCode,
    productType: row.productType,
    categoryId: row.categoryId != null ? String(row.categoryId) : "",
    productName: row.productName,
    productNick: row.productNick ?? "",
    description: row.description ?? "",
    origin: row.origin,
    originProvider: row.originProvider ?? "",
    standaloneSubscribable: row.standaloneSubscribable,
    isCustomerVisible: row.isCustomerVisible,
    isWorkforceVisible: row.isWorkforceVisible,
  };
}

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
  const tShared = useTranslations();
  const withLabels = useConfirmLabels();
  const { toast } = useToast();
  const router = useRouter();
  const { can } = useOperatorSession();
  /* 删除是高危写路由（BFF 挂 `@RequireStepUp()`）——命中闸门弹 TOTP、换 300s 凭证、
     重试，与 model/keys 那批同一套。 */
  const { runWithStepUp } = useStepUp();
  const canManage = can(MANAGE);

  /* 接入凭据页与权益配置页都会带产品 id 点回来（「在产品目录里查看」）。 */
  const productIdFilter = useSearchParams().get("productId") ?? "";

  const [rows, setRows] = useState<ProductRecord[]>([]);
  const [categories, setCategories] = useState<ProductCategoryRecord[]>([]);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [keyword, setKeyword] = useState("");
  const [originFilter, setOriginFilter] = useState<"all" | ProductOrigin>(
    "all",
  );
  const [stateFilter, setStateFilter] = useState<"all" | ProductState>("all");
  const [selectedKeys, setSelectedKeys] = useState<readonly string[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [draft, setDraft] = useState<ProductDraft>(EMPTY_DRAFT);
  const [webhookDraft, setWebhookDraft] = useState<WebhookDraft>(EMPTY_WEBHOOK);
  const [webhookLoad, setWebhookLoad] = useState<LoadState>({ kind: "ready" });
  const [submitting, setSubmitting] = useState(false);

  /* 全部产品的检查单完成态，一次取回（`GET /api/products/checklist-summary`）。
     验证态要显示在**列表**上，逐行去调单产品那条就是 N 次往返。 */
  const [checklistByProduct, setChecklistByProduct] = useState<
    Record<string, ChecklistItem[]>
  >({});
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

  const [checklistProduct, setChecklistProduct] =
    useState<ProductRecord | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItemRecord[]>([]);
  const [checklistLoad, setChecklistLoad] = useState<LoadState>({
    kind: "ready",
  });

  const reload = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const [products, cats, summary] = await Promise.all([
        api.get<ProductRecord[]>("/api/products"),
        api.get<ProductCategoryRecord[]>("/api/products/categories"),
        /* 汇总失败不该让整页读不出来——验证态是附加信息，产品目录本身不依赖它。
           所以这一条单独兜底成空对象，全部行显示「未验证」。 */
        api
          .get<
            Record<string, ChecklistItem[]>
          >("/api/products/checklist-summary")
          .catch(() => ({}) as Record<string, ChecklistItem[]>),
      ]);
      setRows(products);
      setCategories(cats);
      setChecklistByProduct(summary);
      setLoad({ kind: "ready" });
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
  const loadChecklist = useCallback(async (productId: string) => {
    setChecklistLoad({ kind: "loading" });
    try {
      const data = await api.get<ChecklistItemRecord[]>(
        `/api/products/${encodeURIComponent(productId)}/checklist`,
      );
      setChecklist(data);
      setChecklistLoad({ kind: "ready" });
    } catch (error) {
      setChecklistLoad({
        kind: "error",
        message:
          error instanceof OperaApiError ? error.message : "读取检查单失败",
      });
    }
  }, []);

  function openChecklist(product: ProductRecord) {
    setChecklistProduct(product);
    void loadChecklist(product.id);
  }

  function closeChecklist() {
    setChecklistProduct(null);
    setChecklist([]);
  }

  async function toggleChecklistItem(itemCode: string, isSatisfied: boolean) {
    if (!checklistProduct) return;
    setSubmitting(true);
    try {
      await api.patch(
        `/api/products/${checklistProduct.id}/checklist/${itemCode}`,
        { isSatisfied },
      );
      await loadChecklist(checklistProduct.id);
    } catch (error) {
      toast({ tone: "danger", title: "更新失败", ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

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

  const pager = useListPagination(filtered, 20);

  function openCreate() {
    setDraft(EMPTY_DRAFT);
    setDialog({ kind: "create" });
  }

  function openEdit(row: ProductRecord) {
    setDraft(draftFromRecord(row));
    setDialog({ kind: "edit", row });
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

  /**
   * webhook 登记。**先读回现状再开弹窗**——这是 upsert，不读就打开等于让运营者对着
   * 三个空框猜之前配过什么，一保存就把原值抹了。
   */
  async function openWebhook(row: ProductRecord) {
    setDialog({ kind: "webhook", row });
    setWebhookDraft(EMPTY_WEBHOOK);
    setWebhookLoad({ kind: "loading" });
    try {
      const current = await api.get<{
        homeUrl: string | null;
        webhookUrl: string | null;
        webhookSecretRef: string | null;
      } | null>(`/api/product/catalog/${encodeURIComponent(row.id)}/webhook`);
      setWebhookDraft({
        homeUrl: current?.homeUrl ?? "",
        webhookUrl: current?.webhookUrl ?? "",
        webhookSecretRef: current?.webhookSecretRef ?? "",
      });
      setWebhookLoad({ kind: "ready" });
    } catch (error) {
      /* 读不到就不让写：读失败时保存会把「读不出来的那份」覆盖成空。 */
      setWebhookLoad({
        kind: "error",
        message: describeError(error).description ?? "读取失败",
      });
    }
  }

  async function submitWebhook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (dialog?.kind !== "webhook") return;
    setSubmitting(true);
    try {
      await api.put(
        `/api/product/catalog/${encodeURIComponent(dialog.row.id)}/webhook`,
        {
          homeUrl: webhookDraft.homeUrl.trim() || null,
          webhookUrl: webhookDraft.webhookUrl.trim() || null,
          webhookSecretRef: webhookDraft.webhookSecretRef.trim() || null,
        },
      );
      toast({
        tone: "success",
        title: `${dialog.row.productName} 的 webhook 已登记`,
      });
      setDialog(null);
    } catch (error) {
      toast({ tone: "danger", title: "登记失败", ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;

    const payload = {
      productCode: draft.productCode.trim(),
      productType: draft.productType.trim(),
      categoryId: draft.categoryId ? Number(draft.categoryId) : null,
      productName: draft.productName.trim(),
      productNick: draft.productNick.trim() || null,
      description: draft.description.trim() || null,
      origin: draft.origin,
      originProvider:
        draft.origin === "third_party" ? draft.originProvider.trim() : null,
      standaloneSubscribable: draft.standaloneSubscribable,
      isCustomerVisible: draft.isCustomerVisible,
      isWorkforceVisible: draft.isWorkforceVisible,
    };

    setSubmitting(true);
    try {
      if (dialog.kind === "create") {
        /* 入口一（设计 §6.5）：主按钮 = **建草稿并进入流程**，不是"建完就完了"。
           §6.2 的顺序是草稿先行——验证的大部分项要求产品已经存在（OIDC 客户端挂在
           产品上，两个域的授权都按产品码配），所以登记完直接把人送到流程页，那里
           才有"接下来配什么、交什么给对方"。 */
        const created = await api.post<{ id: string }>(
          "/api/products",
          payload,
        );
        toast({
          tone: "success",
          title: `${draft.productCode} 已登记（草稿）`,
          description: "接下来配置接入凭据与授权，然后回到上线流程页验证。",
        });
        setDialog(null);
        router.push(
          `/product/launch?productId=${encodeURIComponent(created.id)}`,
        );
        return;
      }
      {
        await api.put(`/api/products/${dialog.row.id}`, payload);
        toast({ tone: "success", title: `${draft.productCode} 已保存` });
      }
      setDialog(null);
      await reload();
    } catch (error) {
      toast({ tone: "danger", title: "保存失败", ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  const draftValid =
    draft.productCode.trim() !== "" &&
    draft.productType.trim() !== "" &&
    draft.productName.trim() !== "" &&
    (draft.origin !== "third_party" || draft.originProvider.trim() !== "");
  const editing = dialog?.kind === "edit";

  const pagination = (
    <Pagination
      className="w-full"
      page={pager.page}
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
            action={
              canManage ? (
                <Button onClick={openCreate} disabled={submitting}>
                  <Icon name="plus" size="sm" aria-hidden="true" />
                  接入产品
                </Button>
              ) : null
            }
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
          >
            <InputGroup className="grow basis-media-3xl max-w-panel-sm">
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
            columns={[
              {
                id: "name",
                header: tShared("columns.product"),
                cell: (r: ProductRecord) => (
                  <TableTitleCell
                    icon="package"
                    title={r.productName}
                    description={r.productCode}
                    {...(canManage ? { onTitleClick: () => openEdit(r) } : {})}
                  />
                ),
              },
              {
                id: "origin",
                header: tShared("columns.source"),
                width: "md",
                cell: (r: ProductRecord) => (
                  <span className="text-body-sm">
                    {ORIGIN_LABELS[r.origin]}
                    {r.origin === "third_party" && r.originProvider
                      ? ` · ${r.originProvider}`
                      : ""}
                  </span>
                ),
              },
              {
                id: "visibility",
                header: "可见性",
                width: "sm",
                cell: (r: ProductRecord) => (
                  <span className="text-body-sm text-muted-foreground">
                    {r.isCustomerVisible ? "客户端" : ""}
                    {r.isCustomerVisible && r.isWorkforceVisible ? " / " : ""}
                    {r.isWorkforceVisible ? "运营端" : ""}
                    {!r.isCustomerVisible && !r.isWorkforceVisible ? "—" : ""}
                  </span>
                ),
              },
              {
                id: "type",
                header: tShared("columns.kind"),
                align: "center",
                width: "xs",
                cell: (r: ProductRecord) => (
                  // 受管枚举外的历史/非法 product_type 标「非合规」,便于 owner 上线后订正。
                  <span className="inline-flex items-center justify-center gap-1.5">
                    <span className="text-code-sm">{r.productType}</span>
                    {isValidProductType(r.productType) ? null : (
                      <StatusBadge tone="warning" dot>
                        {tShared("common.nonCompliant")}
                      </StatusBadge>
                    )}
                  </span>
                ),
              },
              {
                /* 生命周期状态与验证态**分成两列**，不合并（设计文件 §6.4）：
                   合成一个字段之后，上线半年的产品一次复验失败就得被改回草稿——
                   把监测信号变成破坏性动作。 */
                id: "state",
                header: "生命周期",
                align: "center",
                width: "xs",
                cell: (r: ProductRecord) => (
                  <StatusBadge tone={PRODUCT_STATE_META[r.state].tone} dot>
                    {PRODUCT_STATE_META[r.state].label}
                  </StatusBadge>
                ),
              },
              {
                id: "verification",
                header: "验证态",
                align: "center",
                width: "xs",
                cell: (r: ProductRecord) => {
                  const v = verificationOf(checklistByProduct[r.id] ?? []);
                  return (
                    <StatusBadge tone={VERIFICATION_META[v].tone} dot>
                      {VERIFICATION_META[v].label}
                    </StatusBadge>
                  );
                },
              },
            ]}
            rows={pager.pageRows}
            rowKey={(r: ProductRecord) => r.id}
            selectedKeys={selectedKeys}
            onSelectionChange={setSelectedKeys}
            indexStart={pager.indexStart}
            {...(canManage
              ? {
                  rowActions: (r: ProductRecord) => (
                    <ActionMenu
                      label={`${r.productName} 操作`}
                      disabled={submitting}
                      items={[
                        {
                          id: "edit",
                          label: tShared("common.edit"),
                          icon: "edit",
                          onSelect: () => openEdit(r),
                        },
                        {
                          /* 上线检查第五项（Webhook 登记）此前失败时给的 remedy 是
                             「去库里补一行」——一个检查项失败后让人手改数据库，闭环
                             是断的。入口补在这里：webhook 是产品级接入配置，和目录
                             属性不是一回事，所以独立一项而不是塞进「编辑」。 */
                          id: "webhook",
                          label: "Webhook 登记",
                          icon: "plug" as const,
                          onSelect: () => void openWebhook(r),
                        },
                        {
                          /* 2026-08-14 拆出独立页（B4a-1）。这里从"开抽屉"改成
                             "带 productId 跳过去"：地址可分享、可后退，且到了那边
                             还能把过滤放宽看全部产品的凭据。 */
                          id: "oidc-clients",
                          label: "接入凭据",
                          icon: "fingerprint" as const,
                          onSelect: () =>
                            router.push(
                              `/product/clients?productId=${encodeURIComponent(r.id)}`,
                            ),
                        },
                        {
                          /* 入口二 / 入口三（设计 §6.5）：草稿行是「继续接入」，
                             正式行是「重新验证」。同一个页面，措辞跟着状态走——
                             第三个入口尤其重要，它让验证不会变成"接入时通过"这样
                             一个永不更新的过期结论。已退役的不给（终态，没有可验的）。 */
                          id: "launch-flow",
                          label:
                            r.state === "draft"
                              ? "继续接入"
                              : r.state === "deprecated"
                                ? "查看接入记录"
                                : "重新验证",
                          icon: "rocket" as const,
                          onSelect: () =>
                            router.push(
                              `/product/launch?productId=${encodeURIComponent(r.id)}`,
                            ),
                        },
                        {
                          id: "checklist",
                          label: "接入检查单",
                          icon: "list-checks" as const,
                          onSelect: () => openChecklist(r),
                        },
                        {
                          id: "admin-atlas-grants",
                          label: "Atlas 模型授权（admin）",
                          icon: "external-link" as const,
                          separatorBefore: true,
                          onSelect: () =>
                            window.open(
                              buildAdminAtlasGrantsUrl(),
                              "_blank",
                              "noopener,noreferrer",
                            ),
                        },
                        {
                          id: "admin-runos-bundles",
                          label: "Runos 能力授权（规划中）",
                          icon: "external-link" as const,
                          disabled: true,
                          onSelect: () =>
                            toast({
                              tone: "info",
                              title: "规划中",
                              description:
                                "Runos 的商业层（commerce/bundles）还没建，admin 侧没有对应页面可跳。",
                            }),
                        },
                        /* 生命周期动作由 `PRODUCT_ACTIONS` 那张表生成，破坏性
                           与否也由表决定——所以这里按判别联合分流，而不是按 id
                           硬分支。表里加一个 danger 动作却不写后果，编译不过。

                           `target` 在这里拼而不在表里：表描述「这个动作是什么」，
                           不描述「作用在谁身上」。 */
                        ...actionsFor(r.state).map((a) =>
                          a.danger
                            ? {
                                id: a.id,
                                label: a.label,
                                icon: a.icon,
                                danger: true as const,
                                separatorBefore:
                                  a.id === "launch" || a.id === "suspend",
                                confirm: withLabels({
                                  verb: a.destructive.verb,
                                  target: `产品 ${r.productName}`,
                                  consequence: a.destructive.consequence,
                                  onConfirm: () => applyLifecycle(r, a),
                                }),
                              }
                            : {
                                id: a.id,
                                label: a.label,
                                icon: a.icon,
                                separatorBefore:
                                  a.id === "launch" || a.id === "suspend",
                                onSelect: () => runLifecycle(r, a),
                              },
                        ),
                        {
                          /* 删除（两步）。红色、与退役之间加分隔线：退役是可见的终态
                             「已退役」，删除是从目录彻底移除（软删）——两者不该挨在
                             一起像同一档。走 `confirmExempt` 而不是 DS 的一次性
                             `confirm`：删除的确认由专用对话框接管（先拉影响面预览再
                             落锤，比一次性确认更重），confirmExempt 的必填理由把这层
                             判断显式写下来（见 ActionMenuItemExempt）。 */
                          id: "delete",
                          label: "删除",
                          icon: "trash" as const,
                          danger: true as const,
                          separatorBefore: true,
                          confirmExempt:
                            "两步删除自带确认：先拉影响面预览，再在专用对话框里落锤",
                          onSelect: () => void openDeletion(r),
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

      <DialogForm
        open={dialog?.kind === "create" || editing}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title={editing ? "编辑产品" : "登记产品"}
        description={
          editing
            ? undefined
            : "新产品默认落草稿状态；确认信息无误后从操作菜单切到「启用」。"
        }
        submitLabel={editing ? tShared("common.save") : "登记"}
        submitting={submitting}
        submitDisabled={!draftValid}
        onSubmit={submit}
      >
        {/* 三档（DS `FieldTier`）：身份 = 这是哪个产品，Code 登记后不可改；常规 = 目录
            与归属；高级 = 三个开关，都有缺省值，不动也能登记。 */}
        <FieldTier
          tier="identity"
          hint="Product Code 全局唯一且登记后不可改——这一栏是唯一需要在提交前想清楚的。"
        >
          <FieldGroup>
            <div className="grid grid-cols-2 gap-md">
              <Field>
                <FieldLabel htmlFor="product-code">Product Code</FieldLabel>
                <Input
                  id="product-code"
                  value={draft.productCode}
                  onChange={(e) =>
                    setDraft({ ...draft, productCode: e.target.value })
                  }
                  placeholder="karda"
                  disabled={editing}
                  className="font-mono"
                />
                <FieldDescription>全局唯一，登记后不可改。</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="product-type">
                  {tShared("columns.kind")}
                </FieldLabel>
                <NativeSelect
                  id="product-type"
                  value={draft.productType}
                  onChange={(e) =>
                    setDraft({ ...draft, productType: e.target.value })
                  }
                >
                  <option value="" disabled>
                    {tShared("common.pleaseSelect")}
                  </option>
                  {PRODUCT_TYPE_DEFS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {locale.startsWith("en") ? d.labelEn : d.labelZh}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-md">
              <Field>
                <FieldLabel htmlFor="product-name">名称</FieldLabel>
                <Input
                  id="product-name"
                  value={draft.productName}
                  onChange={(e) =>
                    setDraft({ ...draft, productName: e.target.value })
                  }
                  placeholder="Karda"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="product-nick">副名 / 译名</FieldLabel>
                <Input
                  id="product-nick"
                  value={draft.productNick}
                  onChange={(e) =>
                    setDraft({ ...draft, productNick: e.target.value })
                  }
                  placeholder="卡尔达"
                />
              </Field>
            </div>
          </FieldGroup>
        </FieldTier>

        <FieldTier tier="details" hint="目录归属与来源，登记后都还能改。">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="product-category">品类</FieldLabel>
              <NativeSelect
                id="product-category"
                value={draft.categoryId}
                onChange={(e) =>
                  setDraft({ ...draft, categoryId: e.target.value })
                }
              >
                <option value="">{tShared("common.uncategorized")}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field>
              <FieldLabel htmlFor="product-description">简介</FieldLabel>
              <Textarea
                id="product-description"
                value={draft.description}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
                rows={2}
              />
            </Field>

            <div className="grid grid-cols-2 gap-md">
              <Field>
                <FieldLabel htmlFor="product-origin">
                  {tShared("columns.source")}
                </FieldLabel>
                <NativeSelect
                  id="product-origin"
                  value={draft.origin}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      origin: e.target.value as ProductOrigin,
                    })
                  }
                >
                  <option value="self">平台自建</option>
                  <option value="third_party">第三方接入</option>
                  <option value="other">其他</option>
                </NativeSelect>
              </Field>
              {draft.origin === "third_party" ? (
                <Field>
                  <FieldLabel htmlFor="product-origin-provider">
                    来源方
                  </FieldLabel>
                  <Input
                    id="product-origin-provider"
                    value={draft.originProvider}
                    onChange={(e) =>
                      setDraft({ ...draft, originProvider: e.target.value })
                    }
                    placeholder="公司 / 团队名"
                  />
                </Field>
              ) : null}
            </div>
          </FieldGroup>
        </FieldTier>

        <FieldTier
          tier="advanced"
          title="可见性与订阅"
          hint="三项都有缺省值；新产品先落草稿态，可见性等启用前再定。"
        >
          <FieldGroup>
            <div className="flex flex-col gap-sm rounded-md border border-border p-sm">
              <div className="flex items-center justify-between">
                <FieldLabel htmlFor="product-standalone">可独立订阅</FieldLabel>
                <Switch
                  id="product-standalone"
                  checked={draft.standaloneSubscribable}
                  onCheckedChange={(v) =>
                    setDraft({ ...draft, standaloneSubscribable: v })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <FieldLabel htmlFor="product-visible-customer">
                  客户端可见
                </FieldLabel>
                <Switch
                  id="product-visible-customer"
                  checked={draft.isCustomerVisible}
                  onCheckedChange={(v) =>
                    setDraft({ ...draft, isCustomerVisible: v })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <FieldLabel htmlFor="product-visible-workforce">
                  运营端可见
                </FieldLabel>
                <Switch
                  id="product-visible-workforce"
                  checked={draft.isWorkforceVisible}
                  onCheckedChange={(v) =>
                    setDraft({ ...draft, isWorkforceVisible: v })
                  }
                />
              </div>
            </div>
          </FieldGroup>
        </FieldTier>
      </DialogForm>

      {/* Webhook 登记。**两档而不是三档**：三项都是接入必需，凑一个高级档只是把
          自己定的规则抄一遍（同 E3 里注册模型那个的判断）。 */}
      <DialogForm
        open={dialog?.kind === "webhook"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title={
          dialog?.kind === "webhook"
            ? `${dialog.row.productName} · Webhook 登记`
            : "Webhook 登记"
        }
        description="平台向这个产品推送订阅变更与额度预警的地址。本页只登记，不发测试投递——那是对对方生产端点的真实请求，投递结果去运行监控看。"
        submitLabel={tShared("common.save")}
        submitting={submitting}
        submitDisabled={webhookLoad.kind !== "ready"}
        onSubmit={submitWebhook}
      >
        {webhookLoad.kind === "loading" ? (
          <EmptyState
            title={tShared("common.loading")}
            description="正在读取现有登记。"
          />
        ) : webhookLoad.kind === "error" ? (
          /* 读失败就不给填：这是 upsert，对着空框保存会把读不出来的那份覆盖成空。 */
          <EmptyState
            title={tShared("common.loadFailed")}
            description={`${webhookLoad.message}。读不到不等于没配，先解决读取失败再改，否则保存会覆盖掉现有登记。`}
          />
        ) : (
          <>
            <FieldTier
              tier="identity"
              hint="回调地址与密钥引用都配齐，上线检查第五项才算通过——只配一半意味着对方收得到但验不了签。"
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="wh-url">回调地址</FieldLabel>
                  <Input
                    id="wh-url"
                    value={webhookDraft.webhookUrl}
                    onChange={(e) =>
                      setWebhookDraft({
                        ...webhookDraft,
                        webhookUrl: e.target.value,
                      })
                    }
                    placeholder="https://app.example.com/webhooks/vxture"
                    className="font-mono text-code-sm"
                  />
                  <FieldDescription>
                    必须是 http / https 绝对地址。留空即撤销登记。
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="wh-secret">签名密钥引用</FieldLabel>
                  <Input
                    id="wh-secret"
                    value={webhookDraft.webhookSecretRef}
                    onChange={(e) =>
                      setWebhookDraft({
                        ...webhookDraft,
                        webhookSecretRef: e.target.value,
                      })
                    }
                    placeholder="secret://product/acme/webhook"
                    className="font-mono text-code-sm"
                  />
                  <FieldDescription>
                    **是引用不是密钥本体**——密钥不存这张表，这里填的是取密钥的路径，
                    平台用它自签 HMAC，对方据此验签。
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </FieldTier>

            <FieldTier tier="details" hint="展示用，不参与投递。">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="wh-home">产品主页</FieldLabel>
                  <Input
                    id="wh-home"
                    value={webhookDraft.homeUrl}
                    onChange={(e) =>
                      setWebhookDraft({
                        ...webhookDraft,
                        homeUrl: e.target.value,
                      })
                    }
                    placeholder="https://app.example.com"
                    className="font-mono text-code-sm"
                  />
                </Field>
              </FieldGroup>
            </FieldTier>
          </>
        )}
      </DialogForm>

      {/* ── OIDC 客户端抽屉（挂在某个产品下）───────────────────────────────── */}
      <Drawer
        open={checklistProduct !== null}
        onClose={closeChecklist}
        width="md"
        title={
          checklistProduct
            ? `接入检查单 · ${checklistProduct.productName}`
            : undefined
        }
        description={checklistProduct?.productCode}
      >
        {checklistLoad.kind === "loading" ? (
          <EmptyState
            title={tShared("common.loading")}
            description="正在读取检查单。"
          />
        ) : checklistLoad.kind === "error" ? (
          <EmptyState
            title={tShared("common.loadFailed")}
            description={checklistLoad.message}
            action={
              <Button
                variant="secondary"
                onClick={() =>
                  checklistProduct && void loadChecklist(checklistProduct.id)
                }
              >
                {tShared("common.retry")}
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-lg">
            <Banner
              tone="info"
              title="只覆盖技术接入六步"
              description="对应 product_200_integration.md §7：目录/C1/C3/C2/数据面/验收。商业检查项（认证策略/定价）归 admin 消费，这里不读不写。C2/C3 是否真的接好，opera 从外面观测不到——勾选是操作员的判断，不是自动检测。"
            />
            <div className="flex flex-col gap-sm">
              {checklist.map((item) => (
                <div
                  key={item.itemCode}
                  className="flex items-start gap-sm rounded-md border border-border p-sm"
                >
                  <Checkbox
                    checked={item.isSatisfied}
                    disabled={submitting || !canManage}
                    onCheckedChange={(checked) =>
                      void toggleChecklistItem(item.itemCode, checked === true)
                    }
                  />
                  <div className="flex flex-1 flex-col gap-2xs">
                    <div className="flex items-center gap-sm">
                      <span className="text-body-md font-medium">
                        {item.itemName}
                      </span>
                      {item.isRequired ? (
                        <Badge variant="outline">必需</Badge>
                      ) : null}
                    </div>
                    {item.description ? (
                      <span className="text-body-sm text-muted-foreground">
                        {item.description}
                      </span>
                    ) : null}
                    {item.checkedAt ? (
                      <span className="text-body-sm text-muted-foreground">
                        {new Date(item.checkedAt).toLocaleString(locale)} 确认
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Drawer>

      {/* 二次确认。退役不可逆、恢复要提醒重新验证——两者都不该点一下就发生。 */}
      <DialogForm
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
