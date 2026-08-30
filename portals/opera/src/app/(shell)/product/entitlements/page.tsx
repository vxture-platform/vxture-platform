"use client";

/* 权益配置 — **产品视角的权益管理面**，两级：清单 → 详情。
 *
 * 2026-08-14 建为只读汇总；2026-08-15 改成**唯一的权益写入方**（owner 定）。
 *
 * ── 为什么写入归这里，而不是各自的域页 ───────────────────────────────────────
 *
 * 第一直觉是「写入归域」——发模型路由授权要看这条 endpoint 可不可服务、primary /
 * fallback 是什么；发能力授权要看 riskLevel 上限、依赖闭包会派生什么。这些上下文只在
 * 域里有。
 *
 * 但那个理由站不住：**上下文可以带过去**（授权弹窗里就带着 resolution、分类、已持有）。
 * 反过来的代价却补不回来——
 *
 * **授权的主体是产品（ADR-010）。以客体为中心写授权，等于从客体去挂主体**，正是 runos
 * 收敛 `subjectType` 时要消灭的思路。一个产品的授权散在两个域页里配，运营者永远拼不出
 * 「这个产品到底能干什么」，而那是唯一重要的问题。
 *
 * 还有一条硬证据：**权益必须一起看**。产品上线检查里模型路由授权与能力授权是并列两项，
 * 产品能不能跑取决于两者的**合集**。分开配就意味着分开想。
 *
 * 因此：`/model/grants` 与 `/capability/grants` 保留**反向视图**（这条 endpoint 被谁
 * 持有 / 这个能力谁在用——下线前必须看的方向），写入入口移到这里。
 *
 * ── 两级 ─────────────────────────────────────────────────────────────────────
 *
 * 清单（无 `?productCode=`）：一个产品一张横向 card。能力按**分类分布**显示而不是只给
 * 一个数——「12 条」说明不了这个产品是干什么的，`crm 5 · productivity 4` 才说得出来。
 *
 * 详情（带 `?productCode=`）：按维度分 tab，各自带写入入口。维度目前两个（模型路由 /
 * 能力），将来加第三个是加一个 tab，不是再劈一页。
 *
 * ── 数据形状 ─────────────────────────────────────────────────────────────────
 *
 * Atlas 有全量 `GET /capability/product-grants`，所以模型路由数是一次调用拿到的。
 * runos 没有对等的口子，只能按主体逐个查——已开 `vxture-runos#98`，在它到位之前由
 * opera-bff 的 `grants/summary` 吸收掉（那是个形状固定的接缝，上游补齐后只换内脏）。 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ActionMenu,
  Badge,
  Banner,
  Button,
  Checkbox,
  DataTable,
  DialogForm,
  EmptyState,
  Field,
  FieldDescription,
  FieldLabel,
  FieldTier,
  Icon,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  NativeSelect,
  Section,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ViewHeader,
  ViewLayout,
  useToast,
  type StatusBadgeTone,
} from "@vxture/design-system";
import { useOperatorSession } from "@/features/session/SessionProvider";
import { isEnabled } from "@/features/atlas/state";
import { api, OperaApiError } from "@/lib/api";
import { useConfirmLabels } from "@/lib/destructive";

interface ProductLite {
  id: string;
  productCode: string;
  productName: string;
  state: string;
}

/** Atlas `product_endpoint_grants`：**工程关系**（产品能不能走这条路由）。 */
interface RouteGrant {
  id: string;
  productCode: string;
  endpointCode: string;
  applicationId: string | null;
  applicationType: string | null;
  state: string;
  expiresAt: string | null;
}

/** Runos `commerce/grants`：`derived` 是 ADR-005 闭包推导的结果，不是谁手工发的。 */
interface CapabilityGrant {
  grantId: string;
  capabilityId: string;
  grantType: "direct" | "derived";
  anchorCapabilityId: string | null;
  riskScope: string;
  state: string;
  quotaLimit: number | null;
  /** 主体。按产品汇总的读法里它是已知的；全量读（`grants/all`）里靠它归主体。 */
  subjectType?: string;
  subjectRef?: string;
}

/**
 * `GET /api/runos/grants/all`：按能力目录扇出得到的**全量生效**能力授权（2026-08-31）。
 * 只给「未登记产品的授权」用——runos 没有无条件的 dump，按已知产品码查永远查不到
 * 目录里没有的主体。`failed` 是没读到的能力，那些能力下若有孤儿授权这一次看不见。
 */
interface AllCapabilityGrants {
  grants: CapabilityGrant[];
  failed: string[];
  capabilityCount: number;
}

/**
 * 「未登记产品的授权」一行：productCode 在目录里**根本没有**的上游授权。
 * 草稿 / 停用 / 退役都算登记过——只有目录里找不到的码才是孤儿。
 */
type OrphanRow =
  | { key: string; source: "atlas"; productCode: string; grant: RouteGrant }
  | {
      key: string;
      source: "runos";
      productCode: string;
      grant: CapabilityGrant;
    };

/**
 * 能力 tab 里的一行。**逻辑上是一张表**，只是 direct 与它推导出的 derived 有父子关系。
 *
 * 拉平成一个行集而不是嵌套表：同一套 `columns` 渲染两种行，列位置由结构保证，不需要
 * 任何对齐补偿（形态与「运行监控 · 服务状态」一致）。
 */
type CapabilityRow =
  | {
      key: string;
      kind: "direct";
      grant: CapabilityGrant;
      derivedCount: number;
    }
  | { key: string; kind: "derived"; grant: CapabilityGrant };

/** Atlas endpoint。`resolution` 是**读时推导的后果**，与 `state`（意图）分列。 */
interface EndpointLite {
  id: string;
  code: string;
  category: string;
  primaryModelCode: string;
  fallbackModelCode: string | null;
  state: string;
  resolution: string;
}

