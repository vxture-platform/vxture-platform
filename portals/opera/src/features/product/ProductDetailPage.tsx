"use client";

/**
 * ProductDetailPage.tsx — 一个产品的接入配置，全在这一页。
 * @package @vxture/opera
 * @layer Presentation
 * @category Features - Product
 *
 * owner 2026-09-11:「一个产品接入，分散在多个弹出页面，感觉很乱……一个详情页争取
 * 配置完所有。后续对已配置得产品，支持一页修改（详情页），支持单项修改，补齐，
 * 轮换等操作（弹出面板，抽屉侧拉面板」。
 *
 * ── 这一页与它替代的东西 ──
 * 此前一个产品的接入配置散在：目录页的「编辑」对话框（身份/可见性/端）、目录页的
 * 「Webhook 登记」对话框（边缘与回调）、`/product/clients`（接入凭据）、目录页的
 * 「计量指标」抽屉、目录页的「接入检查单」抽屉、`/product/launch`（复验）。
 * **六个入口、四种承载形态**，而它们描述的是同一个对象。
 *
 * 这一页把它们收成一列板块。列表页与那两个独立页**都留着**——它们回答的是横向
 * 问题（「哪些客户端还开着」「谁的密钥半年没轮换」），那是详情页答不出的；详情页
 * 里是同一数据的内嵌视图 + 跳转。
 *
 * ── 一张表一个表单 ──
 * 「身份」与「可见性与端」写的是 `product.products` 同一行，所以共用一个草稿、
 * 一个保存；「边缘与回调」写 `product.product_webhooks`，自己一个。按表分，而不是
 * 按板块分——两个板块共用一次 PUT，比让运营者点两次「保存」然后想「刚才那次存了
 * 没有」要清楚。
 *
 * 「计量指标」整节是 `ProductMetricsSection`（自己取数、自己刷新、自己弹窗），这里
 * 只管它挂在哪。
 *
 * ── 地址走可读码 ──
 * `/product/catalog/karda` 而不是一串 uuid：地址要能读、能分享、能粘进工单。
 * BFF 的 `GET :idOrCode` 双接受，**先判形状再决定查哪一列**——把 `"karda"` 喂给
 * uuid 列是 `22P02`，一句 500，而真实答案是「按码去查」。
 */

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  Badge,
  Banner,
  Button,
  DetailList,
  DetailPageTemplate,
  DetailRow,
  DialogForm,
  EmptyState,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Icon,
  Input,
  NativeSelect,
  Section,
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
  type ProductSurface,
} from "@vxture/core-utils";
import { formatDateTime } from "@vxture-platform/shared";
import { api, OperaApiError } from "@/lib/api";
import { useOperatorSession } from "@/features/session/SessionProvider";
import { LockedInput } from "@/components/form/LockedInput";
import { RequiredMark } from "@/components/form/RequiredMark";
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

/** `products` 行的草稿。身份与可见性两个板块共用它——它们是同一行。 */
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

/** `product_webhooks` 行的草稿。 */
interface WebhookDraft {
  edgeDomain: string;
  edgeUpstream: string;
  webhookUrl: string;
  webhookSecret: string;
  homeUrl: string;
}

