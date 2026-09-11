"use client";

/**
 * ProductDetailPage.tsx — 一个产品的接入配置，全在这一页。
 * @package @vxture/opera
 * @layer Presentation
 * @category Features - Product
 *
 * owner 2026-09-11:「一个产品接入，分散在多个弹出页面，感觉很乱……一个详情页争取
 * 配置完所有。」此前一个产品的接入配置散在六个入口、四种承载形态，而它们描述的是
 * 同一个对象。
 *
 * ── 同日走查后的排布返工 ──
 * 第一版铺出来之后 owner 指出「整体布局非常混乱」，给了九条。逐条对应如下——
 * 其中多数是**判断**不是偏好，写下来才不会在下一次改动里被悄悄抹掉：
 *
 *  1. **右侧摘要栏去掉**，页面全宽。摘要里的每一项在下面的板块中都有，同一个事实
 *     出现两次，读者得先判断这两处会不会不一致。信息归到它所属的板块。
 *  2. **字段一律上下结构**，标签小字且淡、带必填标记与帮助图标；原先挂在每个字段
 *     下面的说明全部收进帮助图标；两列之间留足横向间距。（见 `DetailForm.tsx`）
 *  3. **板块内容与标题文字对齐**，不顶头。
 *  4. 边缘与回调同 2。
 *  5. **接入检查改成抽屉**，按钮激活，不在页面底部堆信息。
 *  6. **底部统一操作区**，上方一条分割线，放弃 / 接入检查 / 保存设置都在这里。
 *  7. **身份与可见性拆成两个板块**。
 *  8. 名称用行业术语、不口语化——标签统一抄目录页既有的那套词（「副名 / 译名」
 *     「简介」「产品图标」…），不自造第三套。
 *  9. **校验失败要把对应的框染红**：一条 toast 说「产品名必填」而页面上十几个框，
 *     运营者得自己找。BFF 的字段级 400 带着 `field`，这里按它定位。
 *
 * ── 一次保存写两张表 ──
 * 底部只有一个「保存设置」，而基本信息 / 可见性写 `product.products`、边缘与回调写
 * `product.product_webhooks`。两次 PUT 串行发：products 先、webhooks 后。
 * **前一次失败就不发后一次**——否则会留下「基本信息没存上、回调却改了」这种半截
 * 状态，而界面只报了一次错，运营者不知道哪一半生效了。
 */

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  ActionMenu,
  Badge,
  Banner,
  Button,
  DetailList,
  DetailRow,
  DialogForm,
  Drawer,
  EmptyState,
  Icon,
  Input,
  NativeSelect,
  Section,
  Separator,
  StatusBadge,
  Switch,
  Textarea,
  ViewHeader,
  ViewLayout,
  useToast,
  type StatusBadgeTone,
} from "@vxture/design-system";
import {
  PRODUCT_SURFACE_DEFS,
  PRODUCT_TYPE_DEFS,
  productSurfaceLabel,
  productTypeLabel,
  type ProductSurface,
} from "@vxture/core-utils";
import { formatDateTime } from "@vxture-platform/shared";
import { api, OperaApiError } from "@/lib/api";
import { useOperatorSession } from "@/features/session/SessionProvider";
import { LockedInput } from "@/components/form/LockedInput";
import { actionsFor, type ProductAction } from "./lifecycle";
import { FieldGrid, FormField, SectionBody } from "./DetailForm";
import { ProductMetricsSection } from "./ProductMetricsSection";

const MANAGE = "platform:product.manage";

type ProductState = "draft" | "active" | "inactive" | "deprecated";

const STATE_TONE: Record<ProductState, StatusBadgeTone> = {
  draft: "neutral",
  active: "success",
  inactive: "warning",
  deprecated: "danger",
};
const STATE_LABEL: Record<ProductState, string> = {
  draft: "草稿",
  active: "已上线",
  inactive: "已停用",
  deprecated: "已退役",
};