interface CapabilityLite {
  capabilityId: string;
  title: string;
  displayName?: Record<string, string>;
  category?: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

const GRANT_STATE_TONE: Record<string, StatusBadgeTone> = {
  active: "success",
  revoked: "danger",
  suspended: "warning",
};

/** §5b.3：`quota_limit <= 0` = **不强制执行**，不是「零调用」。 */
function formatQuota(limit: number | null): string {
  if (limit == null) return "未设置";
  return limit <= 0 ? "不限（未强制）" : String(limit);
}

/* 收 `locale` 而不是写死 `"zh-CN"`：日期的字段顺序属于语言——中文
   `2026/8/18`，英文 `8/18/2026`。写死的后果不是「没翻译」，是英文用户会把
   8/18 读成 18 月。 */
function formatTime(iso: string | null, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(locale, { hour12: false });
}

function message(error: unknown, fallback: string): string {
  return error instanceof OperaApiError ? error.message : fallback;
}

export default function ProductEntitlementsPage() {
  return (
    <Suspense fallback={null}>
      <ProductEntitlements />
    </Suspense>
  );
}

function ProductEntitlements() {
  const locale = useLocale();
  const tShared = useTranslations();
  const withLabels = useConfirmLabels();
  const router = useRouter();
  const params = useSearchParams();
  const selectedCode = params.get("productCode") ?? "";

  const [products, setProducts] = useState<ProductLite[]>([]);
  const [routeGrants, setRouteGrants] = useState<RouteGrant[]>([]);
  const [capByProduct, setCapByProduct] = useState<
    Record<string, CapabilityGrant[]>
  >({});
  const [capFailed, setCapFailed] = useState<string[]>([]);
  /** 全量能力授权（只给孤儿报表与目录外产品码的详情兜底）。null = 没读到。 */
  const [allCaps, setAllCaps] = useState<AllCapabilityGrants | null>(null);
  const [allCapsError, setAllCapsError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CapabilityLite[]>([]);
  const [endpoints, setEndpoints] = useState<EndpointLite[]>([]);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [keyword, setKeyword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();
  const { can } = useOperatorSession();
  /* 两个域的写入各有各的能力码——权益配置是**唯一写入方**，所以两个码都要在这里判。
     只有其中一个的人，只该看到对应那半的写入入口。 */
  const canWriteRoutes = can("model:model.manage");
  const canWriteCapabilities = can("capability:runos.manage");

  /** 展开了哪些锚点。缺省全收起：先回答「这个产品被直接授了什么」。 */
  const [expandedAnchors, setExpandedAnchors] = useState<readonly string[]>([]);

  /** 授权路由弹窗。 */
  const [routePicker, setRoutePicker] = useState<{
    picked: string[];
    keyword: string;
  } | null>(null);
  /** 授权能力弹窗。 */
  const [capPicker, setCapPicker] = useState<{
    picked: string[];
    riskScope: string;
    quotaLimit: string;
    keyword: string;
  } | null>(null);

  /* 一次把清单要的三份都取回：产品目录、Atlas 全量路由授权、能力目录（分类要用）。
     能力授权走 BFF 的汇总接缝——那一份依赖产品码，所以要等产品目录先回来。 */
  const reload = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const [prods, routes, caps, eps] = await Promise.all([
        api.get<ProductLite[]>("/api/products"),
        api.get<RouteGrant[]>("/api/atlas/product-grants?includeInactive=true"),
        api
          .get<CapabilityLite[]>("/api/runos/capabilities")
          .catch(() => [] as CapabilityLite[]),
        api
          .get<EndpointLite[]>("/api/atlas/endpoints")
          .catch(() => [] as EndpointLite[]),
      ]);
      setProducts(prods);
      setRouteGrants(routes);
      setCatalog(caps);
      setEndpoints(eps);

      const codes = prods.map((p) => p.productCode).join(",");
      const [summary, all] = await Promise.all([
        api
          .get<{
            byProduct: Record<string, CapabilityGrant[]>;
            failed: string[];
          }>(
            `/api/runos/grants/summary?productCodes=${encodeURIComponent(codes)}`,
          )
          .catch(() => ({
            byProduct: {} as Record<string, CapabilityGrant[]>,
            failed: prods.map((p) => p.productCode),
          })),
        /* 全量读只给「未登记产品的授权」用。读失败不拖垮整页——但要记下来：报表那
           一节必须说「Runos 侧没查到」，不能把没查到写成没有。 */
        api.get<AllCapabilityGrants>("/api/runos/grants/all").then(
          (data) => ({ data, error: null as string | null }),
          (error: unknown) => ({
            data: null,
            error: message(error, "读取失败"),
          }),
        ),
      ]);
      setCapByProduct(summary.byProduct);
      setCapFailed(summary.failed);
      setAllCaps(all.data);
      setAllCapsError(all.error);
      setLoad({ kind: "ready" });
    } catch (error) {
      setLoad({ kind: "error", message: message(error, "读取权益失败") });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * 授权模型路由 —— 一次多条。
   *
   * 逐条串行：Atlas 的唯一索引用 `NULLS NOT DISTINCT`，同一产品重复写同一条路由会
   * 撞唯一键；串行发让失败落在具体那一条上，并发会把错误混成一团。
   *
   * **不带 applicationId / expiresAt**：这两项是「产品下某个应用」「限期授权」这类更
   * 细的场景，属于逐条精调，不该出现在批量入口里——批量给的是「这个产品能走这些路由」
   * 这个最常见的形状。要精调去域页改那一条。
   */
  async function submitRoutePicker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!routePicker || routePicker.picked.length === 0 || !selectedCode)
      return;
    setSubmitting(true);
    const failed: string[] = [];
    try {
      for (const endpointCode of routePicker.picked) {
        try {
          await api.post("/api/atlas/product-grants", {
            productCode: selectedCode,
            endpointCode,
            applicationId: null,
            applicationType: null,
            reason: null,
            expiresAt: null,
          });
        } catch {
          failed.push(endpointCode);
        }
      }
      const ok = routePicker.picked.length - failed.length;
      toast({
        tone: failed.length > 0 ? "warning" : "success",
        title: `${ok} 条路由已授权给 ${selectedCode}`,
        ...(failed.length > 0
          ? { description: `${failed.length} 条失败：${failed.join("、")}` }
          : {}),
      });
      setRoutePicker(null);
      await reload();
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * 授权能力 —— 一次多条。
   *
   * 逐条串行的理由不同于路由：每条 direct 写入都会触发一次闭包重编译（ADR-005），
   * 并发等于让编译器同时改同一主体的派生集。
   */
  async function submitCapPicker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!capPicker || capPicker.picked.length === 0 || !selectedCode) return;
    setSubmitting(true);
    const failed: string[] = [];
    try {
      for (const capabilityId of capPicker.picked) {
        try {
          await api.post("/api/runos/grants", {
            subjectType: "product",
            subjectRef: selectedCode,
            capabilityId,
            riskScope: capPicker.riskScope,
            ...(capPicker.quotaLimit.trim()
              ? { quotaLimit: Number(capPicker.quotaLimit) }
              : {}),
          });
        } catch {
          failed.push(capabilityId);
        }
      }
      const ok = capPicker.picked.length - failed.length;
      toast({
        tone: failed.length > 0 ? "warning" : "success",
        title: `${ok} 个能力已授权给 ${selectedCode}`,
        ...(failed.length > 0
          ? { description: `${failed.length} 个失败：${failed.join("、")}` }
          : {}),
      });
      setCapPicker(null);
      await reload();
    } finally {
      setSubmitting(false);
    }
  }

  /** 停用一条路由授权。Atlas 是软停用（`state="inactive"`），不是删行。 */
  async function deactivateRoute(g: RouteGrant) {
    setSubmitting(true);
    try {
      await api.post(`/api/atlas/product-grants/${g.id}/deactivate`);
      toast({ tone: "success", title: `${g.endpointCode} 已停用` });
      await reload();
    } catch (error) {
      toast({
        tone: "danger",
        title: "停用失败",
        ...(error instanceof OperaApiError && error.message
          ? { description: error.message }
          : {}),
      });
    } finally {
      setSubmitting(false);
    }
  }

  /** 撤销一条能力授权。runos 迁 `revoked` 终态，**不删行**；派生行不级联。 */
  async function revokeCapability(g: CapabilityGrant) {
    setSubmitting(true);
    try {
      await api.delete(`/api/runos/grants/${encodeURIComponent(g.grantId)}`);
      toast({
        tone: "success",
        title: `${g.capabilityId} 的授权已撤销`,
        description:
          "行迁到 revoked 终态保留。不是急停——调用走快照，撤销后最多还会再放行一轮；由它带出来的派生权益也不跟着撤。",
      });
      await reload();
    } catch (error) {
      toast({
        tone: "danger",
        title: "撤销失败",
        ...(error instanceof OperaApiError && error.message
          ? { description: error.message }
          : {}),
      });
    } finally {
      setSubmitting(false);
    }
  }

  /** capabilityId → 分类，清单页的分布要用。 */
  const categoryOf = useMemo(() => {
    const m = new Map(catalog.map((c) => [c.capabilityId, c.category]));
    return (id: string) => m.get(id) ?? tShared("common.uncategorized");
    /* `tShared` 要进依赖：它是这个 memo 返回的闭包里读的。next-intl 的
       translator 按 (命名空间, messages, locale) 记忆化，只在切语言时换身份——
       所以这不会让 memo 每次渲染失效，反而保证了切语言时「未分类」跟着变。
       这里没有 effect 依赖 `categoryOf`，不存在 `useCallback` 那种无限重跑。 */
  }, [catalog, tShared]);

  const routesByProduct = useMemo(() => {
    const m = new Map<string, RouteGrant[]>();
    for (const g of routeGrants) {
      const list = m.get(g.productCode) ?? [];
      list.push(g);
      m.set(g.productCode, list);
    }
    return m;
  }, [routeGrants]);

  /**
   * 未登记产品的授权（`opera/40-product-registry.md` §6，2026-08-31）。
   *
   * 「登记过」= 在 `/api/products` 里——它不按状态过滤，草稿 / 停用 / 退役都在；只
   * 软删的行不在（所有列表都过滤 `deleted_at`，软删本来就是「当它不存在」）。所以
   * 这里的孤儿只有一种：两个上游按 `product_code` 字符串挂着、而目录里**根本没有**
   * 这个码的授权。典型来源是退役闸门立起来之前退役掉的产品，以及绕过 opera 直连
   * 上游写进去的授权。
   *
   * Runos 那半只看 `subjectType === "product"`：别的主体类型不归产品目录管。
   */
  const knownCodes = useMemo(
    () => new Set(products.map((p) => p.productCode)),
    [products],
  );
  const orphanRows = useMemo<OrphanRow[]>(() => {
    const rows: OrphanRow[] = [];
    for (const g of routeGrants) {
      if (!knownCodes.has(g.productCode)) {
        rows.push({
          key: `atlas:${g.id}`,
          source: "atlas",
          productCode: g.productCode,
          grant: g,
        });
      }
    }
    for (const g of allCaps?.grants ?? []) {
      if (g.subjectType !== "product") continue;
      const code = g.subjectRef ?? "";
      if (code === "" || knownCodes.has(code)) continue;
      rows.push({
        key: `runos:${g.grantId}`,
        source: "runos",
        productCode: code,
        grant: g,
      });
    }
    rows.sort(
      (a, b) =>
        a.productCode.localeCompare(b.productCode) ||
        a.source.localeCompare(b.source),
    );
    return rows;
  }, [routeGrants, allCaps, knownCodes]);

  /**
   * direct 是父行，它推导出的 derived 挂在下面。
   *
   * **孤儿 derived 照样出行**（锚点不在这批里——理论上不该发生，因为锚点必然是同一
   * 主体的 direct 授权）：把一条运营者确实持有的授权因为归不了组就从界面上抹掉，
   * 比多出一行难解释得多。
   */
  function capabilityGrantRows(list: CapabilityGrant[]): CapabilityRow[] {
    const direct = list.filter((g) => g.grantType === "direct");
    const derived = list.filter((g) => g.grantType === "derived");
    const byAnchor = new Map<string, CapabilityGrant[]>();
    for (const g of derived) {
      const k = g.anchorCapabilityId ?? "";
      byAnchor.set(k, [...(byAnchor.get(k) ?? []), g]);
    }
    const rows: CapabilityRow[] = [];
    for (const d of direct) {
      const kids = byAnchor.get(d.capabilityId) ?? [];
      byAnchor.delete(d.capabilityId);
      rows.push({
        key: d.grantId,
        kind: "direct",
        grant: d,
        derivedCount: kids.length,
      });
      if (expandedAnchors.includes(d.capabilityId)) {
        for (const k of kids) {
          rows.push({ key: k.grantId, kind: "derived", grant: k });
        }
      }
    }
    /* 归不到任何父行的 derived —— 平铺在末尾，不隐藏。 */
    for (const orphans of byAnchor.values()) {
      for (const o of orphans) {
        rows.push({ key: o.grantId, kind: "derived", grant: o });
      }
    }
    return rows;
  }

  /** 派生行对应的锚点授权行；找不到就是孤儿（锚点已撤或不在本主体）。 */
  function anchorGrantOf(
    g: CapabilityGrant,
    list: CapabilityGrant[],
  ): CapabilityGrant | null {
    if (!g.anchorCapabilityId) return null;
    return (
      list.find(
        (x) =>
          x.grantType === "direct" &&
          x.capabilityId === g.anchorCapabilityId &&
          x.state === "active",
      ) ?? null
    );
  }

  function toggleAnchor(capabilityId: string) {
    setExpandedAnchors((prev) =>
      prev.includes(capabilityId)
        ? prev.filter((x) => x !== capabilityId)
        : [...prev, capabilityId],
    );
  }

  /** 这个产品已持有的路由 / 能力——弹窗里置灰，避免撞唯一键或发空操作。 */
  const heldEndpointCodes = new Set(
    (routesByProduct.get(selectedCode) ?? []).map((g) => g.endpointCode),
  );
  const heldCapabilityIds = new Set(
    (capByProduct[selectedCode] ?? []).map((g) => g.capabilityId),
  );

  /** 已选置顶：勾完再搜就找不到自己勾过什么。 */
  function endpointRows(pk: { picked: string[]; keyword: string }) {
    const kw = pk.keyword.trim().toLowerCase();
    const match = endpoints.filter(
      (e) =>
        kw === "" ||
        e.code.toLowerCase().includes(kw) ||
        e.primaryModelCode.toLowerCase().includes(kw) ||
        (e.fallbackModelCode ?? "").toLowerCase().includes(kw),
    );
    const picked = new Set(pk.picked);
    return [
      ...match.filter((e) => picked.has(e.code)),
      ...match.filter((e) => !picked.has(e.code)),
    ];
  }

  function capabilityRows(pk: { picked: string[]; keyword: string }) {
    const kw = pk.keyword.trim().toLowerCase();
    const match = catalog.filter(
      (c) =>
        kw === "" ||
        c.capabilityId.toLowerCase().includes(kw) ||
        c.title.toLowerCase().includes(kw) ||
        (c.category ?? "").toLowerCase().includes(kw) ||
        Object.values(c.displayName ?? {}).some((v) =>
          v.toLowerCase().includes(kw),
        ),
    );
    const picked = new Set(pk.picked);
    return [
      ...match.filter((c) => picked.has(c.capabilityId)),
      ...match.filter((c) => !picked.has(c.capabilityId)),
    ];
  }

  const product = products.find((p) => p.productCode === selectedCode) ?? null;

  function open(code: string) {
    router.push(
      `/product/entitlements?productCode=${encodeURIComponent(code)}`,
    );
  }

  if (load.kind === "error") {
    return (
      <ViewLayout>
        <ViewHeader icon="ticket" title="权益配置" />
        <EmptyState
          title={tShared("common.loadFailed")}
          description={load.message}
          action={
            <Button variant="secondary" onClick={() => void reload()}>
              {tShared("common.retry")}
            </Button>
          }
        />
      </ViewLayout>
    );
  }

  /* ── 详情：按维度分 tab ──────────────────────────────────────────────── */
  if (selectedCode) {
    const routes = routesByProduct.get(selectedCode) ?? [];
    /* 目录里没有的码（从「未登记产品的授权」点进来）：按产品汇总的那份里没有它，
       改从全量读里按主体捞。两份都是上游 `state="active"` 的行，口径一致。 */
    const caps =
      capByProduct[selectedCode] ??
      (allCaps?.grants ?? []).filter(
        (g) => g.subjectType === "product" && g.subjectRef === selectedCode,
      );
    return (
      <ViewLayout>
        <ViewHeader
          icon="ticket"
          title={`权益配置 · ${product?.productName ?? selectedCode}`}
          description="这个产品被授了什么。两个维度并排——产品能不能跑取决于两者的合集，分开配就意味着分开想。"
          action={
            <Button variant="secondary" asChild>
              <Link href="/product/entitlements">
                <Icon name="arrow-left" size="sm" aria-hidden="true" />
                返回清单
              </Link>
            </Button>
          }
        />

        {load.kind === "ready" && product === null ? (
          <Banner
            tone="warning"
            title={`${selectedCode} 不在产品目录里`}
            description="下面列出的是两个上游按这个产品码挂着的授权——它们的主体在目录里不存在。要么撤掉它们，要么去产品目录把这个产品登记上。"
            action={
              <Button asChild variant="secondary" size="sm">
                <Link href="/product/catalog">去产品目录</Link>
              </Button>
            }
          />
        ) : null}

        <Tabs defaultValue="routes">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="routes">模型路由 · Atlas</TabsTrigger>
            <TabsTrigger value="capabilities">能力 · Runos</TabsTrigger>
          </TabsList>

          <TabsContent value="routes" className="flex flex-col gap-md pt-md">
            <div className="flex items-start justify-between gap-md">
              <p className="text-body-sm text-muted-foreground">
                产品可以走哪些模型路由。这是**工程关系**——不是 admin
                那个按租户逐模型 发放的商业 grant，两者同名但不是一回事。
              </p>
              {canWriteRoutes ? (
                <Button
                  className="shrink-0"
                  onClick={() => setRoutePicker({ picked: [], keyword: "" })}
                >
                  <Icon name="plus" size="sm" aria-hidden="true" />
                  授权路由
                </Button>
              ) : null}
            </div>
            <DataTable
              columns={[
                {
                  id: "endpoint",
                  header: "路由",
                  cell: (g: RouteGrant) => (
                    <Link
                      href={`/model/routes?endpointCode=${encodeURIComponent(g.endpointCode)}`}
                      className="font-mono text-code-sm hover:text-primary-text"
                    >
                      {g.endpointCode}
                    </Link>
                  ),
                },
                {
                  id: "application",
                  header: "应用范围",
                  cell: (g: RouteGrant) =>
                    g.applicationId ? (
                      <span className="font-mono text-code-sm">
                        {g.applicationId}
                      </span>
                    ) : (
                      /* NULL = 产品下全部应用。唯一索引用的是 NULLS NOT DISTINCT，
                         所以「全部」本身是一条互斥的授权，不是缺省值。 */
                      <Badge variant="outline">产品下全部应用</Badge>
                    ),
                },
                {
                  id: "expires",
                  header: "到期",
                  width: "sm",
                  cell: (g: RouteGrant) => formatTime(g.expiresAt, locale),
                },
                {
                  id: "state",
                  header: tShared("columns.state"),
                  align: "center",
                  width: "xs",
                  cell: (g: RouteGrant) => (
                    <StatusBadge
                      tone={isEnabled(g.state) ? "success" : "neutral"}
                      dot
                    >
                      {isEnabled(g.state)
                        ? "生效中"
                        : tShared("status.generic.disabled")}
                    </StatusBadge>
                  ),
                },
              ]}
              rows={routes}
              rowKey={(g: RouteGrant) => g.id}
              indexStart={1}
              {...(canWriteRoutes
                ? {
                    rowActions: (g: RouteGrant) => (
                      <ActionMenu
                        label={`${g.endpointCode} 操作`}
                        disabled={submitting}
                        items={[
                          {
                            id: "deactivate",
                            label: tShared("actions.disable"),
                            icon: "pause" as const,
                            danger: true,
                            disabled: !isEnabled(g.state),
                            /* 单条、可逆：停用只是让这条路由不再放行，授权行与
                               配置都在，随时可以再启用。按 owner 2026-08-25 定的
                               线——单条可逆写明理由豁免，批量一律拦。 */
                            confirmExempt:
                              "停用可随时再启用，授权行与配置原样保留，不构成不可逆操作",
                            onSelect: () => void deactivateRoute(g),
                          },
                          {
                            /* 精调（限定到某个应用、加到期）留在域页——批量入口只给
                               最常见的形状，两处都能改会立刻产生「以哪边为准」。 */
                            id: "detail",
                            label: "去域页精调",
                            icon: "external-link" as const,
                            separatorBefore: true,
                            onSelect: () =>
                              router.push(
                                `/model/grants?productCode=${encodeURIComponent(selectedCode)}`,
                              ),
                          },
                        ]}
                      />
                    ),
                  }
                : {})}
              empty={
                <EmptyState
                  title="没有模型路由授权"
                  description="这个产品调不到任何模型路由。"
                  action={
                    <Button asChild variant="secondary">
                      <Link
                        href={`/model/grants?productCode=${encodeURIComponent(selectedCode)}`}
                      >
                        去发一条
                      </Link>
                    </Button>
                  }
                />
              }
            />
          </TabsContent>

          <TabsContent
            value="capabilities"
            className="flex flex-col gap-md pt-md"
          >
            <div className="flex items-start justify-between gap-md">
              <p className="text-body-sm text-muted-foreground">
                产品持有哪些能力。`derived` 行是 ADR-005
                闭包推导的结果，不是谁手工发 的——要撤只能撤它的锚点。
              </p>
              {canWriteCapabilities ? (
                <Button
                  className="shrink-0"
                  onClick={() =>
                    setCapPicker({
                      picked: [],
                      riskScope: "read",
                      quotaLimit: "",
                      keyword: "",
                    })
                  }
                >
                  <Icon name="plus" size="sm" aria-hidden="true" />
                  授权能力
                </Button>
              ) : null}
            </div>
            <DataTable
              columns={[
                {
                  /* 折叠开关在这一列里，不用 DataTable 的展开列——一张表两种行，
                     折叠是 direct 行自己的事。derived 行这一格留空即成缩进。 */
                  id: "capability",
                  header: "能力",
                  cell: (r: CapabilityRow) => {
                    const meta = catalog.find(
                      (c) => c.capabilityId === r.grant.capabilityId,
                    );
                    const name =
                      meta?.displayName?.["zh-CN"] ||
                      meta?.title ||
                      r.grant.capabilityId;
                    return (
                      <span className="flex items-center gap-xs">
                        {r.kind === "direct" ? (
                          r.derivedCount > 0 ? (
                            <Button
                              variant="ghost"
                              size="md"
                              aria-label={
                                expandedAnchors.includes(r.grant.capabilityId)
                                  ? "收起派生权益"
                                  : "展开派生权益"
                              }
                              onClick={() => toggleAnchor(r.grant.capabilityId)}
                            >
                              <Icon
                                name={
                                  expandedAnchors.includes(r.grant.capabilityId)
                                    ? "chevron-down"
                                    : "chevron-right"
                                }
                                size="sm"
                                aria-hidden="true"
                              />
                            </Button>
                          ) : (
                            /* 没有派生行就不出箭头——一个点了没反应的箭头比没有
                               箭头更让人以为是坏的。留一格保持列对齐。 */
                            <span className="w-control-lg shrink-0" />
                          )
                        ) : (
                          <span className="w-control-xl shrink-0" />
                        )}
                        <span className="flex min-w-0 flex-col gap-2xs">
                          <span
                            className={
                              r.kind === "direct"
                                ? "text-label-md text-foreground"
                                : "text-body-sm text-muted-foreground"
                            }
                          >
                            {name}
                            {r.kind === "direct" && r.derivedCount > 0 ? (
                              <span className="ml-xs text-body-sm text-muted-foreground">
                                带 {r.derivedCount} 条派生
                              </span>
                            ) : null}
                          </span>
                          <span className="font-mono text-code-sm text-muted-foreground">
                            {r.grant.capabilityId}
                          </span>
                        </span>
                      </span>
                    );
                  },
                },
                {
                  id: "type",
                  header: tShared("columns.source"),
                  align: "center",
                  width: "xs",
                  cell: (r: CapabilityRow) => (
                    <Badge
                      variant={r.kind === "direct" ? "secondary" : "outline"}
                    >
                      {r.kind === "direct" ? "直接" : "推导"}
                    </Badge>
                  ),
                },
                {
                  id: "risk",
                  header: "风险域",
                  align: "center",
                  width: "xs",
                  cell: (r: CapabilityRow) => r.grant.riskScope,
                },
                {
                  id: "quota",
                  header: "配额",
                  align: "right",
                  width: "sm",
                  cell: (r: CapabilityRow) => formatQuota(r.grant.quotaLimit),
                },
                {
                  id: "state",
                  header: tShared("columns.state"),
                  align: "center",
                  width: "xs",
                  cell: (r: CapabilityRow) => (
                    <StatusBadge
                      tone={GRANT_STATE_TONE[r.grant.state] ?? "neutral"}
                      dot
                    >
                      {r.grant.state}
                    </StatusBadge>
                  ),
                },
              ]}
              rows={capabilityGrantRows(caps)}
              rowKey={(r: CapabilityRow) => r.key}
              {...(canWriteCapabilities
                ? {
                    rowActions: (r: CapabilityRow) =>
                      /* **派生行给的是「撤销它的锚点」而不是禁用的撤销**：它本来就
                         撤不掉（runos 刻意不级联），但运营者真正想做的事是有出口的
                         ——撤掉锚点，闭包重编译时这一条自然消失。给一个灰掉的按钮
                         等于把人堵在那儿。 */
                      r.kind === "direct" ? (
                        <ActionMenu
                          label={`${r.grant.capabilityId} 操作`}
                          disabled={submitting}
                          items={[
                            {
                              id: "revoke",
                              label:
                                r.derivedCount > 0
                                  ? `撤销授权（连带 ${r.derivedCount} 条派生失效）`
                                  : "撤销授权",
                              icon: "prohibit" as const,
                              danger: true,
                              disabled: r.grant.state !== "active",
                              confirm: withLabels({
                                verb: "撤销",
                                target: `${r.grant.capabilityId} 的授权`,
                                /* 派生条数进后果句：撤一条锚点会连带失效 N 条，
                                   那是这一步真正的爆炸半径，不能只说「撤销授权」。 */
                                consequence:
                                  r.derivedCount > 0
                                    ? `行迁到 revoked 终态、不删除。由它带出来的 ${r.derivedCount} 条派生权益会在下一次闭包重编译时消失——runos 刻意不级联，所以那几条不会立刻不见。**不是急停**：调用走快照，撤销后最多还会再放行一轮。`
                                    : "行迁到 revoked 终态、不删除——「谁曾经持有、什么时候被收回」要留得住。**不是急停**：调用走快照，撤销后最多还会再放行一轮。",
                                onConfirm: () => revokeCapability(r.grant),
                              }),
                            },
                          ]}
                        />
                      ) : (
                        <ActionMenu
                          label={`${r.grant.capabilityId} 操作`}
                          disabled={submitting}
                          items={[
                            {
                              id: "revoke-anchor",
                              label: r.grant.anchorCapabilityId
                                ? "撤销它的锚点"
                                : "锚点已不在本产品",
                              icon: "prohibit" as const,
                              danger: true,
                              disabled: !anchorGrantOf(r.grant, caps),
                              confirm: withLabels({
                                verb: "撤销",
                                /* 动的**不是**这一行，是它的锚点——target 必须说出
                                   真正被作用的那个对象，否则确认框在骗人。 */
                                target: `锚点 ${r.grant.anchorCapabilityId ?? ""}`,
                                consequence: `派生行不能单独撤销。撤掉锚点之后，这一条（${r.grant.capabilityId}）会在下一次闭包重编译时自然消失——不是立刻。同一个锚点带出来的其它派生行也会一起重算。`,
                                onConfirm: () => {
                                  const a = anchorGrantOf(r.grant, caps);
                                  if (!a) return;
                                  return revokeCapability(a);
                                },
                              }),
                            },
                          ]}
                        />
                      ),
                  }
                : {})}
              empty={
                <EmptyState
                  title="没有能力授权"
                  description="这个产品调不到任何能力。"
                  action={
                    <Button asChild variant="secondary">
                      <Link
                        href={`/capability/grants?productCode=${encodeURIComponent(selectedCode)}`}
                      >
                        去发一条
                      </Link>
                    </Button>
                  }
                />
              }
            />
          </TabsContent>
        </Tabs>

        {/* ── 授权路由：从 endpoint 目录多选，带 resolution ────────────── */}
        <DialogForm
          open={routePicker !== null}
          onOpenChange={(open) => {
            if (!open) setRoutePicker(null);
          }}
          size="lg"
          title={`授权模型路由 · ${selectedCode}`}
          description="选中的路由将对这个产品下的全部应用生效。要限定到某个应用或加到期时间，去「模型管理 · 路由授权」逐条改。"
          submitLabel={
            routePicker ? `授权 ${routePicker.picked.length} 条` : "授权"
          }
          submitting={submitting}
          submitDisabled={!routePicker || routePicker.picked.length === 0}
          onSubmit={submitRoutePicker}
        >
          {routePicker ? (
            <FieldTier
              tier="identity"
              title="选路由"
              hint={`共 ${endpoints.length} 条，已选 ${routePicker.picked.length} 条。`}
            >
              <InputGroup>
                <InputGroupAddon>
                  <Icon name="search" size="sm" aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  placeholder="搜索路由码 / 模型…"
                  aria-label="搜索路由"
                  value={routePicker.keyword}
                  onChange={(e) =>
                    setRoutePicker({ ...routePicker, keyword: e.target.value })
                  }
                />
              </InputGroup>
              <div className="flex flex-col gap-2xs rounded-md border border-border p-xs">
                {endpointRows(routePicker).map((ep) => {
                  const on = routePicker.picked.includes(ep.code);
                  const held = heldEndpointCodes.has(ep.code);
                  return (
                    <label
                      key={ep.id}
                      className="flex cursor-pointer items-center gap-sm rounded-sm px-xs py-2xs hover:bg-accent"
                    >
                      <Checkbox
                        checked={on}
                        disabled={held}
                        onCheckedChange={() =>
                          setRoutePicker({
                            ...routePicker,
                            picked: on
                              ? routePicker.picked.filter((x) => x !== ep.code)
                              : [...routePicker.picked, ep.code],
                          })
                        }
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="font-mono text-code-sm text-foreground">
                          {ep.code}
                        </span>
                        <span className="truncate text-body-sm text-muted-foreground">
                          {ep.primaryModelCode}
                          {ep.fallbackModelCode
                            ? ` → ${ep.fallbackModelCode}`
                            : ""}
                        </span>
                      </span>
                      {held ? (
                        <Badge variant="outline" className="ml-auto">
                          已持有
                        </Badge>
                      ) : (
                        /* 把 resolution 带进选择器——授权一条当下无法服务的路由是
                           合法的（意图与后果分列），但发的时候要知道。 */
                        <StatusBadge
                          className="ml-auto"
                          tone={
                            ep.resolution === "serving"
                              ? "success"
                              : ep.resolution === "degraded"
                                ? "warning"
                                : "danger"
                          }
                          dot
                        >
                          {ep.resolution}
                        </StatusBadge>
                      )}
                    </label>
                  );
                })}
              </div>
            </FieldTier>
          ) : null}
        </DialogForm>

        {/* ── 授权能力：从能力目录多选 ─────────────────────────────────── */}
        <DialogForm
          open={capPicker !== null}
          onOpenChange={(open) => {
            if (!open) setCapPicker(null);
          }}
          size="lg"
          title={`授权能力 · ${selectedCode}`}
          description="一次可选多个。runos 不校验 capabilityId 是否存在——手打错一个字符会静默写入一条永远不生效的授权，所以这里只让选。"
          submitLabel={
            capPicker ? `授权 ${capPicker.picked.length} 个` : "授权"
          }
          submitting={submitting}
          submitDisabled={!capPicker || capPicker.picked.length === 0}
          onSubmit={submitCapPicker}
        >
          {capPicker ? (
            <>
              <FieldTier
                tier="identity"
                title="选能力"
                hint={`目录共 ${catalog.length} 个，已选 ${capPicker.picked.length} 个。`}
              >
                <InputGroup>
                  <InputGroupAddon>
                    <Icon name="search" size="sm" aria-hidden="true" />
                  </InputGroupAddon>
                  <InputGroupInput
                    placeholder="搜索能力名 / ID / 分类…"
                    aria-label="搜索能力"
                    value={capPicker.keyword}
                    onChange={(e) =>
                      setCapPicker({ ...capPicker, keyword: e.target.value })
                    }
                  />
                </InputGroup>
                <div className="flex flex-col gap-2xs rounded-md border border-border p-xs">
                  {capabilityRows(capPicker).map((c) => {
                    const on = capPicker.picked.includes(c.capabilityId);
                    const held = heldCapabilityIds.has(c.capabilityId);
                    return (
                      <label
                        key={c.capabilityId}
                        className="flex cursor-pointer items-center gap-sm rounded-sm px-xs py-2xs hover:bg-accent"
                      >
                        <Checkbox
                          checked={on}
                          disabled={held}
                          onCheckedChange={() =>
                            setCapPicker({
                              ...capPicker,
                              picked: on
                                ? capPicker.picked.filter(
                                    (x) => x !== c.capabilityId,
                                  )
                                : [...capPicker.picked, c.capabilityId],
                            })
                          }
                        />
                        <span className="flex min-w-0 flex-col">
                          <span className="text-body-sm text-foreground">
                            {c.displayName?.["zh-CN"] || c.title}
                          </span>
                          <span className="truncate font-mono text-code-sm text-muted-foreground">
                            {c.capabilityId}
                          </span>
                        </span>
                        {held ? (
                          <Badge variant="outline" className="ml-auto">
                            已持有
                          </Badge>
                        ) : c.category ? (
                          <Badge variant="secondary" className="ml-auto">
                            {c.category}
                          </Badge>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              </FieldTier>

              <FieldTier
                tier="details"
                title="这一批的授权配置"
                hint="选中的能力共用同一套。要给某一条不同的配置，单独再发一次。"
              >
                <Field>
                  <FieldLabel htmlFor="ent-risk">Risk Scope</FieldLabel>
                  <NativeSelect
                    id="ent-risk"
                    value={capPicker.riskScope}
                    onChange={(e) =>
                      setCapPicker({ ...capPicker, riskScope: e.target.value })
                    }
                  >
                    <option value="read">read</option>
                    <option value="write">write</option>
                    <option value="critical">critical</option>
                  </NativeSelect>
                  <FieldDescription>
                    这条授权的风险上限：能力上某个操作的 riskLevel
                    高过它，那次调用就 policy_denied。默认 read——不替你默认成
                    write。
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="ent-quota">
                    Quota Limit（可选）
                  </FieldLabel>
                  <Input
                    id="ent-quota"
                    value={capPicker.quotaLimit}
                    onChange={(e) =>
                      setCapPicker({ ...capPicker, quotaLimit: e.target.value })
                    }
                    placeholder="留空 = 不限"
                  />
                  <FieldDescription>
                    累计计数，没有周期重置。发出去之后改不了——runos 对已有
                    direct 授权 的重写是空操作，改配额只能撤销后重发。
                  </FieldDescription>
                </Field>
              </FieldTier>
            </>
          ) : null}
        </DialogForm>

        <Banner
          tone="info"
          title="这里看不到商业权益"
          description="套餐、定价、订阅（客户买了什么）归 admin。本页只有工程侧的两类授权——产品技术上能调什么。一个产品被授了模型路由，不等于任何租户买了它。"
        />
      </ViewLayout>
    );
  }

  /* ── 清单：一个产品一张 card ─────────────────────────────────────────── */
  const kw = keyword.trim().toLowerCase();
  const visible = products.filter(
    (p) =>
      kw === "" ||
      p.productName.toLowerCase().includes(kw) ||
      p.productCode.toLowerCase().includes(kw),
  );

  return (
    <ViewLayout>
      <ViewHeader
        icon="ticket"
        title="权益配置"
        description="每个产品被授了什么——模型路由与能力两个维度。这是权益的唯一管理面：授权的主体是产品（ADR-010），以客体为中心配授权，运营者永远拼不出「这个产品能干什么」。"
      />

      {capFailed.length > 0 ? (
        /* 不静默：「没有授权」与「没查到」在卡片上长得一模一样。 */
        <Banner
          tone="warning"
          title={`${capFailed.length} 个产品的能力授权没读到`}
          description={`${capFailed.join("、")} —— 卡片上它们的能力数显示为 0，但那不代表真的是 0。刷新重试；持续失败说明 runos 侧读不出来。`}
        />
      ) : null}

      <InputGroup className="max-w-panel-sm">
        <InputGroupAddon>
          <Icon name="search" size="sm" aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          placeholder="搜索产品…"
          aria-label="搜索产品"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </InputGroup>

      {load.kind === "loading" ? (
        <EmptyState
          title={tShared("common.loading")}
          description="正在汇总各产品的权益。"
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title="没有匹配的产品"
          description={tShared("common.noMatchKeywordHint")}
        />
      ) : (
        <div className="flex flex-col gap-sm">
          {visible.map((p) => {
            const routes = routesByProduct.get(p.productCode) ?? [];
            const liveRoutes = routes.filter((g) => isEnabled(g.state)).length;
            const caps = capByProduct[p.productCode] ?? [];
            const direct = caps.filter((g) => g.grantType === "direct").length;
            const derived = caps.length - direct;

            /* 分类分布：「12 条」说明不了这个产品是干什么的，
               `crm 5 · productivity 4` 才说得出来。 */
            const byCategory = new Map<string, number>();
            for (const g of caps) {
              const c = categoryOf(g.capabilityId);
              byCategory.set(c, (byCategory.get(c) ?? 0) + 1);
            }
            const top = [...byCategory.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5);

            return (
              <Button
                key={p.id}
                type="button"
                variant="ghost"
                onClick={() => open(p.productCode)}
                /* 这是一张可点的卡片，不是一枚按钮：尺寸与内边距由本行的布局类给，
                   Button 只提供按钮语义与聚焦环，所以 h-auto。 */
                className="flex h-auto flex-col items-start gap-sm rounded-md border border-border p-md text-left hover:border-primary hover:bg-accent"
              >
                <div className="flex items-center gap-sm">
                  <Icon
                    name="package"
                    size="sm"
                    className="text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="text-label-md text-foreground">
                    {p.productName}
                  </span>
                  <span className="font-mono text-code-sm text-muted-foreground">
                    {p.productCode}
                  </span>
                  <Icon
                    name="chevron-right"
                    size="sm"
                    className="ml-auto text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-lg">
                  <span className="text-body-sm text-muted-foreground">
                    模型路由{" "}
                    <span className="text-foreground">{liveRoutes} 生效</span>
                    {routes.length > liveRoutes
                      ? ` · ${routes.length - liveRoutes} 已停用`
                      : ""}
                  </span>
                  <span className="text-body-sm text-muted-foreground">
                    能力 <span className="text-foreground">{direct} 直接</span>
                    {derived > 0 ? ` · ${derived} 推导` : ""}
                  </span>
                </div>

                {top.length > 0 ? (
                  <div className="flex flex-wrap gap-2xs">
                    {top.map(([cat, n]) => (
                      <Badge key={cat} variant="secondary">
                        {cat} {n}
                      </Badge>
                    ))}
                    {byCategory.size > top.length ? (
                      <Badge variant="outline">
                        +{byCategory.size - top.length} 类
                      </Badge>
                    ) : null}
                  </div>
                ) : (
                  <span className="text-body-sm text-muted-foreground">
                    还没有能力授权
                  </span>
                )}
              </Button>
            );
          })}
        </div>
      )}

      {/* ── 未登记产品的授权（2026-08-31，`opera/40-product-registry.md` §6）──────
          退役闸门只能拦住闸门立起来**之后**的退役；之前退掉的、以及绕过 opera 直连
          上游写进去的，都挂在一个目录里不存在的主体上，此前没有任何页面能看见它们。
          读取失败与「没有」必须分开说——见两条 Banner 与空态的分支。 */}
      {load.kind === "ready" ? (
        <Section
          title="未登记产品的授权"
          description="产品码不在产品目录里的上游授权——草稿 / 停用 / 退役都算登记过，只有目录里根本没有的码才在这里。目录是唯一权威，这些授权挂在一个不存在的主体上：撤掉它们，或者去产品目录把那个产品登记上。"
        >
          {allCapsError ? (
            <Banner
              tone="warning"
              title="Runos 侧没查到"
              description={`${allCapsError}。下面只有 Atlas 的结果；Runos 那边有没有未登记产品的授权，这一次答不出来。`}
            />
          ) : null}
          {allCaps && allCaps.failed.length > 0 ? (
            <Banner
              tone="warning"
              title={`${allCaps.failed.length} 个能力的授权没读到`}
              description={`${allCaps.failed.join("、")} —— 这些能力下若有未登记产品的授权，这一次看不见。`}
            />
          ) : null}
          <DataTable
            columns={[
              {
                id: "product",
                header: "产品码",
                width: "sm",
                cell: (r: OrphanRow) => (
                  /* 点进详情页：那里对目录外的码同样能列、能撤（见详情分支的兜底）。 */
                  <Link
                    href={`/product/entitlements?productCode=${encodeURIComponent(r.productCode)}`}
                    className="font-mono text-code-sm hover:text-primary-text"
                  >
                    {r.productCode}
                  </Link>
                ),
              },
              {
                id: "source",
                header: tShared("columns.source"),
                width: "sm",
                cell: (r: OrphanRow) => (
                  <Badge variant="outline">
                    {r.source === "atlas" ? "Atlas · 模型路由" : "Runos · 能力"}
                  </Badge>
                ),
              },
              {
                id: "object",
                header: "授权对象",
                cell: (r: OrphanRow) =>
                  r.source === "atlas" ? (
                    <span className="font-mono text-code-sm">
                      {r.grant.endpointCode}
                    </span>
                  ) : (
                    <span className="flex items-center gap-xs">
                      <span className="font-mono text-code-sm">
                        {r.grant.capabilityId}
                      </span>
                      <Badge
                        variant={
                          r.grant.grantType === "direct"
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {r.grant.grantType === "direct" ? "直接" : "推导"}
                      </Badge>
                    </span>
                  ),
              },
              {
                id: "state",
                header: tShared("columns.state"),
                align: "center",
                width: "xs",
                cell: (r: OrphanRow) =>
                  r.source === "atlas" ? (
                    <StatusBadge
                      tone={isEnabled(r.grant.state) ? "success" : "neutral"}
                      dot
                    >
                      {isEnabled(r.grant.state)
                        ? "生效中"
                        : tShared("status.generic.disabled")}
                    </StatusBadge>
                  ) : (
                    <StatusBadge
                      tone={GRANT_STATE_TONE[r.grant.state] ?? "neutral"}
                      dot
                    >
                      {r.grant.state}
                    </StatusBadge>
                  ),
              },
            ]}
            rows={orphanRows}
            rowKey={(r: OrphanRow) => r.key}
            indexStart={1}
            {...(canWriteRoutes || canWriteCapabilities
              ? {
                  /* 动作与详情页的同一套：Atlas 软停用（可逆、豁免二次确认）、Runos
                     撤销（迁 revoked、要确认）、派生行只能撤锚点——锚点在同一个
                     孤儿主体的 direct 行里找，找不到就按不动并说明。 */
                  rowActions: (r: OrphanRow) => {
                    if (r.source === "atlas") {
                      if (!canWriteRoutes) return null;
                      const g = r.grant;
                      return (
                        <ActionMenu
                          label={`${g.endpointCode} 操作`}
                          disabled={submitting}
                          items={[
                            {
                              id: "deactivate",
                              label: tShared("actions.disable"),
                              icon: "pause" as const,
                              danger: true,
                              disabled: !isEnabled(g.state),
                              confirmExempt:
                                "停用可随时再启用，授权行与配置原样保留，不构成不可逆操作",
                              onSelect: () => void deactivateRoute(g),
                            },
                          ]}
                        />
                      );
                    }
                    if (!canWriteCapabilities) return null;
                    const g = r.grant;
                    if (g.grantType === "direct") {
                      return (
                        <ActionMenu
                          label={`${g.capabilityId} 操作`}
                          disabled={submitting}
                          items={[
                            {
                              id: "revoke",
                              label: "撤销授权",
                              icon: "prohibit" as const,
                              danger: true,
                              disabled: g.state !== "active",
                              confirm: withLabels({
                                verb: "撤销",
                                target: `${r.productCode} 对 ${g.capabilityId} 的授权`,
                                consequence:
                                  "行迁到 revoked 终态、不删除——「谁曾经持有、什么时候被收回」要留得住。由它带出来的派生权益会在下一次闭包重编译时消失。**不是急停**：调用走快照，撤销后最多还会再放行一轮。",
                                onConfirm: () => revokeCapability(g),
                              }),
                            },
                          ]}
                        />
                      );
                    }
                    const anchor =
                      orphanRows.find(
                        (x) =>
                          x.source === "runos" &&
                          x.productCode === r.productCode &&
                          x.grant.grantType === "direct" &&
                          x.grant.capabilityId === g.anchorCapabilityId &&
                          x.grant.state === "active",
                      ) ?? null;
                    const anchorGrant =
                      anchor && anchor.source === "runos" ? anchor.grant : null;
                    return (
                      <ActionMenu
                        label={`${g.capabilityId} 操作`}
                        disabled={submitting}
                        items={[
                          {
                            id: "revoke-anchor",
                            label: anchorGrant
                              ? "撤销它的锚点"
                              : "锚点已不在这个主体",
                            icon: "prohibit" as const,
                            danger: true,
                            disabled: !anchorGrant,
                            confirm: withLabels({
                              verb: "撤销",
                              target: `锚点 ${g.anchorCapabilityId ?? ""}`,
                              consequence: `派生行不能单独撤销。撤掉锚点之后，这一条（${g.capabilityId}）会在下一次闭包重编译时自然消失——不是立刻。`,
                              onConfirm: () => {
                                if (!anchorGrant) return;
                                return revokeCapability(anchorGrant);
                              },
                            }),
                          },
                        ]}
                      />
                    );
                  },
                }
              : {})}
            empty={
              allCapsError ? (
                /* Atlas 那半查过了、是空的；Runos 那半没查到——不能合起来说「没有」。 */
                <EmptyState
                  title="Atlas 侧没有未登记产品的授权"
                  description="Runos 侧这一次没查到（见上方提示），不能说没有。"
                />
              ) : (
                <EmptyState
                  title="没有未登记产品的授权"
                  description="两个上游的每一条授权都能在产品目录里找到主体。"
                />
              )
            }
          />
        </Section>
      ) : null}
    </ViewLayout>
  );
}
