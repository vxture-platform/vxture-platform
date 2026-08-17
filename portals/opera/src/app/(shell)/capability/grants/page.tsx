"use client";

/* Grant — 曾经设计为"opera 技术供给目录"独立发布/审批端点（两段裁决第一段）；
 * 2026-08-12 owner 决定（liaison #249，230/280-management-apis.md §5a）：M2
 * 落地时把 opera 技术字段（riskScope）和 admin 商业字段（quotaLimit）合并成
 * 了一次写入 `POST /commerce/capability-grants`，没有阶段隔离，也没有 opera 独立的目录
 * 发布端点——原设计文档的"两段裁决"逻辑链路仍然成立，只是这版实现里两段收
 * 敛成了一张表、一次写。这里改成单页合并表单（owner 拍板，不做假的两段式
 * UI），文件名/路由沿用 supply-catalogs 不改（内部 slug，非用户可见文案；
 * 导航标签已改为 "Grant"）。
 *
 * ── 2026-08-14：**本页留在 opera，不迁 admin**（owner 定，推翻上游分工表）──────
 *
 * runos `180-management-plane.md` §2 的分工表把 grants 与 quota limits 划给 admin。
 * 这页曾经因此顶着一条「本页归 admin、暂放此处」的横幅，理由是 admin 对 runos 零接入、
 * 拿掉会让全平台无处发授权。
 *
 * **那个前提已经不成立了**：owner 在 opera 目录重构里明确裁定「除权限管理跳转 admin 外，
 * 其余全部留在 opera，不再迁移」（`docs/opera-navigation-design.md` §8）。它不再是一个
 * 等着被搬走的临时安置，而是它该在的地方。横幅已撤——一条描述过时计划的横幅比没有横幅
 * 更糟，它会让读的人按一个作废的方向行事。
 *
 * 分工本身是**记录下来的、不是强制的**（`180` §2 原话）：两个控制台走同一个 API、同一道
 * 守卫，谁写的由管理事件上的 `actor_console` 回答。所以放在哪一侧都不会让审计说不清话。
 *
 * ── 2026-08-14：授权主体收敛为 product（ADR-010，runos `incr/06`）───────────
 *
 * 这页此前开放 tenant / workspace 两个主体，默认 workspace。**那两个值现在会被
 * runos 直接 400 掉**（`SUBJECT_TYPES = ["product"]`），也就是说这页的授权写入
 * 是全线失败的——不是少了个选项，是功能坏了。
 *
 * 收敛的理由不是简化，是那条链本身有漏洞：老实现按 workspace → tenant → product
 * 顺序取**第一个命中**，于是一条 workspace 授权能盖过产品的权益——授权一个产品
 * 根本没买的能力，或者把 risk_scope 收窄到比产品带的还小。收敛之后解析不再是
 * 有序回退，也就没有东西可以拿来覆盖了。
 *
 * 「卖出去的是产品服务」：客户买的是 L3 agent 产品，产品打包了哪些 runos 能力就
 * 用哪些。**同一个租户拿到哪些能力由产品分层决定，而那个分层发生在 agent 产品
 * 内部，不在 runos**——runos 只有产品，没有 tier，也不需要知道 tier。按租户发一条
 * 授权，本质就是"runos 订阅"换个名字，而 ADR-008 早就否掉了它。
 *
 * **tenant / workspace 没有消失，只是不再决定授权**：它们仍然是计量与账单主体，
 * 计量、用量、审计照样能按它们切片。而且它们是**一根轴的两个深度**，不是两根：
 * workspace 属于且只属于一个 tenant，当成两个独立维度会得到一张大部分格子天然
 * 为空的叉乘表，以及一堆加不回租户的工作区数字。
 *
 * 幂等语义（ADR-005）：已有 direct grant 重复写不生成新行；已有 derived grant
 * 会被这次写入升级成 direct。执行开关 RUNOS_ENTITLEMENT_ENFORCED 生产环境
 * 默认关闭——写入这里不代表网关立刻按它裁决。
 *
 * 2026-08-13 补齐三样（runos `incr/04` + §5b.2/§5b.3，均起于 `vxture-runos#65`
 * 提的"写得进、看不见、撤不掉"）：
 *   - **撤销**（上游 v0.8.0 起是 `POST /commerce/capability-grants/:grantId/revoke`；
 *     本层对外仍是 `DELETE`）——迁到 `revoked` 终态，
 *     不删行。此前页面上写着"写入后无法通过接口撤回（TD-010）"，现在能撤了。
 *   - **配额消费量**（`GET .../quota`）——此前设了限额看不到用掉多少。
 *   - **反向索引**（上游 v0.8.0 起是 `GET /commerce/capability-grants?capabilityId=`）——"谁持有这个
 *     能力"，撤销/审计一个能力时问的其实是这个方向。
 *
 * 两条 runos 侧的行为，UI 必须如实呈现，否则运营者会做出错误动作：
 *   1. **撤销不级联到派生行**（`grant.repository.ts` 注释：另一个锚点可能也
 *      required 同一个依赖，级联会撤掉没人要求撤的权益）。所以撤锚点之后，
 *      它带出来的 derived 行仍然在，直到下一次写入触发闭包重编译。
 *   2. **派生行不该单独撤**——闭包编译器下次会把它算回来，撤了等于没撤。这里
 *      直接禁用派生行的撤销菜单项，而不是让人点了才发现无效。 */

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
  FieldGroup,
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
  ViewHeader,
  ViewLayout,
  useToast,
} from "@vxture/design-system";
import { useOperatorSession } from "@/features/session/SessionProvider";
import { api, OperaApiError } from "@/lib/api";
import { RISK_LEVEL_META } from "@/lib/status";

