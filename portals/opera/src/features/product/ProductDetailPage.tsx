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
  Card,
  DetailList,
  DetailRow,
  DialogForm,
  Drawer,
  EmptyState,
  FileTrigger,
  Icon,
  Input,
  NativeSelect,
  Section,
  Separator,
  StatusBadge,
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
import {
  CopyableInput,
  FieldGrid,
  FormField,
  SectionBody,
  ToggleRow,
} from "./DetailForm";
import { ProductMetricsSection } from "./ProductMetricsSection";

const MANAGE = "platform:product.manage";

/** 与 BFF、库上的 CHECK 同一套。不收 SVG——它可以带脚本。 */
const ICON_ACCEPT = ["image/png", "image/webp", "image/jpeg"];
const ICON_MAX_BYTES = 262144;

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
  /** 平台托管图标的版本号(内容哈希)。null = 没传过。 */
  iconVersion: string | null;
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
  displayName: string | null;
  logoUrl: string | null;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
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

/**
 * BFF 的 `field` → 界面上的标签与输入框 id。
 *
 * owner 2026-09-11:「保存失败，提示字段标红了，但是没看到，直接提示哪个字段。」
 * 「已在页面上标红」是让人自己去找——页面有十几个框，而出错的那个可能在折叠之下或
 * 视口之外。所以两件一起做：**toast 直接点名**，并把那个框**滚到视野中央并聚焦**。
 *
 * 表里没有的字段仍会标红并弹 toast，只是标题退回通用文案——BFF 将来加字段不会因为
 * 这里没登记就变成「保存失败」四个字。
 */
const FIELD_META: Record<string, { label: string; inputId: string }> = {
  productName: { label: "产品名称", inputId: "pd-name" },
  productType: { label: "产品类型", inputId: "pd-type" },
  originProvider: { label: "供应方", inputId: "pd-provider" },
  productNick: { label: "英文名称", inputId: "pd-nick" },
  description: { label: "产品介绍", inputId: "pd-desc" },
  iconUrl: { label: "产品图标", inputId: "pd-icon" },
  edgeDomain: { label: "边缘域名", inputId: "pd-domain" },
  edgeUpstream: { label: "边缘上游", inputId: "pd-upstream" },
  webhookUrl: { label: "回调地址", inputId: "pd-callback" },
  webhookSecret: { label: "签名密钥", inputId: "pd-secret" },
  homeUrl: { label: "产品主页", inputId: "pd-home" },
};

/**
 * 预留渠道。有对应客户端就不占位，没有就摆一张灰卡。
 *
 * 只留 `beta`：`canary` 是按需开的，给每个产品都摆一张会把「没建」变成「缺了」。
 */
const RESERVED_CHANNELS = ["beta"] as const;

const CHANNEL_LABEL: Record<string, string> = {
  stable: "正式",
  beta: "灰度",
  canary: "金丝雀",
};

/** 一张凭据卡：图标 + client_id + 渠道/类型/状态/回调数。 */
function ClientCard({
  client,
  canManage,
  onEdit,
}: {
  readonly client: ClientLite;
  readonly canManage: boolean;
  readonly onEdit: () => void;
}) {
  const isPublic = client.tokenEndpointAuthMethod === "none";
  return (
    <Card className="flex min-w-0 flex-col gap-sm p-md">
      <div className="flex min-w-0 items-center gap-sm">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon name="fingerprint" size="sm" aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-mono text-code-sm">
            {client.clientId}
          </span>
          {/* 展示名要露出来：它是**客户在授权页看到的那个名字**，而此前界面上
              一处都不显示，于是 vxtpl 的授权页一直写着 seed 里的英文缩写。 */}
          <span className="truncate text-label-sm text-muted-foreground">
            {CHANNEL_LABEL[client.releaseChannel] ?? client.releaseChannel} ·{" "}
            {client.displayName || "未设展示名"}
          </span>
        </span>
        {canManage ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`编辑 ${client.clientId}`}
            onClick={onEdit}
          >
            <Icon name="edit" size="sm" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-xs">
        <StatusBadge
          tone={client.state === "active" ? "success" : "neutral"}
          dot
        >
          {client.state === "active" ? "启用" : "停用"}
        </StatusBadge>
        <Badge variant={isPublic ? "secondary" : "outline"}>
          {isPublic ? "公共客户端" : "机密客户端"}
        </Badge>
        <span className="text-body-sm text-muted-foreground">
          {client.redirectUris.length} 个回调
        </span>
      </div>
    </Card>
  );
}