export function ProductDetailPage({ productCode }: { productCode: string }) {
  const tShared = useTranslations();
  const locale = useLocale();
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
  const [savingProduct, setSavingProduct] = useState(false);
  const [savingWebhook, setSavingWebhook] = useState(false);

  /** 首次配齐后的一次性交接弹窗。见下方 `handover`。 */
  const [handover, setHandover] = useState<string[] | null>(null);

  const reload = useCallback(async () => {
    setLoad({ kind: "loading" });
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

      /* 三个附属读并行，且**各自失败各自兜**：webhook 读不到不该让整页空白，
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
        /* 没登记过就按产品码预填边缘域名——渲染器本来就会对空值做同一个推导，
           预填只是把这条隐含规则摆到运营者眼前，让异 apex 的产品有地方改。 */
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

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!product || !draft) return;
    setSavingProduct(true);
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
      toast({ tone: "success", title: "已保存" });
      await reload();
    } catch (error) {
      toast({
        tone: "danger",
        title: "保存失败",
        description: reason(error, "保存失败"),
      });
    } finally {
      setSavingProduct(false);
    }
  }

  async function saveWebhook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!product || !whDraft) return;
    setSavingWebhook(true);
    try {
      await api.put(`/api/products/${product.id}/webhook`, {
        edgeDomain: whDraft.edgeDomain.trim() || null,
        edgeUpstream: whDraft.edgeUpstream.trim() || null,
        webhookUrl: whDraft.webhookUrl.trim() || null,
        homeUrl: whDraft.homeUrl.trim() || null,
        /* 三态，不能塌成两态：框里没填就**不带这个字段**（undefined = 不动已存的），
           带一个 null 过去会把密钥清空。运营者只是来改个回调地址，不该顺手把密钥
           抹了——而框里恒空，不这样就必然误清。 */
        ...(whDraft.webhookSecret.trim()
          ? { webhookSecret: whDraft.webhookSecret.trim() }
          : {}),
      });
      /*
       * 一次性交接：把「对方要拿到、而平台之后不再显示」的几项集中给一次。
       *
       * owner:「首次新增，保存以后，需要一个弹窗，把需要记录和转交得数据给出一次」。
       * 这些东西此前分散在三个动作里各自「只此一次」——client_secret 在注册时、
       * webhook 密钥在登记时、边缘域名在另一个对话框里——运营者要把它们从三个地方
       * 抄出来拼成一封邮件。只在**这次真的填了密钥**时弹：没填密钥说明是在改别的，
       * 弹一个「请妥善保存」的框只会让人以为又生成了新密钥。
       */
      if (whDraft.webhookSecret.trim()) {
        setHandover([
          `边缘域名：${whDraft.edgeDomain.trim() || "（未填，走推导）"}`,
          `回调地址：${whDraft.webhookUrl.trim() || "（未填）"}`,
          `Webhook 签名密钥：${whDraft.webhookSecret.trim()}`,
        ]);
      } else {
        toast({ tone: "success", title: "已保存" });
      }
      await reload();
    } catch (error) {
      toast({
        tone: "danger",
        title: "保存失败",
        description: reason(error, "保存失败"),
      });
    } finally {
      setSavingWebhook(false);
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
          {product ? (
            <Button asChild variant="secondary">
              <Link
                href={`/product/launch?productId=${encodeURIComponent(product.id)}`}
              >
                <Icon name="rocket" size="xs" aria-hidden="true" />
                上线复验
              </Link>
            </Button>
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

  const pendingRequired = checklist.filter(
    (i) => i.isRequired && !i.isSatisfied,
  );

  return (
    <>
      <DetailPageTemplate
        header={header}
        aside={
          product ? (
            <DetailList>
              <DetailRow label="产品码">
                <span className="font-mono text-code-sm">
                  {product.productCode}
                </span>
              </DetailRow>
              <DetailRow label="类型">
                {PRODUCT_TYPE_DEFS.find((d) => d.value === product.productType)
                  ?.labelZh ?? product.productType}
              </DetailRow>
              <DetailRow label="可露出的端">
                {product.surfaces.length === 0
                  ? "—"
                  : product.surfaces
                      .map(
                        (s) =>
                          PRODUCT_SURFACE_DEFS.find((d) => d.value === s)
                            ?.labelZh ?? s,
                      )
                      .join(" / ")}
              </DetailRow>
              <DetailRow label="接入检查">
                {pendingRequired.length === 0 ? (
                  <StatusBadge tone="success" dot>
                    必填项已齐
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="warning" dot>
                    还差 {pendingRequired.length} 项
                  </StatusBadge>
                )}
              </DetailRow>
              <DetailRow label="创建">
                {formatDateTime(product.createdAt, locale)}
              </DetailRow>
              <DetailRow label="最近更新">
                {formatDateTime(product.updatedAt, locale)}
              </DetailRow>
            </DetailList>
          ) : undefined
        }
      >
        {/* ── A+B 身份、可见性与端：同一行，同一个保存 ───────────────────── */}
        <Section
          icon="database"
          title="身份、可见性与端"
          level={2}
          description="这几项写的是产品目录里的同一行，所以共用一次保存。"
        >
          <form onSubmit={saveProduct} className="flex flex-col gap-md">
            <FieldGroup>
              <div className="grid gap-md md:grid-cols-2">
                <Field orientation="labeled">
                  <FieldLabel htmlFor="pd-code">产品码</FieldLabel>
                  {/* `locked` 已经把它置为 disabled——件刻意 Omit 掉了 readOnly，
                      两个都给等于让调用方在「不可改」这件事上有两种表达。 */}
                  <LockedInput
                    id="pd-code"
                    locked
                    value={product?.productCode ?? ""}
                    className="font-mono text-code-sm"
                  />
                  <FieldDescription>
                    它同时是 <code>{product?.productCode}.vxture.com</code>
                    、容器 前缀与库名的那个值，登记后不可改。
                  </FieldDescription>
                </Field>
                <Field orientation="labeled">
                  <FieldLabel htmlFor="pd-name">
                    产品名
                    <RequiredMark />
                  </FieldLabel>
                  <Input
                    id="pd-name"
                    value={draft?.productName ?? ""}
                    disabled={!canManage}
                    onChange={(e) =>
                      draft &&
                      setDraft({ ...draft, productName: e.target.value })
                    }
                  />
                </Field>
                <Field orientation="labeled">
                  <FieldLabel htmlFor="pd-nick">副名</FieldLabel>
                  <Input
                    id="pd-nick"
                    value={draft?.productNick ?? ""}
                    disabled={!canManage}
                    onChange={(e) =>
                      draft &&
                      setDraft({ ...draft, productNick: e.target.value })
                    }
                  />
                </Field>
                <Field orientation="labeled">
                  <FieldLabel htmlFor="pd-type">
                    类型
                    <RequiredMark />
                  </FieldLabel>
                  <NativeSelect
                    id="pd-type"
                    value={draft?.productType ?? ""}
                    disabled={!canManage}
                    onChange={(e) =>
                      draft &&
                      setDraft({ ...draft, productType: e.target.value })
                    }
                  >
                    {PRODUCT_TYPE_DEFS.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.labelZh}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field orientation="labeled">
                  <FieldLabel htmlFor="pd-origin">来源</FieldLabel>
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
                </Field>
                {draft?.origin === "third_party" ? (
                  <Field orientation="labeled">
                    <FieldLabel htmlFor="pd-provider">
                      供应方
                      <RequiredMark />
                    </FieldLabel>
                    <Input
                      id="pd-provider"
                      value={draft.originProvider}
                      disabled={!canManage}
                      onChange={(e) =>
                        setDraft({ ...draft, originProvider: e.target.value })
                      }
                    />
                    <FieldDescription>
                      来源是第三方时必填——「谁提供的」在出问题时是第一个要答的问题。
                    </FieldDescription>
                  </Field>
                ) : null}
                <Field orientation="labeled">
                  <FieldLabel htmlFor="pd-icon">图标地址</FieldLabel>
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
                  <FieldDescription>
                    console 应用中心的磁贴用它。留空则只显示文字。
                  </FieldDescription>
                </Field>
              </div>

              <Field orientation="labeled">
                <FieldLabel htmlFor="pd-desc">说明</FieldLabel>
                <Textarea
                  id="pd-desc"
                  rows={2}
                  value={draft?.description ?? ""}
                  disabled={!canManage}
                  onChange={(e) =>
                    draft && setDraft({ ...draft, description: e.target.value })
                  }
                />
              </Field>

              <div className="grid gap-sm md:grid-cols-2">
                <div className="flex items-center justify-between rounded-md border border-border p-sm">
                  <FieldLabel htmlFor="pd-customer">客户域可见</FieldLabel>
                  <Switch
                    id="pd-customer"
                    checked={draft?.isCustomerVisible ?? false}
                    disabled={!canManage}
                    onCheckedChange={(v) =>
                      draft && setDraft({ ...draft, isCustomerVisible: v })
                    }
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border border-border p-sm">
                  <FieldLabel htmlFor="pd-workforce">运营域可见</FieldLabel>
                  <Switch
                    id="pd-workforce"
                    checked={draft?.isWorkforceVisible ?? false}
                    disabled={!canManage}
                    onCheckedChange={(v) =>
                      draft && setDraft({ ...draft, isWorkforceVisible: v })
                    }
                  />
                </div>
              </div>

              <Field>
                <FieldLabel>可露出的端</FieldLabel>
                <div className="grid gap-sm md:grid-cols-2">
                  {PRODUCT_SURFACE_DEFS.map((d) => (
                    <label
                      key={d.value}
                      className="flex items-start justify-between gap-sm rounded-md border border-border p-sm"
                    >
                      <span className="flex flex-col gap-3xs">
                        <span className="text-body-md font-medium">
                          {d.labelZh}
                        </span>
                        <span className="text-body-sm text-muted-foreground">
                          {d.hintZh}
                        </span>
                      </span>
                      <Switch
                        checked={draft?.surfaces.includes(d.value) ?? false}
                        disabled={!canManage}
                        onCheckedChange={(v) => toggleSurface(d.value, v)}
                      />
                    </label>
                  ))}
                </div>
                <FieldDescription>
                  <b>端是产品自身的形态属性，与租户无关</b>
                  ——要按租户开关的是权益， 那挂在订阅 /
                  套餐上。桌面客户端据此决定列不列这个产品。
                </FieldDescription>
              </Field>
            </FieldGroup>

            {canManage ? (
              <div className="flex justify-end">
                <Button type="submit" disabled={savingProduct}>
                  {savingProduct ? "保存中…" : tShared("common.save")}
                </Button>
              </div>
            ) : null}
          </form>
        </Section>

        {/* ── C 接入凭据：内嵌视图 + 跳转 ─────────────────────────────────── */}
        <Section
          icon="fingerprint"
          title="接入凭据"
          level={2}
          description="产品用来换票的 OIDC 客户端。注册与轮换在凭据页做——那里能横向看全部产品，也是密钥只此一次露面的地方。"
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
        </Section>

        {/* ── D 边缘与回调：product_webhooks 一行 ─────────────────────────── */}
        <Section
          icon="plug"
          title="边缘与回调"
          level={2}
          description="域名决定「谁来敲门」，上游决定「转去哪」；回调是平台向产品推送订阅变更与额度预警的地址。"
        >
          <form onSubmit={saveWebhook} className="flex flex-col gap-md">
            <FieldGroup>
              <Field orientation="labeled">
                <FieldLabel htmlFor="pd-domain">边缘域名</FieldLabel>
                <Input
                  id="pd-domain"
                  value={whDraft?.edgeDomain ?? ""}
                  disabled={!canManage}
                  className="font-mono text-code-sm"
                  onChange={(e) =>
                    whDraft &&
                    setWhDraft({ ...whDraft, edgeDomain: e.target.value })
                  }
                />
                <FieldDescription>
                  已按产品码预填，<b>可改</b>。用别的 apex（如{" "}
                  <code>anlan.ai</code>
                  ）就在这里改掉。
                  <br />
                  <b>DNS 记录要你自己建</b>
                  ，本页不建也建不了。本域子域的证书是通配的 不用签；换了 apex
                  则证书与 vhost 都要另配。
                </FieldDescription>
              </Field>
              <Field orientation="labeled">
                <FieldLabel htmlFor="pd-upstream">边缘上游</FieldLabel>
                <Input
                  id="pd-upstream"
                  value={whDraft?.edgeUpstream ?? ""}
                  disabled={!canManage}
                  placeholder="<tailnet-ip>:4050"
                  className="font-mono text-code-sm"
                  onChange={(e) =>
                    whDraft &&
                    setWhDraft({ ...whDraft, edgeUpstream: e.target.value })
                  }
                />
                <FieldDescription>
                  写成 <code>host:port</code>，不带协议、路径或空格。
                  <b>留空 = 这个产品完全不进边缘路由表</b>（自带精确 vhost
                  的产品就该 留空）。
                </FieldDescription>
              </Field>
              <Field orientation="labeled">
                <FieldLabel htmlFor="pd-callback">回调地址</FieldLabel>
                <Input
                  id="pd-callback"
                  value={whDraft?.webhookUrl ?? ""}
                  disabled={!canManage}
                  placeholder="https://app.example.com/webhooks/vxture"
                  className="font-mono text-code-sm"
                  onChange={(e) =>
                    whDraft &&
                    setWhDraft({ ...whDraft, webhookUrl: e.target.value })
                  }
                />
              </Field>
              <Field orientation="labeled">
                <FieldLabel htmlFor="pd-secret">签名密钥</FieldLabel>
                <Input
                  id="pd-secret"
                  type="password"
                  autoComplete="new-password"
                  value={whDraft?.webhookSecret ?? ""}
                  disabled={!canManage}
                  placeholder={
                    webhook?.hasWebhookSecret
                      ? "已登记，留空则不改动"
                      : "至少 16 位"
                  }
                  className="font-mono text-code-sm"
                  onChange={(e) =>
                    whDraft &&
                    setWhDraft({ ...whDraft, webhookSecret: e.target.value })
                  }
                />
                <FieldDescription>
                  {webhook?.hasWebhookSecret
                    ? "已登记。密钥加密存库、不回传，所以这里看不到当前值——要换就填新的，留空则保持不变。"
                    : "密钥加密存库，填完这一次就再也拿不回来。保存后会有一个交接清单，把它和域名、回调一起交给产品侧。"}
                </FieldDescription>
              </Field>
              <Field orientation="labeled">
                <FieldLabel htmlFor="pd-home">产品主页</FieldLabel>
                <Input
                  id="pd-home"
                  value={whDraft?.homeUrl ?? ""}
                  disabled={!canManage}
                  placeholder="https://app.example.com"
                  className="font-mono text-code-sm"
                  onChange={(e) =>
                    whDraft &&
                    setWhDraft({ ...whDraft, homeUrl: e.target.value })
                  }
                />
                <FieldDescription>展示用，不参与投递。</FieldDescription>
              </Field>
            </FieldGroup>

            {canManage ? (
              <div className="flex justify-end">
                <Button type="submit" disabled={savingWebhook}>
                  {savingWebhook ? "保存中…" : tShared("common.save")}
                </Button>
              </div>
            ) : null}
          </form>
        </Section>

        {/* ── E 计量指标：整节由自足组件负责 ──────────────────────────────── */}
        <Section
          icon="gauge"
          title="计量指标"
          level={2}
          description="产品按这些键上报用量，平台按它们建配额池。要计量才需要登记。"
        >
          {product ? (
            <ProductMetricsSection
              key={product.id}
              productId={product.id}
              productName={product.productName}
              canManage={canManage}
            />
          ) : null}
        </Section>

        {/* ── F 上线检查 ─────────────────────────────────────────────────── */}
        <Section
          icon="list-checks"
          title="接入检查"
          level={2}
          description="必填项全部满足，产品才能从草稿上线——这道闸门在服务端，不是界面上的提醒。"
        >
          {checklist.length === 0 ? (
            <EmptyState
              title="读不到检查单"
              description="读不到不等于通过。先解决读取失败再判断能不能上线。"
            />
          ) : (
            <>
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
                  description="可以从产品目录把它上线。"
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
            </>
          )}
        </Section>
      </DetailPageTemplate>

      {/* ── 一次性交接清单 ─────────────────────────────────────────────────
          只在这次真的填了密钥时出现。关掉就再也拿不到密钥本体。 */}
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
    </>
  );
}