const MANAGE = "capability:runos.manage";

/**
 * **授权主体只有 product 一个**（ADR-010，runos `incr/06`）。
 *
 * 不是"暂时只开放一个"，是 `tenant` / `workspace` / `user` 被**从授权模型里移除
 * 了**：runos 的 `SUBJECT_TYPES` 现在是 `["product"] as const`，送别的值直接
 * `400 invalid_subject_type`。数据库那边 `capability_grant.subject_type` 的 CHECK
 * 也收窄了，老的 tenant/workspace/user 行连同配额计数器一起删掉（`tier` 行是
 * **改名**成 product 而不是删——`subject_ref` 里存的本来就是产品码，是轴标错了，
 * 不是权益错了）。
 */
type SubjectType = "product";
type RiskScope = "read" | "write" | "critical";

/** 形状照 runos `280-management-apis.md` §5b.4 + 实测响应。
 *  `grantType` 与 `anchorCapabilityId` 是**读接口的契约义务**，不是可选装饰：
 *  查询会返回没有人手动创建过的 derived 行（Skill 的 required 依赖自动派生），
 *  把它们和 direct 行混在一起平铺，运营者会看到自己解释不了的授权。 */
interface GrantRecord {
  grantId: string;
  subjectType: string;
  subjectRef: string;
  capabilityId: string;
  grantType: "direct" | "derived";
  anchorCapabilityId: string | null;
  riskScope: string;
  criticalRequiresApproval: boolean;
  state: string;
  quotaLimit: number | null;
  createdAt: string;
  compiledAt: string | null;
}

/** `quota-counter.service.ts#consumption` 的返回形状。
 *  `remaining` 在未强制时是 **null 而不是数字**——runos 特意不给个数，因为
 *  报一个"剩余"就等于宣称有上限。这里跟着不编。 */
interface QuotaConsumption {
  grantId: string;
  used: number;
  quotaLimit: number;
  enforced: boolean;
  remaining: number | null;
  updatedAt: string | null;
}

/** §5b.3：`quota_limit <= 0` = **不强制执行**，不是"零调用"
 *  （runos 2026-08-13 应 #65 补进契约，此前未定义）。 */
function formatQuota(limit: number | null): string {
  if (limit == null) return "未设置";
  return limit <= 0 ? "不限（未强制）" : String(limit);
}