interface ProductRecord {
  id: string;
  productCode: string;
  productType: string;
  productName: string;
  productNick: string | null;
  description: string | null;
  state: ProductState;
  isCustomerVisible: boolean;
  isWorkforceVisible: boolean;
  origin: string;
  originProvider: string | null;
  surfaces: string[];
  iconUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

interface WebhookRecord {
  homeUrl: string | null;
  webhookUrl: string | null;
  webhookSecretRef: string | null;
  edgeUpstream: string | null;
  edgeDomain: string | null;
  hasWebhookSecret: boolean;
}

interface ClientLite {
  clientId: string;
  releaseChannel: string;
  state: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: string;
}

interface ChecklistItem {
  itemCode: string;
  itemName: string | null;
  isRequired: boolean;
  isSatisfied: boolean;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "missing" }
  | { kind: "ready" };

function reason(error: unknown, fallback: string): string {
  return error instanceof OperaApiError && error.message
    ? error.message
    : fallback;
}

interface ProductDraft {
  productName: string;
  productNick: string;
  description: string;
  productType: string;
  origin: string;
  originProvider: string;
  isCustomerVisible: boolean;
  isWorkforceVisible: boolean;
  surfaces: ProductSurface[];
  iconUrl: string;
}

interface WebhookDraft {
  edgeDomain: string;
  edgeUpstream: string;
  webhookUrl: string;
  webhookSecret: string;
  homeUrl: string;
}

/** 字段级错误：键是 BFF 回的 `field`，值是它给的消息。 */
type FieldErrors = Record<string, string>;

export function ProductDetailPage({ productCode }: { productCode: string }) {
  const tShared = useTranslations();
  const locale = useLocale();
  /* 查表函数收 "zh" | "en"，next-intl 给的是 zh-CN / en-US。 */
  const typeLocale = locale.startsWith("en") ? "en" : "zh";
  const { toast } = useToast();
  const { can } = useOperatorSession();
  const canManage = can(MANAGE);

  const [product, setProduct] = useState<ProductRecord | null>(null);
  const [webhook, setWebhook] = useState<WebhookRecord | null>(null);
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });

  const [draft, setDraft] = useState<ProductDraft | null>(null);
  const [whDraft, setWhDraft] = useState<WebhookDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  const [handover, setHandover] = useState<string[] | null>(null);
  const [advisory, setAdvisory] = useState<ProductAction | null>(null);
  const [applying, setApplying] = useState(false);
  /** 接入检查抽屉（owner：不在页面底部堆信息）。 */
  const [checkOpen, setCheckOpen] = useState(false);

  const reload = useCallback(async () => {
    setLoad({ kind: "loading" });
    setErrors({});
    try {
      const p = await api.get<ProductRecord | null>(
        `/api/products/${encodeURIComponent(productCode)}`,
      );
      if (!p) {
        setLoad({ kind: "missing" });
        return;
      }
      setProduct(p);
      setDraft({
        productName: p.productName,
        productNick: p.productNick ?? "",
        description: p.description ?? "",
        productType: p.productType,
        origin: p.origin,
        originProvider: p.originProvider ?? "",
        isCustomerVisible: p.isCustomerVisible,
        isWorkforceVisible: p.isWorkforceVisible,
        surfaces: (p.surfaces ?? []) as ProductSurface[],
        iconUrl: p.iconUrl ?? "",
      });

      /* 三个附属读并行，且各自失败各自兜：webhook 读不到不该让整页空白，
         那样连产品名都看不见。每一节自己说自己的问题。 */
      const [wh, cl, ck] = await Promise.all([
        api
          .get<WebhookRecord | null>(`/api/products/${p.id}/webhook`)
          .catch(() => null),
        api
          .get<ClientLite[]>(`/api/oidc-clients?productId=${p.id}`)
          .catch(() => [] as ClientLite[]),
        api
          .get<ChecklistItem[]>(`/api/products/${p.id}/checklist`)
          .catch(() => [] as ChecklistItem[]),
      ]);
      setWebhook(wh);
      setClients(cl);
      setChecklist(ck);
      setWhDraft({
        /* 没登记过就按产品码预填——渲染器本来就会对空值做同一个推导，预填只是把
           这条隐含规则摆到运营者眼前，让异 apex 的产品有地方改。 */
        edgeDomain: wh?.edgeDomain?.trim() || `${p.productCode}.vxture.com`,
        edgeUpstream: wh?.edgeUpstream ?? "",
        webhookUrl: wh?.webhookUrl ?? "",
        /* 密钥框恒空：回传密钥本体等于取消加密存储的意义。 */
        webhookSecret: "",
        homeUrl: wh?.homeUrl ?? "",
      });
      setLoad({ kind: "ready" });
    } catch (error) {
      setLoad({ kind: "error", message: reason(error, "读取产品失败") });
    }
  }, [productCode]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * 一次保存写两张表。
   *
   * 失败时把 BFF 的字段级 400 落到对应的框上——owner:「保存时提示缺少信息，
   * 对应的信息框应该高亮红色体现。不然找不到位置。」`OperaApiError.field` 正是
   * BFF `invalidRequest(code, message, field)` 的第三个参数。
   */
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!product || !draft || !whDraft) return;
    setSaving(true);
    setErrors({});
    const secret = whDraft.webhookSecret.trim();
    try {
      await api.put(`/api/products/${product.id}`, {
        productName: draft.productName.trim(),
        productNick: draft.productNick.trim() || null,
        description: draft.description.trim() || null,
        productType: draft.productType,
        origin: draft.origin,
        originProvider: draft.originProvider.trim() || null,
        isCustomerVisible: draft.isCustomerVisible,
        isWorkforceVisible: draft.isWorkforceVisible,
        surfaces: draft.surfaces,
        iconUrl: draft.iconUrl.trim() || null,
      });
      /* products 失败就不发 webhooks：否则会留下「基本信息没存上、回调却改了」
         这种半截状态，而界面只报了一次错。 */
      await api.put(`/api/products/${product.id}/webhook`, {
        edgeDomain: whDraft.edgeDomain.trim() || null,
        edgeUpstream: whDraft.edgeUpstream.trim() || null,
        webhookUrl: whDraft.webhookUrl.trim() || null,
        homeUrl: whDraft.homeUrl.trim() || null,
        /* 三态不能塌成两态：框里没填就不带这个字段（undefined = 不动已存的），
           带一个 null 过去会把密钥清空。而框恒空，不这样就必然误清。 */
        ...(secret ? { webhookSecret: secret } : {}),
      });

      /* 一次性交接：只在**这次真的填了密钥**时弹。没填说明是在改别的，
         弹一个「请妥善保存」只会让人以为又生成了新密钥。 */
      if (secret) {
        setHandover([
          `边缘域名：${whDraft.edgeDomain.trim() || "（未填，走推导）"}`,
          `回调地址：${whDraft.webhookUrl.trim() || "（未填）"}`,
          `Webhook 签名密钥：${secret}`,
        ]);
      } else {
        toast({ tone: "success", title: "已保存" });
      }
      await reload();
    } catch (error) {
      const field = error instanceof OperaApiError ? error.field : undefined;
      const message = reason(error, "保存失败");
      if (field) {
        setErrors({ [field]: message });
        toast({
          tone: "danger",
          title: "保存失败",
          description: `${message}（对应的字段已在页面上标红）`,
        });
      } else {
        toast({ tone: "danger", title: "保存失败", description: message });
      }
    } finally {
      setSaving(false);
    }
  }

  async function applyLifecycle(action: ProductAction) {
    if (!product) return;
    setApplying(true);
    try {
      await api.patch(`/api/products/${product.id}/state`, {
        state: action.to,
      });
      toast({
        tone: "success",
        title: `${product.productName} · ${action.label}`,
      });
      await reload();
    } catch (error) {
      /* 判码不判文案。三种拒绝各有各的下一步。 */
      const code = error instanceof OperaApiError ? error.code : undefined;
      if (code === "CATALOG_LAUNCH_CHECKLIST_PENDING") {
        /* 直接把检查面板打开——「差哪几项」就在里面，比让人再点一次少一步。 */
        setCheckOpen(true);
        toast({
          tone: "danger",
          title: "接入检查未齐，不能上线",
          description: `${reason(error, "")} 检查面板已经打开。`,
        });
      } else if (code === "PRODUCT_HAS_ACTIVE_GRANTS") {
        toast({
          tone: "danger",
          title: `${product.productName} 未退役：上游还有生效中的授权`,
          description: "先去权益配置把它们撤掉，再回来退役。",
        });
      } else {
        toast({
          tone: "danger",
          title: `${action.label}失败`,
          description: reason(error, "操作失败"),
        });
      }
    } finally {
      setApplying(false);
    }
  }

  function toggleSurface(value: ProductSurface, on: boolean) {
    if (!draft) return;
    setDraft({
      ...draft,
      surfaces: on
        ? [...draft.surfaces, value]
        : draft.surfaces.filter((s) => s !== value),
    });
  }

  const lifecycleActions = product ? actionsFor(product.state) : [];
  const pendingRequired = checklist.filter(
    (i) => i.isRequired && !i.isSatisfied,
  );

  const header = (
    <ViewHeader
      icon="package"
      title={product?.productName ?? productCode}
      description={product?.productCode ?? undefined}
      secondary={
        product ? (
          <StatusBadge tone={STATE_TONE[product.state]} dot>
            {STATE_LABEL[product.state]}
          </StatusBadge>
        ) : undefined
      }
      action={
        <div className="flex items-center gap-sm">
          <Button asChild variant="outline">
            <Link href="/product/catalog">
              <Icon name="arrow-left" size="xs" aria-hidden="true" />
              返回目录
            </Link>
          </Button>
          {product && canManage && lifecycleActions.length > 0 ? (
            <ActionMenu
              label={`${product.productName} 生命周期动作`}
              disabled={applying}
              items={lifecycleActions.map((action) =>
                action.danger
                  ? {
                      id: action.id,
                      label: action.label,
                      icon: action.icon,
                      danger: true as const,
                      confirm: {
                        verb: action.destructive.verb,
                        target: product.productName,
                        consequence: action.destructive.consequence,
                        onConfirm: () => void applyLifecycle(action),
                      },
                    }
                  : action.advisory
                    ? {
                        id: action.id,
                        label: action.label,
                        icon: action.icon,
                        onSelect: () => setAdvisory(action),
                      }
                    : {
                        id: action.id,
                        label: action.label,
                        icon: action.icon,
                        onSelect: () => void applyLifecycle(action),
                      },
              )}
            />
          ) : null}
        </div>
      }
    />
  );

  if (load.kind === "loading") {
    return (
      <ViewLayout>
        {header}
        <EmptyState
          title={tShared("common.loading")}
          description="正在读取。"
        />
      </ViewLayout>
    );
  }
  if (load.kind === "missing" || load.kind === "error") {
    return (
      <ViewLayout>
        {header}
        <EmptyState
          title={load.kind === "missing" ? "产品不存在" : "读取失败"}
          description={
            load.kind === "missing"
              ? `目录里没有产品码「${productCode}」。它可能已被删除，或地址里的码写错了。`
              : load.message
          }
          action={
            <Button variant="secondary" onClick={() => void reload()}>
              {tShared("common.retry")}
            </Button>
          }
        />
      </ViewLayout>
    );
  }

  return (
    <>
      {/* 全宽单列（owner：右侧信息区去掉，信息归集到对应板块）。 */}
      <ViewLayout>
        {header}
        <form onSubmit={save} className="flex min-w-0 flex-col gap-2xl">
          {/* ── 基本信息 ─────────────────────────────────────────────────── */}
          <Section icon="database" title="基本信息" level={2}>
            <SectionBody>
              <FieldGrid>
                <FormField
                  id="pd-code"
                  label="产品码"
                  help={
                    <>
                      它同时是 <code>{product?.productCode}.vxture.com</code>、
                      容器前缀与库名的那个值，<b>登记后不可改</b>
                      。要换必须登记一个新产品。
                    </>
                  }
                >
                  {/* `locked` 已经把它置为 disabled——件刻意 Omit 掉了 readOnly。 */}
                  <LockedInput
                    id="pd-code"
                    locked
                    value={product?.productCode ?? ""}
                    className="font-mono text-code-sm"
                  />
                </FormField>

                <FormField
                  id="pd-name"
                  label="产品名称"
                  required
                  error={errors["productName"]}
                >
                  <Input
                    id="pd-name"
                    value={draft?.productName ?? ""}
                    disabled={!canManage}
                    aria-invalid={!!errors["productName"]}
                    onChange={(e) =>
                      draft &&
                      setDraft({ ...draft, productName: e.target.value })
                    }
                  />
                </FormField>

                <FormField
                  id="pd-nick"
                  label="副名 / 译名"
                  help="外文名或简称。console 与官网在空间不够时会优先用它。"
                >
                  <Input
                    id="pd-nick"
                    value={draft?.productNick ?? ""}
                    disabled={!canManage}
                    onChange={(e) =>
                      draft &&
                      setDraft({ ...draft, productNick: e.target.value })
                    }
                  />
                </FormField>

                <FormField
                  id="pd-type"
                  label="产品类型"
                  required
                  error={errors["productType"]}
                  help="受管枚举，权威源在 @vxture/core-utils。两条轴的乘积：通用 / 行业 × 平台 / 智能体。"
                >
                  <NativeSelect
                    id="pd-type"
                    value={draft?.productType ?? ""}
                    disabled={!canManage}
                    aria-invalid={!!errors["productType"]}
                    onChange={(e) =>
                      draft &&
                      setDraft({ ...draft, productType: e.target.value })
                    }
                  >
                    {PRODUCT_TYPE_DEFS.map((d) => (
                      <option key={d.value} value={d.value}>
                        {productTypeLabel(d.value, typeLocale)}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>

                <FormField id="pd-origin" label="来源">
                  <NativeSelect
                    id="pd-origin"
                    value={draft?.origin ?? "self"}
                    disabled={!canManage}
                    onChange={(e) =>
                      draft && setDraft({ ...draft, origin: e.target.value })
                    }
                  >
                    <option value="self">自研</option>
                    <option value="third_party">第三方</option>
                    <option value="other">其它</option>
                  </NativeSelect>
                </FormField>

                {draft?.origin === "third_party" ? (
                  <FormField
                    id="pd-provider"
                    label="供应方"
                    required
                    error={errors["originProvider"]}
                    help="来源是第三方时必填——「谁提供的」在出问题时是第一个要答的问题。"
                  >
                    <Input
                      id="pd-provider"
                      value={draft.originProvider}
                      disabled={!canManage}
                      aria-invalid={!!errors["originProvider"]}
                      onChange={(e) =>
                        setDraft({ ...draft, originProvider: e.target.value })
                      }
                    />
                  </FormField>
                ) : null}

                <FormField
                  id="pd-icon"
                  label="产品图标"
                  help="console 应用中心的磁贴用它。留空则只显示文字。"
                >
                  <Input
                    id="pd-icon"
                    value={draft?.iconUrl ?? ""}
                    disabled={!canManage}
                    placeholder="https://cdn.acme.com/icon.svg"
                    className="font-mono text-code-sm"
                    onChange={(e) =>
                      draft && setDraft({ ...draft, iconUrl: e.target.value })
                    }
                  />
                </FormField>

                <FormField id="pd-desc" label="简介" full>
                  <Textarea
                    id="pd-desc"
                    rows={2}
                    value={draft?.description ?? ""}
                    disabled={!canManage}
                    onChange={(e) =>
                      draft &&
                      setDraft({ ...draft, description: e.target.value })
                    }
                  />
                </FormField>
              </FieldGrid>

              {/* 创建 / 更新时刻原本在右侧摘要栏里。归到它所属的板块。 */}
              {product ? (
                <p className="text-body-sm text-muted-foreground">
                  创建于 {formatDateTime(product.createdAt, locale)} · 最近更新{" "}
                  {formatDateTime(product.updatedAt, locale)}
                </p>
              ) : null}
            </SectionBody>
          </Section>

          {/* ── 可见性与终端 ─────────────────────────────────────────────── */}
          <Section icon="eye" title="可见性与终端" level={2}>
            <SectionBody>
              <FieldGrid>
                <FormField
                  id="pd-customer"
                  label="客户域可见"
                  help="关掉之后，这个产品在 console 应用中心与官网都不出现。它与「端」正交：端说的是形态，realm 说的是给谁看。"
                >
                  <div className="flex h-9 items-center">
                    <Switch
                      id="pd-customer"
                      checked={draft?.isCustomerVisible ?? false}
                      disabled={!canManage}
                      onCheckedChange={(v) =>
                        draft && setDraft({ ...draft, isCustomerVisible: v })
                      }
                    />
                  </div>
                </FormField>

                <FormField
                  id="pd-workforce"
                  label="运营域可见"
                  help="平台自己的门户（admin / opera）里是否列出它。"
                >
                  <div className="flex h-9 items-center">
                    <Switch
                      id="pd-workforce"
                      checked={draft?.isWorkforceVisible ?? false}
                      disabled={!canManage}
                      onCheckedChange={(v) =>
                        draft && setDraft({ ...draft, isWorkforceVisible: v })
                      }
                    />
                  </div>
                </FormField>

                <FormField
                  id="pd-surfaces"
                  label="可露出的端"
                  full
                  help={
                    <>
                      <b>端是产品自身的形态属性，与租户无关</b>
                      ——要按租户开关的是权益，那挂在订阅 /
                      套餐上。桌面客户端据此 决定列不列这个产品。
                    </>
                  }
                >
                  <div className="grid gap-sm md:grid-cols-2">
                    {PRODUCT_SURFACE_DEFS.map((d) => (
                      <label
                        key={d.value}
                        className="flex items-center justify-between gap-sm rounded-md border border-border px-sm py-xs"
                      >
                        <span className="text-body-sm">
                          {productSurfaceLabel(d.value, typeLocale)}
                        </span>
                        <Switch
                          checked={draft?.surfaces.includes(d.value) ?? false}
                          disabled={!canManage}
                          onCheckedChange={(v) => toggleSurface(d.value, v)}
                        />
                      </label>
                    ))}
                  </div>
                </FormField>
              </FieldGrid>
            </SectionBody>
          </Section>

          {/* ── 接入凭据 ─────────────────────────────────────────────────── */}
          <Section
            icon="fingerprint"
            title="接入凭据"
            level={2}
            action={
              <Button asChild variant="outline" size="md">
                <Link
                  href={`/product/clients?productId=${encodeURIComponent(product?.id ?? "")}`}
                >
                  去凭据页
                </Link>
              </Button>
            }
          >
            <SectionBody>
              {clients.length === 0 ? (
                <EmptyState
                  title="还没有客户端"
                  description="没有 OIDC 客户端，这个产品无法完成登录——接入检查的「C1 身份接入」也会是红的。"
                />
              ) : (
                <DetailList>
                  {clients.map((c) => (
                    <DetailRow key={c.clientId} label={c.clientId}>
                      <div className="flex flex-wrap items-center gap-xs">
                        <Badge variant="outline">{c.releaseChannel}</Badge>
                        <Badge
                          variant={
                            c.tokenEndpointAuthMethod === "none"
                              ? "secondary"
                              : "outline"
                          }
                        >
                          {c.tokenEndpointAuthMethod === "none"
                            ? "公共客户端"
                            : "机密客户端"}
                        </Badge>
                        <StatusBadge
                          tone={c.state === "active" ? "success" : "neutral"}
                          dot
                        >
                          {c.state === "active"
                            ? tShared("actions.enable")
                            : tShared("actions.disable")}
                        </StatusBadge>
                        <span className="text-body-sm text-muted-foreground">
                          {c.redirectUris.length} 个回调
                        </span>
                      </div>
                    </DetailRow>
                  ))}
                </DetailList>
              )}
            </SectionBody>
          </Section>

          {/* ── 边缘路由与回调 ───────────────────────────────────────────── */}
          <Section icon="plug" title="边缘路由与回调" level={2}>
            <SectionBody>
              <FieldGrid>
                <FormField
                  id="pd-domain"
                  label="边缘域名"
                  error={errors["edgeDomain"]}
                  help={
                    <>
                      已按产品码预填，<b>可改</b>。用别的 apex（如{" "}
                      <code>anlan.ai</code>）就在这里改掉。
                      <br />
                      <b>DNS 记录要自己建</b>
                      ，本页不建也建不了。本域子域的证书是 通配的不用签；换了
                      apex 则证书与 vhost 都要另配。
                    </>
                  }
                >
                  <Input
                    id="pd-domain"
                    value={whDraft?.edgeDomain ?? ""}
                    disabled={!canManage}
                    aria-invalid={!!errors["edgeDomain"]}
                    className="font-mono text-code-sm"
                    onChange={(e) =>
                      whDraft &&
                      setWhDraft({ ...whDraft, edgeDomain: e.target.value })
                    }
                  />
                </FormField>

                <FormField
                  id="pd-upstream"
                  label="边缘上游"
                  error={errors["edgeUpstream"]}
                  help={
                    <>
                      写成 <code>host:port</code>
                      ，不带协议、路径或空格。端口在这
                      一栏，域名在上一栏，两者不要混。
                      <br />
                      <b>留空 = 这个产品完全不进边缘路由表</b>
                      （自带精确 vhost 的产品就该留空）。
                    </>
                  }
                >
                  <Input
                    id="pd-upstream"
                    value={whDraft?.edgeUpstream ?? ""}
                    disabled={!canManage}
                    aria-invalid={!!errors["edgeUpstream"]}
                    placeholder="<tailnet-ip>:4050"
                    className="font-mono text-code-sm"
                    onChange={(e) =>
                      whDraft &&
                      setWhDraft({ ...whDraft, edgeUpstream: e.target.value })
                    }
                  />
                </FormField>

                <FormField
                  id="pd-callback"
                  label="回调地址"
                  error={errors["webhookUrl"]}
                  help="平台向这个产品推送订阅变更与额度预警的地址。必须是 http / https 绝对地址；留空即撤销登记。"
                >
                  <Input
                    id="pd-callback"
                    value={whDraft?.webhookUrl ?? ""}
                    disabled={!canManage}
                    aria-invalid={!!errors["webhookUrl"]}
                    placeholder="https://app.example.com/webhooks/vxture"
                    className="font-mono text-code-sm"
                    onChange={(e) =>
                      whDraft &&
                      setWhDraft({ ...whDraft, webhookUrl: e.target.value })
                    }
                  />
                </FormField>

                <FormField
                  id="pd-secret"
                  label="签名密钥"
                  error={errors["webhookSecret"]}
                  help={
                    webhook?.hasWebhookSecret
                      ? "已登记。密钥加密存库、不回传，所以这里看不到当前值——要换就填新的，留空则保持不变。"
                      : "至少 16 位。密钥加密存库，填完这一次就再也拿不回来。保存后会给出一份交接清单，把它和域名、回调一起交给产品侧。"
                  }
                >
                  <Input
                    id="pd-secret"
                    type="password"
                    autoComplete="new-password"
                    value={whDraft?.webhookSecret ?? ""}
                    disabled={!canManage}
                    aria-invalid={!!errors["webhookSecret"]}
                    placeholder={
                      webhook?.hasWebhookSecret ? "留空则不改动" : "至少 16 位"
                    }
                    className="font-mono text-code-sm"
                    onChange={(e) =>
                      whDraft &&
                      setWhDraft({ ...whDraft, webhookSecret: e.target.value })
                    }
                  />
                </FormField>

                <FormField
                  id="pd-home"
                  label="产品主页"
                  error={errors["homeUrl"]}
                  help="展示用，不参与投递。"
                >
                  <Input
                    id="pd-home"
                    value={whDraft?.homeUrl ?? ""}
                    disabled={!canManage}
                    aria-invalid={!!errors["homeUrl"]}
                    placeholder="https://app.example.com"
                    className="font-mono text-code-sm"
                    onChange={(e) =>
                      whDraft &&
                      setWhDraft({ ...whDraft, homeUrl: e.target.value })
                    }
                  />
                </FormField>
              </FieldGrid>
            </SectionBody>
          </Section>

          {/* ── 计量指标 ─────────────────────────────────────────────────── */}
          <Section icon="gauge" title="计量指标" level={2}>
            <SectionBody>
              {product ? (
                <ProductMetricsSection
                  key={product.id}
                  productId={product.id}
                  productName={product.productName}
                  canManage={canManage}
                />
              ) : null}
            </SectionBody>
          </Section>

          {/* ── 底部操作区 ───────────────────────────────────────────────
              owner：上方一条分割线，放弃 / 接入检查 / 保存设置都在这里。
              「接入检查」是一个**动作**（打开检查面板），与保存同级；页面底部堆
              一屏检查项正是上一版被指出的乱。 */}
          <div className="flex flex-col gap-lg">
            <Separator />
            <div className="flex flex-wrap items-center justify-between gap-md">
              <div className="flex items-center gap-sm">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCheckOpen(true)}
                >
                  <Icon name="list-checks" size="xs" aria-hidden="true" />
                  接入检查
                  {pendingRequired.length > 0 ? (
                    <Badge variant="outline">{pendingRequired.length}</Badge>
                  ) : null}
                </Button>
                <Button asChild variant="ghost">
                  <Link
                    href={`/product/launch?productId=${encodeURIComponent(product?.id ?? "")}`}
                  >
                    上线复验
                  </Link>
                </Button>
              </div>
              {canManage ? (
                <div className="flex items-center gap-sm">
                  {/* 「放弃」= 丢掉本地改动、按库里的重读一遍。 */}
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => void reload()}
                  >
                    放弃
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving ? "保存中…" : "保存设置"}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </form>
      </ViewLayout>

      {/* ── 接入检查抽屉 ───────────────────────────────────────────────── */}
      <Drawer
        open={checkOpen}
        onClose={() => setCheckOpen(false)}
        width="md"
        title="接入检查"
        description={product?.productCode}
      >
        {checklist.length === 0 ? (
          <EmptyState
            title="读不到检查单"
            description="读不到不等于通过。先解决读取失败再判断能不能上线。"
          />
        ) : (
          <div className="flex flex-col gap-md">
            {pendingRequired.length > 0 ? (
              <Banner
                tone="warning"
                title={`还有 ${pendingRequired.length} 项必填检查未满足`}
                description="带「复验判定」的几项由平台实测写入——去上线复验跑一次，结果会自动写回；其余在接入检查单上确认。"
              />
            ) : (
              <Banner
                tone="success"
                title="必填项已齐"
                description="可以从页头的生命周期动作里确认上线。"
              />
            )}
            <DetailList>
              {checklist.map((i) => (
                <DetailRow key={i.itemCode} label={i.itemName ?? i.itemCode}>
                  <div className="flex items-center gap-xs">
                    <StatusBadge
                      tone={i.isSatisfied ? "success" : "neutral"}
                      dot
                    >
                      {i.isSatisfied ? "已满足" : "未满足"}
                    </StatusBadge>
                    {i.isRequired ? (
                      <Badge variant="outline">必需</Badge>
                    ) : null}
                  </div>
                </DetailRow>
              ))}
            </DetailList>
            <Button asChild variant="secondary">
              <Link
                href={`/product/launch?productId=${encodeURIComponent(product?.id ?? "")}`}
              >
                <Icon name="rocket" size="xs" aria-hidden="true" />
                去跑一次复验
              </Link>
            </Button>
          </div>
        )}
      </Drawer>

      {/* ── 一次性交接清单 ─────────────────────────────────────────────── */}
      <DialogForm
        open={handover !== null}
        onOpenChange={(open) => {
          if (!open) setHandover(null);
        }}
        title="交接清单"
        description="下面这些要交给产品侧。密钥只在这一次可见，关掉之后平台不再显示。"
        submitLabel="我已保存"
        cancelLabel={tShared("common.close")}
        onSubmit={(e) => {
          e.preventDefault();
          setHandover(null);
        }}
      >
        <Banner
          tone="warning"
          title="这是唯一一次看到密钥明文"
          description="关闭后无法再次查看，只能换一把新的。请立即复制。"
        />
        <Textarea
          readOnly
          rows={5}
          value={(handover ?? []).join("\n")}
          className="font-mono text-code-sm"
          onFocus={(e) => e.currentTarget.select()}
        />
      </DialogForm>

      {/* advisory 的二次确认。**提醒不是门闩**：没有任何条件可以不满足，它只是
          拦一下让人看一眼（「恢复」那一档）。所以不用 ConfirmDestructive。 */}
      <DialogForm
        open={advisory !== null}
        onOpenChange={(open) => {
          if (!open) setAdvisory(null);
        }}
        title={advisory?.advisory?.title ?? ""}
        description={advisory?.advisory?.description}
        submitLabel={advisory?.label ?? "确认"}
        submitting={applying}
        onSubmit={(e) => {
          e.preventDefault();
          const next = advisory;
          setAdvisory(null);
          if (next) void applyLifecycle(next);
        }}
      >
        {null}
      </DialogForm>
    </>
  );
}