/** 占位卡：这个渠道还没有凭据。灰、虚线、不可点。 */
function ReservedClientCard({ channel }: { readonly channel: string }) {
  return (
    <Card className="flex min-w-0 flex-col gap-sm border-dashed bg-muted/20 p-md">
      <div className="flex min-w-0 items-center gap-sm">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/50">
          <Icon
            name="fingerprint"
            size="sm"
            aria-hidden="true"
            className="text-muted-foreground/50"
          />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-body-sm text-muted-foreground">
            未注册
          </span>
          <span className="text-label-sm text-muted-foreground/70">
            {CHANNEL_LABEL[channel] ?? channel}
          </span>
        </span>
      </div>
      <span className="text-body-sm text-muted-foreground/70">
        保存本页后在「接入凭据」页注册，会自动关联。
      </span>
    </Card>
  );
}

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
  /**
   * 接入凭据抽屉。
   *
   * owner 2026-09-11:「接入凭据，需要跳转，导致本页内容未保存，全部丢失……
   * **切记不能跳转**。」原来那一节里有个「去凭据页」按钮，点下去这一页填了一半的
   * 东西就没了——而运营者刚配完域名、正准备配凭据，恰恰是改动最多的时刻。
   *
   * 客户端本来就是**按 productId 自动关联**的（注册时就挂在产品上），所以这一页
   * 只需要能看见它们；真要新建，保存完这一页之后再去凭据页，回来会自动关联。
   */
  const [credOpen, setCredOpen] = useState(false);
  /**
   * 正在编辑的客户端。
   *
   * 展示物（授权页的名字与 logo）与回调白名单**分开两个动作**：前者改错了顶多难看，
   * 后者能往白名单里加一个地址就能把授权码导走。服务端也是两个路由，后者挂 step-up。
   */
  const [editClient, setEditClient] = useState<ClientLite | null>(null);
  const [clientDraft, setClientDraft] = useState({
    displayName: "",
    logoUrl: "",
  });
  const [savingClient, setSavingClient] = useState(false);
  const [uploadingIcon, setUploadingIcon] = useState(false);

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
        /* 产品码不可改，但仍然送过去：本页发布时线上可能还是旧 BFF（那版的 PUT
           必填它）。服务端的 UPDATE 不会把它写进 SET 列表，所以送了也改不动。 */
        productCode: product.productCode,
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
        const meta = FIELD_META[field];
        toast({
          tone: "danger",
          /* 点名。「保存失败」谁都知道，要答的是「哪一个」。 */
          title: meta ? `${meta.label}：请修正` : "保存失败",
          description: message,
        });
        /* 滚到视野中央并聚焦。标红只有在看得见时才有用——出错的框常在视口之外。
           下一帧再找：setErrors 刚触发一次渲染，这一拍 DOM 还没更新到红态。 */
        if (meta) {
          requestAnimationFrame(() => {
            const el = document.getElementById(meta.inputId);
            el?.scrollIntoView({ block: "center", behavior: "smooth" });
            el?.focus({ preventScroll: true });
          });
        }
      } else {
        toast({ tone: "danger", title: "保存失败", description: message });
      }
    } finally {
      setSaving(false);
    }
  }

  /**
   * 上传产品图标。走 base64 JSON，不走 multipart——平台没有文件中间件，而图标是
   * 几十 KB 的小文件，`FileReader` 读成 base64 直接发即可。
   *
   * 本地先判尺寸与类型，不是替代服务端校验（那边也判、库上还有 CHECK），是为了
   * **不让人等一次上传再被拒**——一张 3MB 的图 base64 之后是 4MB，发上去再退回来
   * 是纯粹的浪费。
   */
  async function uploadIcon(file: File) {
    if (!product) return;
    if (!ICON_ACCEPT.includes(file.type)) {
      toast({
        tone: "danger",
        title: "图片格式不支持",
        description: "只收 PNG / WebP / JPEG。SVG 不收——矢量请先栅格化。",
      });
      return;
    }
    if (file.size > ICON_MAX_BYTES) {
      toast({
        tone: "danger",
        title: "图片太大",
        description: `不能超过 ${Math.floor(ICON_MAX_BYTES / 1024)}KB，当前 ${Math.ceil(file.size / 1024)}KB。`,
      });
      return;
    }
    setUploadingIcon(true);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onerror = () => reject(new Error("读取文件失败"));
        /* readAsDataURL 给的是 `data:image/png;base64,xxx`，只要逗号之后那段。 */
        fr.onload = () => resolve(String(fr.result ?? "").split(",")[1] ?? "");
        fr.readAsDataURL(file);
      });
      await api.put(`/api/products/${product.id}/icon`, {
        mimeType: file.type,
        dataBase64,
      });
      toast({ tone: "success", title: "图标已更新" });
      await reload();
    } catch (error) {
      toast({
        tone: "danger",
        title: "上传失败",
        description: reason(error, "上传失败"),
      });
    } finally {
      setUploadingIcon(false);
    }
  }

  async function removeIcon() {
    if (!product) return;
    setUploadingIcon(true);
    try {
      await api.delete(`/api/products/${product.id}/icon`);
      toast({ tone: "success", title: "图标已移除，回落到产品字母牌" });
      await reload();
    } catch (error) {
      toast({
        tone: "danger",
        title: "移除失败",
        description: reason(error, "移除失败"),
      });
    } finally {
      setUploadingIcon(false);
    }
  }

  async function saveClientDisplay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editClient) return;
    setSavingClient(true);
    try {
      await api.patch(
        `/api/oidc-clients/${encodeURIComponent(editClient.clientId)}`,
        {
          displayName: clientDraft.displayName.trim() || null,
          logoUrl: clientDraft.logoUrl.trim() || null,
        },
      );
      toast({ tone: "success", title: `${editClient.clientId} 已更新` });
      setEditClient(null);
      await reload();
    } catch (error) {
      toast({
        tone: "danger",
        title: "保存失败",
        description: reason(error, "保存失败"),
      });
    } finally {
      setSavingClient(false);
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
              ? `目录里没有产品码「${productCode}」。`
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
                  label="产品代码"
                  help="登记后不可改。要换须登记新产品。"
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
                  id="pd-icon"
                  label="产品图标"
                  group
                  help="PNG / WebP / JPEG，不超过 256KB。不传则 console 显示产品名首字母。"
                >
                  <div className="flex items-center gap-sm">
                    {/* 预览：地址带版本号，换图会换地址，所以不会显示到旧图。 */}
                    {product?.iconVersion ? (
                      <img
                        src={`/api/products/${encodeURIComponent(product.id)}/icon?v=${encodeURIComponent(product.iconVersion)}`}
                        alt=""
                        aria-hidden="true"
                        className="size-control-md shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="flex size-control-md shrink-0 items-center justify-center rounded-lg bg-muted text-label-sm text-muted-foreground"
                      >
                        {(product?.productName ?? "").slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    {canManage ? (
                      <>
                        {/* 藏 input、用 label 触发按钮那一套已收进 DS 12.7.0 的
                            FileTrigger——这里原本是手写的一份，`ds/no-native-primitive`
                            拦下了它。 */}
                        <FileTrigger
                          accept={ICON_ACCEPT.join(",")}
                          disabled={uploadingIcon}
                          onSelect={(files) => {
                            const f = files[0];
                            if (f) void uploadIcon(f);
                          }}
                        >
                          {uploadingIcon ? "上传中…" : "上传图标"}
                        </FileTrigger>
                        {product?.iconVersion ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="md"
                            disabled={uploadingIcon}
                            onClick={() => void removeIcon()}
                          >
                            移除
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
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

                <FormField id="pd-nick" label="英文名称" help="外文名或简称。">
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

                <FormField id="pd-origin" label="接入来源">
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

                <FormField id="pd-desc" label="产品介绍" full>
                  <Textarea
                    id="pd-desc"
                    rows={2}
                    maxLength={100}
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
              {/* 左「可见性」右「终端支持」，各自纵向排列。两边都是开关行，所以
               **用同一个件渲染**——owner:「现在都是选择，样式需要一致」。 */}
              <FieldGrid>
                <div className="flex min-w-0 flex-col gap-sm">
                  <p className="text-label-sm font-normal text-muted-foreground">
                    可见性
                  </p>
                  <ToggleRow
                    id="pd-customer"
                    label="客户域"
                    help="关掉后，这个产品在 console 与官网都不出现。"
                    checked={draft?.isCustomerVisible ?? false}
                    disabled={!canManage}
                    onChange={(v) =>
                      draft && setDraft({ ...draft, isCustomerVisible: v })
                    }
                  />
                  <ToggleRow
                    id="pd-workforce"
                    label="运营域"
                    help="admin / opera 里是否列出它。"
                    checked={draft?.isWorkforceVisible ?? false}
                    disabled={!canManage}
                    onChange={(v) =>
                      draft && setDraft({ ...draft, isWorkforceVisible: v })
                    }
                  />
                </div>

                <div className="flex min-w-0 flex-col gap-sm">
                  <p className="text-label-sm font-normal text-muted-foreground">
                    终端支持
                  </p>
                  {PRODUCT_SURFACE_DEFS.map((d) => (
                    <ToggleRow
                      key={d.value}
                      id={`pd-surface-${d.value}`}
                      label={productSurfaceLabel(d.value, typeLocale)}
                      checked={draft?.surfaces.includes(d.value) ?? false}
                      disabled={!canManage}
                      onChange={(v) => toggleSurface(d.value, v)}
                    />
                  ))}
                </div>
              </FieldGrid>
            </SectionBody>
          </Section>

          {/* ── 接入凭据 ─────────────────────────────────────────────────── */}

          {/* ── 边缘路由与回调 ───────────────────────────────────────────── */}
          <Section icon="plug" title="边缘路由与回调" level={2}>
            <SectionBody>
              <FieldGrid>
                <FormField
                  id="pd-domain"
                  label="边缘域名"
                  error={errors["edgeDomain"]}
                  help="按产品码预填，可改。DNS 记录需自行创建。"
                >
                  <CopyableInput
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
                  help="host:port，不带协议或路径。留空则不进边缘路由表。"
                >
                  <CopyableInput
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
                  help="http / https 绝对地址。留空即撤销登记。"
                >
                  <CopyableInput
                    id="pd-callback"
                    value={whDraft?.webhookUrl ?? ""}
                    disabled={!canManage}
                    aria-invalid={!!errors["webhookUrl"]}
                    placeholder={`https://${whDraft?.edgeDomain || `${product?.productCode ?? "acme"}.vxture.com`}/webhooks/vxture`}
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
                      ? "已登记。留空则不改动。"
                      : "至少 16 位。保存后只显示一次。"
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
                  help="展示用。"
                >
                  <CopyableInput
                    id="pd-home"
                    value={whDraft?.homeUrl ?? ""}
                    disabled={!canManage}
                    aria-invalid={!!errors["homeUrl"]}
                    placeholder={`https://${whDraft?.edgeDomain || `${product?.productCode ?? "acme"}.vxture.com`}`}
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
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCredOpen(true)}
                >
                  <Icon name="fingerprint" size="xs" aria-hidden="true" />
                  接入凭据
                  <Badge variant="outline">{clients.length}</Badge>
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
            description="读不到不等于通过。请先解决读取失败。"
          />
        ) : (
          <div className="flex flex-col gap-md">
            {pendingRequired.length > 0 ? (
              <Banner
                tone="warning"
                title={`还有 ${pendingRequired.length} 项必填检查未满足`}
                description="带「复验判定」的几项去跑一次上线复验即可。"
              />
            ) : (
              <Banner
                tone="success"
                title="必填项已齐"
                description="可以确认上线。"
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
            {/* 这里原本有个「去跑一次复验」的跳转。跳走同样会丢掉本页未保存的
                改动,而抽屉是在配置中途打开的——去掉。复验在保存之后从目录页进。 */}
          </div>
        )}
      </Drawer>

      {/* ── 接入凭据抽屉 ───────────────────────────────────────────────── */}
      <Drawer
        open={credOpen}
        onClose={() => setCredOpen(false)}
        width="md"
        title="接入凭据"
        description={product?.productCode}
      >
        <div className="grid gap-md md:grid-cols-2">
          {clients.map((c) => (
            <ClientCard
              key={c.clientId}
              client={c}
              canManage={canManage}
              onEdit={() => {
                setEditClient(c);
                setClientDraft({
                  displayName: c.displayName ?? "",
                  logoUrl: c.logoUrl ?? "",
                });
              }}
            />
          ))}
          {/* 预留位:渠道是 stable / beta / canary,而绝大多数产品先有 stable。
              给缺席的渠道留一张灰卡,让「还没建」这件事在版面上占位——否则一个
              只有 stable 的产品看起来像「就该只有一个」。 */}
          {RESERVED_CHANNELS.filter(
            (ch) => !clients.some((c) => c.releaseChannel === ch),
          ).map((ch) => (
            <ReservedClientCard key={ch} channel={ch} />
          ))}
        </div>
      </Drawer>

      {/* ── 凭据展示物编辑 ─────────────────────────────────────────────────
          只改授权页的名字与 logo。回调白名单不在这里——它是安全边界，服务端那条
          路由挂着 step-up，要另做一个动作。 */}
      <DialogForm
        size="lg"
        open={editClient !== null}
        onOpenChange={(open) => {
          if (!open) setEditClient(null);
        }}
        title={editClient ? `${editClient.clientId} · 授权页展示` : ""}
        description="客户在授权页与登出页看到的名字和图标。"
        submitLabel={tShared("common.save")}
        submitting={savingClient}
        onSubmit={saveClientDisplay}
      >
        <FieldGrid>
          <FormField
            id="cl-display"
            label="展示名"
            help="留空则显示 client_id。"
          >
            <Input
              id="cl-display"
              value={clientDraft.displayName}
              onChange={(e) =>
                setClientDraft({ ...clientDraft, displayName: e.target.value })
              }
            />
          </FormField>
          <FormField id="cl-logo" label="Logo 地址">
            <CopyableInput
              id="cl-logo"
              value={clientDraft.logoUrl}
              placeholder={`https://${product?.productCode ?? "acme"}.vxture.com/logo.svg`}
              className="font-mono text-code-sm"
              onChange={(e) =>
                setClientDraft({ ...clientDraft, logoUrl: e.target.value })
              }
            />
          </FormField>
        </FieldGrid>
      </DialogForm>

      {/* ── 一次性交接清单 ─────────────────────────────────────────────── */}
      <DialogForm
        open={handover !== null}
        onOpenChange={(open) => {
          if (!open) setHandover(null);
        }}
        title="交接清单"
        description="下面这些要交给产品侧。"
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
          description="关闭后无法再次查看。请立即复制。"
        />
        <Textarea
          readOnly
          rows={5}
          value={(handover ?? []).join("\n")}
          className="font-mono text-code-sm"
          onFocus={(e) => e.currentTarget.select()}
        />
        {/* 这一份关掉就再也拿不到，而它正是要被粘进一封邮件的东西。
            凭据页那个明文框一直有复制按钮，这里漏了。 */}
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void navigator.clipboard
              .writeText((handover ?? []).join("\n"))
              .then(
                () => toast({ tone: "success", title: "已复制交接清单" }),
                () => undefined,
              );
          }}
        >
          <Icon name="copy" size="sm" aria-hidden="true" />
          复制全部
        </Button>
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