function describeError(error: unknown): { description?: string } {
  return error instanceof OperaApiError && error.message
    ? { description: error.message }
    : {};
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

type DialogState =
  | { kind: "revoke"; row: GrantRecord }
  | { kind: "quota-reset"; row: GrantRecord }
  | null;

/** `useSearchParams` 需要 Suspense 边界。 */
export default function RunosGrantsPage() {
  return (
    <Suspense fallback={null}>
      <RunosGrantsPageContent />
    </Suspense>
  );
}

function RunosGrantsPageContent() {
  const { toast } = useToast();
  const { can } = useOperatorSession();
  const canManage = can(MANAGE);

  const [submitting, setSubmitting] = useState(false);

  /** 平台产品目录——产品码是**已知集合**，让人手打等于制造错字。 */
  const [products, setProducts] = useState<
    { id: string; productCode: string; productName: string }[]
  >([]);
  /** runos 能力目录，供多选弹窗用。 */
  const [catalog, setCatalog] = useState<
    {
      capabilityId: string;
      title: string;
      displayName?: Record<string, string>;
      category?: string;
    }[]
  >([]);

  useEffect(() => {
    void api
      .get<{ id: string; productCode: string; productName: string }[]>(
        "/api/products",
      )
      .then(setProducts)
      .catch(() => setProducts([]));
    void api
      .get<
        {
          capabilityId: string;
          title: string;
          displayName?: Record<string, string>;
          category?: string;
        }[]
      >("/api/runos/capabilities")
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, []);

  /** 多选授权弹窗。 */
  const [grantPicker, setGrantPicker] = useState<{
    picked: string[];
    riskScope: RiskScope;
    quotaLimit: string;
    criticalRequiresApproval: boolean;
    keyword: string;
  } | null>(null);
  /** 撤销并重发：runos 不支持改配额，重写是空操作，只能撤了重发。 */
  const [reissue, setReissue] = useState<{
    row: GrantRecord;
    riskScope: RiskScope;
    quotaLimit: string;
  } | null>(null);

  /* 主体只有 product 一档，所以是常量而不是 state——没有可切换的东西。 */
  const lookupSubjectType: SubjectType = "product";
  /* 整页以**选中的产品**为中心：授权的真实动作是「给这个产品配能力」，不是
     「写一条 grant」。产品码因此只在选择器里出现一次，页面其余地方一次都不用再输。 */
  const initialSubjectRef = useSearchParams().get("productCode") ?? "";
  const [selectedProduct, setSelectedProduct] = useState(initialSubjectRef);
  const lookupSubjectRef = selectedProduct;
  const [grants, setGrants] = useState<GrantRecord[] | null>(null);
  const [lookupLoad, setLookupLoad] = useState<LoadState>({ kind: "idle" });

  /** 按 grantId 缓存的消费量。空 = 还没读过，不是"用了 0 次"——两者在 UI 上
   *  必须区分开，所以用 undefined 而不是默认 0。 */
  const [quota, setQuota] = useState<Record<string, QuotaConsumption>>({});
  const [quotaLoading, setQuotaLoading] = useState(false);

  const [capabilityRef, setCapabilityRef] = useState("");
  const [capGrants, setCapGrants] = useState<GrantRecord[] | null>(null);
  const [capLoad, setCapLoad] = useState<LoadState>({ kind: "idle" });

  const [dialog, setDialog] = useState<DialogState>(null);

  /* 选中产品即查，不需要再点一次「查询」——选择器一动，意图就已经明确了。
     `runLookup` 每次渲染都是新函数，进依赖会无限循环，故只依赖产品码。 */
  useEffect(() => {
    if (selectedProduct === "") {
      setGrants(null);
      setLookupLoad({ kind: "idle" });
      return;
    }
    void runLookup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProduct]);

  /**
   * 批量授权：**一次提交多个能力**。
   *
   * 一个产品下会有很多授权（347 个能力在册），一条一条发既慢又必然打错——而 runos
   * **不校验 capabilityId 是否存在**（只校验非空字符串），打错一个字符就静默写入一条
   * 指向不存在能力的授权，闭包推导找不到依赖、什么都不做，界面却显示成功。所以这里
   * 只让人从目录里**选**，不给手打的口子。
   *
   * 逐条串行发而不是并发：每条 direct 写入都会触发一次闭包重编译（ADR-005），
   * 并发打过去等于让编译器同时改同一个主体的派生集。
   */
  /** 已持有的能力（direct ∪ derived）——弹窗里置灰，避免发一条空操作。 */
  const heldCapabilityIds = new Set((grants ?? []).map((g) => g.capabilityId));

  /** 弹窗列表：已选置顶，其余按关键词过滤——勾完再搜就找不到自己勾过什么。 */
  function pickerRows(pk: { picked: string[]; keyword: string }) {
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

  async function submitPicker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!grantPicker || grantPicker.picked.length === 0 || !selectedProduct)
      return;
    const { picked, riskScope, quotaLimit, criticalRequiresApproval } =
      grantPicker;
    setSubmitting(true);
    const failed: string[] = [];
    try {
      for (const capabilityId of picked) {
        try {
          await api.post("/api/runos/grants", {
            subjectType: "product",
            subjectRef: selectedProduct,
            capabilityId,
            riskScope,
            ...(riskScope === "critical" ? { criticalRequiresApproval } : {}),
            ...(quotaLimit.trim() ? { quotaLimit: Number(quotaLimit) } : {}),
          });
        } catch {
          failed.push(capabilityId);
        }
      }
      const ok = picked.length - failed.length;
      toast({
        tone: failed.length > 0 ? "warning" : "success",
        title: `${ok} 条已授权给 ${selectedProduct}`,
        ...(failed.length > 0
          ? { description: `${failed.length} 条失败：${failed.join("、")}` }
          : {
              description:
                "已有 derived 会被升级成 direct；已有 direct 是空操作（runos 不套用新的 riskScope / quotaLimit）。",
            }),
      });
      setGrantPicker(null);
      await runLookup();
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * 撤销并重发 —— **改配额的唯一途径**。
   *
   * runos 对已存在的 direct 授权重写是彻底的空操作：不套用新的 riskScope /
   * quotaLimit，连管理事件都不发（源码原话是那会「记一次从未发生过的变更」）。
   * 而 `findOne` 只认 `state='active'`，所以撤销之后重发会建一条新行。
   *
   * 两步之间失败要说清楚落在哪一步——撤成功、发失败时，产品是**少了一条授权**的状态，
   * 沉默会让人以为什么都没发生。
   */
  async function submitReissue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reissue || !selectedProduct) return;
    const { row, riskScope, quotaLimit } = reissue;
    setSubmitting(true);
    try {
      await api.delete(`/api/runos/grants/${encodeURIComponent(row.grantId)}`);
      try {
        await api.post("/api/runos/grants", {
          subjectType: "product",
          subjectRef: selectedProduct,
          capabilityId: row.capabilityId,
          riskScope,
          ...(quotaLimit.trim() ? { quotaLimit: Number(quotaLimit) } : {}),
        });
        toast({
          tone: "success",
          title: `${row.capabilityId} 已按新配置重发`,
          description: "旧行迁到 revoked 终态保留，历史查得到。",
        });
      } catch (error) {
        toast({
          tone: "danger",
          title: "已撤销，但重发失败",
          description:
            "这个产品现在**少了这条授权**。请重新发一条——旧的已经是 revoked，不会挡住新写入。",
          ...describeError(error),
        });
      }
      setReissue(null);
      await runLookup();
    } catch (error) {
      toast({
        tone: "danger",
        title: "撤销失败，未做任何改动",
        ...describeError(error),
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function runLookup() {
    if (lookupSubjectRef.trim() === "") return;
    setLookupLoad({ kind: "loading" });
    try {
      const data = await api.get<GrantRecord[]>(
        `/api/runos/grants/${lookupSubjectType}/${encodeURIComponent(lookupSubjectRef.trim())}`,
      );
      setGrants(data);
      setQuota({});
      setLookupLoad({ kind: "ready" });
    } catch (error) {
      setGrants(null);
      setLookupLoad({
        kind: "error",
        message:
          error instanceof OperaApiError ? error.message : "查询权益失败",
      });
    }
  }

  /** 逐条读消费量。runos 侧每次读会先 flush 本地分片，所以这是有代价的调用，
   *  不做自动加载、也不做轮询——由运营者按需触发一次。 */
  async function loadQuota(rows: GrantRecord[]) {
    if (rows.length === 0) return;
    setQuotaLoading(true);
    const results = await Promise.all(
      rows.map(async (r) => {
        try {
          return await api.get<QuotaConsumption>(
            `/api/runos/grants/${encodeURIComponent(r.grantId)}/quota`,
          );
        } catch {
          return null;
        }
      }),
    );
    const next: Record<string, QuotaConsumption> = {};
    for (const item of results) if (item) next[item.grantId] = item;
    setQuota((prev) => ({ ...prev, ...next }));
    setQuotaLoading(false);
    const failed = results.filter((r) => r === null).length;
    if (failed > 0) {
      toast({
        tone: "warning",
        title: `${failed} 条用量读取失败`,
        description: "其余已更新；失败的那几条仍显示「未读取」。",
      });
    }
  }

  async function runCapabilityLookup() {
    if (capabilityRef.trim() === "") return;
    setCapLoad({ kind: "loading" });
    try {
      const data = await api.get<GrantRecord[]>(
        `/api/runos/grants/by-capability/${encodeURIComponent(capabilityRef.trim())}`,
      );
      setCapGrants(data);
      setCapLoad({ kind: "ready" });
    } catch (error) {
      setCapGrants(null);
      setCapLoad({
        kind: "error",
        message:
          error instanceof OperaApiError ? error.message : "反向查询失败",
      });
    }
  }

  async function confirmDialog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;
    const { kind, row } = dialog;
    setSubmitting(true);
    try {
      if (kind === "revoke") {
        await api.delete(
          `/api/runos/grants/${encodeURIComponent(row.grantId)}`,
        );
        toast({
          tone: "success",
          title: `${row.capabilityId} 的授权已撤销`,
          description:
            "行迁到 revoked 终态，没有删除。**不是急停**：调用走快照，撤销后最多还会再放行一轮（一个刷新周期）。由它带出来的派生权益也不会跟着撤——runos 刻意不级联。",
        });
      } else {
        const after = await api.post<QuotaConsumption>(
          `/api/runos/grants/${encodeURIComponent(row.grantId)}/quota/reset`,
        );
        setQuota((prev) => ({ ...prev, [row.grantId]: after }));
        toast({
          tone: "success",
          title: `${row.capabilityId} 的计数已归零`,
        });
      }
      setDialog(null);
      if (kind === "revoke") await runLookup();
    } catch (error) {
      toast({
        tone: "danger",
        title: kind === "revoke" ? "撤销失败" : "重置失败",
        ...describeError(error),
      });
    } finally {
      setSubmitting(false);
    }
  }

  const derivedCount =
    grants?.filter((g) => g.grantType === "derived").length ?? 0;

  /** 用量列。三态：未读取 / 未强制（只报 used）/ 强制（used ÷ limit）。 */
  function quotaCell(r: GrantRecord) {
    const q = quota[r.grantId];
    if (!q) {
      return <span className="text-body-sm text-muted-foreground">未读取</span>;
    }
    if (!q.enforced) {
      return (
        <span className="text-body-sm">
          {q.used}
          <span className="text-muted-foreground"> 次 · 未强制</span>
        </span>
      );
    }
    const exhausted = q.remaining != null && q.remaining <= 0;
    return (
      <span className={exhausted ? "text-danger" : undefined}>
        {q.used} / {q.quotaLimit}
        {exhausted ? <strong> · 已用尽</strong> : null}
      </span>
    );
  }

  const grantColumns = [
    {
      id: "capability",
      header: "Capability",
      cell: (r: GrantRecord) => (
        <span className="font-mono text-code-sm">{r.capabilityId}</span>
      ),
    },
    {
      id: "grantType",
      header: "来源",
      width: "sm" as const,
      cell: (r: GrantRecord) =>
        r.grantType === "derived" ? (
          <div className="flex flex-col gap-2xs">
            <Badge variant="outline">派生 · 只读</Badge>
            <span className="text-body-sm text-muted-foreground">
              锚点：
              <span className="font-mono">{r.anchorCapabilityId ?? "—"}</span>
            </span>
          </div>
        ) : (
          <Badge variant="secondary">直接授权</Badge>
        ),
    },
    {
      id: "quota",
      header: "配额",
      align: "right" as const,
      width: "xs" as const,
      cell: (r: GrantRecord) => formatQuota(r.quotaLimit),
    },
    {
      id: "consumption",
      header: "已消费",
      align: "right" as const,
      width: "xs" as const,
      cell: quotaCell,
    },
    {
      id: "approval",
      header: "critical 需人工确认",
      align: "center" as const,
      width: "xs" as const,
      cell: (r: GrantRecord) => (r.criticalRequiresApproval ? "是" : "否"),
    },
    {
      id: "risk",
      header: "风险范围",
      align: "center" as const,
      width: "xs" as const,
      cell: (r: GrantRecord) => (
        <StatusBadge tone={RISK_LEVEL_META[r.riskScope]?.tone ?? "neutral"}>
          {r.riskScope}
        </StatusBadge>
      ),
    },
    {
      id: "state",
      header: "状态",
      align: "center" as const,
      width: "xs" as const,
      cell: (r: GrantRecord) => (
        <StatusBadge tone={r.state === "active" ? "success" : "neutral"} dot>
          {r.state}
        </StatusBadge>
      ),
    },
  ];

  return (
    <ViewLayout>
      <ViewHeader
        icon="list-checks"
        title="能力授权"
        description="把一个能力授权给一个产品。产品能用，它的租户就能用——租户与工作区不在授权模型里，它们是计量与账单主体。"
      />

      <Banner
        tone="info"
        title="不是两段式，是合并成一次写入"
        description="原设计的独立技术供给目录端点不存在——POST /commerce/capability-grants 一次收 riskScope 和 quotaLimit。RUNOS_ENTITLEMENT_ENFORCED 生产默认关闭，写入这里暂不影响网关实际裁决。"
      />

      {!canManage ? (
        <Banner
          tone="warning"
          title="没有写权限"
          description="缺少 capability:runos.manage，下方表单只能查看，不能提交。"
        />
      ) : null}

      <Section
        title="产品持有的能力"
        icon="eye"
        level={2}
        description="一个产品当前持有的全部 active grant（direct ∪ derived）——卖的是什么就该显示什么（ADR-005）。租户和工作区不在这里：它们不决定授权，产品买了什么它的租户就用什么。"
        action={
          /* **写入已移到「产品管理 · 权益配置」**（2026-08-16，E1）：授权主体是产品
             （ADR-010），而产品能不能跑取决于模型路由与能力授权的**合集**，两者必须
             在同一处配。本页保留的是按产品查看与逐条撤销 / 改配置——以及下面那个
             「按 Capability 反查持有者」，那是下线一个能力前必须看的方向。 */
          <Button variant="secondary" asChild>
            <Link
              href={`/product/entitlements${selectedProduct ? `?productCode=${encodeURIComponent(selectedProduct)}` : ""}`}
            >
              <Icon name="arrow-right" size="sm" aria-hidden="true" />
              去权益配置发授权
            </Link>
          </Button>
        }
      >
        <div className="flex flex-wrap items-end gap-sm">
          <Field className="w-fit grow max-w-panel-sm">
            <FieldLabel htmlFor="lookup-product">产品</FieldLabel>
            {/* 选择器不是输入框：产品码是**已知集合**（平台自己的目录），让人手打
                已知集合里的值就是在制造错字。选中即查，不用再点一次「查询」。 */}
            <NativeSelect
              id="lookup-product"
              value={selectedProduct}
              onChange={(e) => setSelectedProduct(e.target.value)}
            >
              <option value="">选择产品…</option>
              {products.map((p) => (
                <option key={p.id} value={p.productCode}>
                  {p.productName}（{p.productCode}）
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Button
            variant="ghost"
            type="button"
            disabled={quotaLoading || grants == null || grants.length === 0}
            onClick={() => void loadQuota(grants ?? [])}
          >
            {quotaLoading ? "读取用量中…" : "读取用量"}
          </Button>
        </div>

        {derivedCount > 0 ? (
          <Banner
            className="mt-md"
            tone="info"
            title={`其中 ${derivedCount} 条是自动派生的，不是有人手动授权的`}
            description="派生权益来自 ADR-005 的闭包编译：授权一个声明了 required 依赖的 Skill 时，依赖链会自动展开成 derived 行，锚点列显示它由哪个能力带出来。这类行不应被当作独立的授权决策来读，也不能单独撤销——闭包编译器下次会把它算回来，要撤得撤锚点。"
          />
        ) : null}

        {lookupLoad.kind === "idle" ? null : (
          <div className="mt-md">
            <DataTable
              columns={grantColumns}
              rows={grants ?? []}
              rowKey={(r) => r.grantId}
              indexStart={1}
              {...(canManage
                ? {
                    rowActions: (r: GrantRecord) => (
                      <ActionMenu
                        label={`${r.capabilityId} 操作`}
                        disabled={submitting}
                        items={[
                          {
                            id: "quota",
                            label: "读取用量",
                            icon: "gauge",
                            onSelect: () => void loadQuota([r]),
                          },
                          {
                            /* 改配额的**唯一**途径——重写是空操作（runos 不套用新的
                               riskScope / quotaLimit，连管理事件都不发）。派生行没有
                               这个动作：它的配置跟着锚点走。 */
                            id: "reissue",
                            label: "撤销并重发（改配置）",
                            icon: "refresh" as const,
                            disabled:
                              r.grantType === "derived" || r.state !== "active",
                            onSelect: () =>
                              setReissue({
                                row: r,
                                riskScope: (r.riskScope as RiskScope) ?? "read",
                                quotaLimit:
                                  r.quotaLimit != null && r.quotaLimit > 0
                                    ? String(r.quotaLimit)
                                    : "",
                              }),
                          },
                          {
                            id: "quota-reset",
                            label: "重置计数",
                            icon: "refresh",
                            disabled: r.quotaLimit == null || r.quotaLimit <= 0,
                            onSelect: () =>
                              setDialog({ kind: "quota-reset", row: r }),
                          },
                          {
                            id: "revoke",
                            label:
                              r.grantType === "derived"
                                ? "撤销（派生行不可单独撤）"
                                : "撤销授权",
                            icon: "prohibit",
                            danger: true,
                            separatorBefore: true,
                            disabled:
                              r.grantType === "derived" || r.state !== "active",
                            onSelect: () =>
                              setDialog({ kind: "revoke", row: r }),
                          },
                        ]}
                      />
                    ),
                  }
                : {})}
              empty={
                lookupLoad.kind === "loading" ? (
                  <EmptyState title="查询中…" description="正在读取权益。" />
                ) : lookupLoad.kind === "error" ? (
                  <EmptyState
                    title="查询失败"
                    description={lookupLoad.message}
                  />
                ) : (
                  <EmptyState
                    title="没有权益"
                    description="这个 subject 目前没有任何 active grant。"
                  />
                )
              }
            />
          </div>
        )}
      </Section>

      <Section
        title="按 Capability 反查持有者"
        icon="users"
        level={2}
        description="「谁持有这个能力」——下线一个能力、或审计一次授权面时问的是这个方向，按 subject 逐个翻查不出来。只返回 active 行。"
      >
        <div className="flex flex-wrap items-end gap-sm">
          <Field className="w-fit grow">
            <FieldLabel htmlFor="lookup-capability">Capability ID</FieldLabel>
            <Input
              id="lookup-capability"
              value={capabilityRef}
              onChange={(e) => setCapabilityRef(e.target.value)}
              placeholder="runos.code-sandbox"
              className="font-mono"
            />
          </Field>
          <Button
            variant="outline"
            type="button"
            disabled={capabilityRef.trim() === ""}
            onClick={() => void runCapabilityLookup()}
          >
            反查
          </Button>
        </div>

        {capLoad.kind === "idle" ? null : (
          <div className="mt-md">
            <DataTable
              columns={[
                {
                  id: "subject",
                  header: "Subject",
                  cell: (r: GrantRecord) => (
                    <div className="flex flex-col gap-2xs">
                      <span className="font-mono text-code-sm">
                        {r.subjectRef}
                      </span>
                      <Badge variant="outline">{r.subjectType}</Badge>
                    </div>
                  ),
                },
                {
                  id: "grantType",
                  header: "来源",
                  width: "sm",
                  cell: (r: GrantRecord) =>
                    r.grantType === "derived" ? (
                      <div className="flex flex-col gap-2xs">
                        <Badge variant="outline">派生</Badge>
                        <span className="text-body-sm text-muted-foreground">
                          锚点：
                          <span className="font-mono">
                            {r.anchorCapabilityId ?? "—"}
                          </span>
                        </span>
                      </div>
                    ) : (
                      <Badge variant="secondary">直接授权</Badge>
                    ),
                },
                {
                  id: "quota",
                  header: "配额",
                  align: "right",
                  width: "xs",
                  cell: (r: GrantRecord) => formatQuota(r.quotaLimit),
                },
                {
                  id: "risk",
                  header: "风险范围",
                  align: "center",
                  width: "xs",
                  cell: (r: GrantRecord) => (
                    <StatusBadge
                      tone={RISK_LEVEL_META[r.riskScope]?.tone ?? "neutral"}
                    >
                      {r.riskScope}
                    </StatusBadge>
                  ),
                },
              ]}
              rows={capGrants ?? []}
              rowKey={(r) => r.grantId}
              indexStart={1}
              empty={
                capLoad.kind === "loading" ? (
                  <EmptyState title="查询中…" description="正在反查持有者。" />
                ) : capLoad.kind === "error" ? (
                  <EmptyState title="反查失败" description={capLoad.message} />
                ) : (
                  <EmptyState
                    title="没有人持有"
                    description="这个能力目前没有任何 active grant——下线它不会影响现有租户。"
                  />
                )
              }
            />
          </div>
        )}
      </Section>

      {/* ── 撤销 ─────────────────────────────────────────────────────────── */}
      <DialogForm
        open={dialog?.kind === "revoke"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        size="sm"
        danger
        title={
          dialog?.kind === "revoke"
            ? `撤销「${dialog.row.capabilityId}」`
            : "撤销授权"
        }
        description="行迁到 revoked 终态，不删除——「谁曾经持有、什么时候被收回」要留得住。注意：runos 刻意不级联撤销由它带出来的派生行（另一个锚点可能也需要同一个依赖），那些行要等下一次写入触发闭包重编译才会重算。"
        submitLabel="撤销"
        submitting={submitting}
        onSubmit={(e) => void confirmDialog(e)}
      />

      {/* ── 重置配额计数 ─────────────────────────────────────────────────── */}
      <DialogForm
        open={dialog?.kind === "quota-reset"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        size="sm"
        title={
          dialog?.kind === "quota-reset"
            ? `重置「${dialog.row.capabilityId}」的计数`
            : "重置配额计数"
        }
        description="计数器是累计的、没有自己的账期，所以周期翻页或改错了配额只能靠手动归零。归零后原计数不可找回；本次操作会记进 opera 审计与 runos 的管理事件流。"
        submitLabel="归零"
        submitting={submitting}
        onSubmit={(e) => void confirmDialog(e)}
      />

      {/* ── 授权能力：从目录多选，不给手打的口子 ──────────────────────────── */}
      <DialogForm
        open={grantPicker !== null}
        onOpenChange={(open) => {
          if (!open) setGrantPicker(null);
        }}
        size="lg"
        title={`授权能力 · ${selectedProduct}`}
        description="一次可选多个。runos 不校验 capabilityId 是否存在——手打错一个字符会静默写入一条永远不生效的授权，所以这里只让选。"
        submitLabel={
          grantPicker ? `授权 ${grantPicker.picked.length} 个` : "授权"
        }
        submitting={submitting}
        submitDisabled={!grantPicker || grantPicker.picked.length === 0}
        onSubmit={submitPicker}
      >
        {grantPicker ? (
          <>
            <FieldTier
              tier="identity"
              title="选能力"
              hint={`目录共 ${catalog.length} 个，已选 ${grantPicker.picked.length} 个。`}
            >
              <InputGroup>
                <InputGroupAddon>
                  <Icon name="search" size="sm" aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  placeholder="搜索能力名 / ID / 分类…"
                  aria-label="搜索能力"
                  value={grantPicker.keyword}
                  onChange={(e) =>
                    setGrantPicker({ ...grantPicker, keyword: e.target.value })
                  }
                />
              </InputGroup>
              {/* 固定高度的选择区：目录有几百条，让它撑开对话框等于把提交按钮推到
                  屏幕外。 */}
              <div className="flex flex-col gap-2xs rounded-md border border-border p-xs">
                {pickerRows(grantPicker).length === 0 ? (
                  <p className="p-sm text-body-sm text-muted-foreground">
                    没有匹配的能力。
                  </p>
                ) : (
                  pickerRows(grantPicker).map((c) => {
                    const on = grantPicker.picked.includes(c.capabilityId);
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
                            setGrantPicker({
                              ...grantPicker,
                              picked: on
                                ? grantPicker.picked.filter(
                                    (x) => x !== c.capabilityId,
                                  )
                                : [...grantPicker.picked, c.capabilityId],
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
                          /* 已持有的置灰而不隐藏：看得见「这个已经有了」，比它凭空
                             不在列表里更好解释。 */
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
                  })
                )}
              </div>
            </FieldTier>

            <FieldTier
              tier="details"
              title="这一批的授权配置"
              hint="选中的能力共用同一套。要给某一条不同的配置，单独再发一次。"
            >
              <Field>
                <FieldLabel htmlFor="picker-risk">Risk Scope</FieldLabel>
                <NativeSelect
                  id="picker-risk"
                  value={grantPicker.riskScope}
                  onChange={(e) =>
                    setGrantPicker({
                      ...grantPicker,
                      riskScope: e.target.value as RiskScope,
                    })
                  }
                >
                  <option value="read">read</option>
                  <option value="write">write</option>
                  <option value="critical">critical</option>
                </NativeSelect>
                <FieldDescription>
                  这条授权的风险上限：能力上某个操作的 riskLevel
                  高过它，那次调用就 policy_denied。绝大多数是 read，所以默认
                  read——但不替你默认成 write。
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="picker-quota">
                  Quota Limit（可选）
                </FieldLabel>
                <Input
                  id="picker-quota"
                  value={grantPicker.quotaLimit}
                  onChange={(e) =>
                    setGrantPicker({
                      ...grantPicker,
                      quotaLimit: e.target.value,
                    })
                  }
                  placeholder="留空 = 不限"
                />
                <FieldDescription>
                  累计计数，没有周期重置。小于等于 0
                  表示不强制执行，不是「零调用」。 发出去之后改不了——runos
                  对已有 direct 授权的重写是空操作，改配额只能 撤销后重发。
                </FieldDescription>
              </Field>
            </FieldTier>
          </>
        ) : null}
      </DialogForm>

      {/* ── 撤销并重发：改配额的唯一途径 ─────────────────────────────────── */}
      <DialogForm
        open={reissue !== null}
        onOpenChange={(open) => {
          if (!open) setReissue(null);
        }}
        title={reissue ? `撤销并重发 · ${reissue.row.capabilityId}` : ""}
        description="runos 对已存在的 direct 授权重写是空操作——不套用新的 riskScope / quotaLimit，连管理事件都不发。所以改配置只能撤了重发：旧行迁到 revoked 终态保留，历史查得到。"
        submitLabel="撤销并重发"
        submitting={submitting}
        onSubmit={submitReissue}
      >
        {reissue ? (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="reissue-risk">Risk Scope</FieldLabel>
              <NativeSelect
                id="reissue-risk"
                value={reissue.riskScope}
                onChange={(e) =>
                  setReissue({
                    ...reissue,
                    riskScope: e.target.value as RiskScope,
                  })
                }
              >
                <option value="read">read</option>
                <option value="write">write</option>
                <option value="critical">critical</option>
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="reissue-quota">Quota Limit</FieldLabel>
              <Input
                id="reissue-quota"
                value={reissue.quotaLimit}
                onChange={(e) =>
                  setReissue({ ...reissue, quotaLimit: e.target.value })
                }
                placeholder="留空 = 不限"
              />
              <FieldDescription>
                重发是一条新授权，已消费计数从零开始——旧行的计数留在 revoked
                那条上。
              </FieldDescription>
            </Field>
          </FieldGroup>
        ) : null}
      </DialogForm>
    </ViewLayout>
  );
}
