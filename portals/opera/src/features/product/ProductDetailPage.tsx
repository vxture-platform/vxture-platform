"use client";

/**
 * ProductDetailPage.tsx — 一个产品的接入：新建与配置都在这一页。
 * @package @vxture/opera
 * @layer Presentation
 * @category Features - Product
 *
 * ── 2026-09-14：客户端注册并进来，密钥单独成面板 ──
 * owner:「产品接入页面，注册客户端需要填写的信息是不是都整合在产品接入的新建/配置页面，
 * 除了需要单独的密钥管理可以弹出单独面板，现在分散且重复。」
 *
 * 在这之前，接一个产品要走五个入口：目录页「登记产品」弹窗、本页「保存设置」、接入凭据页
 * 「注册客户端」、本页凭据抽屉里的「回调地址」与「授权页展示」两个弹窗。tenderforge 上线
 * 那天卡在的正是这里——回调地址登记错了，而改它的入口藏在抽屉里一枚图标按钮后面。
 *
 * 现在：
 *  - **新建与配置同一张页**（`/product/catalog/new` 与 `/product/catalog/:code`）。
 *  - **登录接入**是页内一个板块（`LoginClientsSection`）：每个渠道一组字段。
 *  - **一次保存一个事务**（`POST /api/products/onboarding` · `PUT /api/products/:id/onboarding`）：
 *    产品、边缘与回调、客户端要么一起生效要么都不生效。此前是两次串行 PUT 加三个弹窗。
 *    触及安全边界（回调 / 登出回跳白名单、scopes、PKCE、签发新客户端）时服务端要求二次验证，
 *    `runWithStepUp` 跑完仪式后重发同一个请求；只改名字不打扰。
 *  - **密钥只在「密钥管理」面板里动**（`SecretsDrawer`）：轮换 client_secret、登记 webhook
 *    签名密钥与引用。明文只出现一次。
 *  - **接入检查**抽屉（`LaunchDrawer`）接管了原「产品上线」页：复验、检查单、交给对方、确认上线。
 *
 * ── 2026-09-11 走查定下的排布（仍然有效）──
 *  1. 右侧摘要栏去掉，页面全宽，信息归到它所属的板块。
 *  2. 字段一律上下结构，说明收进帮助图标（`DetailForm.tsx`）。
 *  3. 板块内容与标题文字对齐，不顶头。
 *  5. 检查做成抽屉，按钮激活，不在页面底部堆信息。
 *  6. 底部统一操作区，上方一条分割线。
 *  7. 身份与可见性拆成两个板块。
 *  8. 名称用行业术语，标签抄目录页既有的那套词。
 *  9. 校验失败把对应的框染红，toast 点名，并滚到那个框。
 *
 * **不跳转**（owner 2026-09-11：「切记不能跳转」）：页面上的一切去处——检查项的「去处理」、
 * 密钥面板——都在本页就地打开。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  ActionMenu,
  Banner,
  Badge,
  Button,
  DetailList,
  DetailRow,
  DialogForm,
  EmptyState,
  FileTrigger,
  Icon,
  Input,
  NativeSelect,
  Section,
  SectionHeader,
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
import { isStepUpCancelled, useStepUp } from "@/features/stepup/StepUpProvider";
import { LockedInput } from "@/components/form/LockedInput";
import { actionsFor, gatesLaunch, type ProductAction } from "./lifecycle";
import {
  CopyableInput,
  FieldGrid,
  FormField,
  SectionBody,
  ToggleRow,
} from "./DetailForm";
import { LaunchDrawer, type ChecklistEntry } from "./LaunchDrawer";
import { LoginClientsSection, clientFieldId } from "./LoginClientsSection";
import { ProductMetricsSection } from "./ProductMetricsSection";
import { SecretsDrawer } from "./SecretsDrawer";
import {
  clientInputFrom,
  draftFromClient,
  type ClientDraft,
  type ClientRecord,
  type ClientState,
  type WebhookRecord,
} from "./onboarding-model";

const MANAGE = "integration:product.manage";

/** 与 BFF、库上的 CHECK 同一套。不收 SVG——它可以带脚本。 */
const ICON_ACCEPT = ["image/png", "image/webp", "image/jpeg"];
const ICON_MAX_BYTES = 262144;

/** 边缘与回调里固定的回调路径（通则 §C3 下发：所有产品同一个，变的只有域名）。 */
const WEBHOOK_PATH = "/api/webhooks/vxture";

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
  categoryId: number | null;
  standaloneSubscribable: boolean;
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

interface CategoryLite {
  id: number;
  name: string;
}

/** 合并保存的回包（opera-bff `OnboardingResult`）。 */
interface OnboardingResult {
  product: ProductRecord & { pinnedEdgeDomain?: string };
  clients: ClientRecord[];
  /** 本次新签发的 client_secret，只此一次。 */
  issuedSecrets: { clientId: string; clientSecret: string }[];
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
  /** 新建时直接填；草稿态可改（owner 2026-09-11），启用后由 BFF 锁死。 */
  productCode: string;
  categoryId: string;
  standaloneSubscribable: boolean;
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

/** 新产品的起点。端默认只勾网页端——那是所有产品都成立的那一个，其余按需加。 */
const EMPTY_DRAFT: ProductDraft = {
  productCode: "",
  categoryId: "",
  standaloneSubscribable: true,
  productName: "",
  productNick: "",
  description: "",
  productType: "",
  origin: "self",
  originProvider: "",
  isCustomerVisible: true,
  isWorkforceVisible: true,
  surfaces: ["web"] as ProductSurface[],
  iconUrl: "",
};

function draftFromProduct(p: ProductRecord): ProductDraft {
  return {
    productCode: p.productCode,
    categoryId: p.categoryId == null ? "" : String(p.categoryId),
    standaloneSubscribable: p.standaloneSubscribable,
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
  };
}

/** 边缘与回调里**不是密钥**的那四项。签名密钥在「密钥管理」面板。 */
interface EdgeDraft {
  edgeDomain: string;
  edgeUpstream: string;
  webhookUrl: string;
  homeUrl: string;
}

/** 字段级错误：键是 BFF 回的 `field`，值是它给的消息。 */
type FieldErrors = Record<string, string>;

/**
 * BFF 的 `field` → 界面上的标签与输入框 id。
 *
 * owner 2026-09-11:「保存失败，提示字段标红了，但是没看到，直接提示哪个字段。」
 * 所以两件一起做：**toast 直接点名**，并把那个框**滚到视野中央并聚焦**。
 * 客户端字段按 `clients[i].field` 另算（见 `fieldMeta`）。
 */
const FIELD_META: Record<string, { label: string; inputId: string }> = {
  productCode: { label: "产品代码", inputId: "pd-code" },
  categoryId: { label: "产品分类", inputId: "pd-category" },
  productName: { label: "产品名称", inputId: "pd-name" },
  productType: { label: "产品类型", inputId: "pd-type" },
  originProvider: { label: "供应方", inputId: "pd-provider" },
  productNick: { label: "英文名称", inputId: "pd-nick" },
  description: { label: "产品介绍", inputId: "pd-desc" },
  iconUrl: { label: "产品图标", inputId: "pd-icon" },
  edgeDomain: { label: "边缘域名", inputId: "pd-domain" },
  edgeUpstream: { label: "边缘上游", inputId: "pd-upstream" },
  webhookUrl: { label: "回调地址", inputId: "pd-callback" },
  homeUrl: { label: "产品主页", inputId: "pd-home" },
};

const CLIENT_FIELD_LABEL: Record<string, string> = {
  clientId: "client_id",
  releaseChannel: "渠道",
  tokenEndpointAuthMethod: "认证方式",
  redirectUris: "登录回调地址",
  postLogoutRedirectUris: "登出回跳地址",
  displayName: "展示名",
  logoUrl: "Logo 地址",
  allowedScopes: "Scopes",
  pkceRequired: "PKCE",
};

export function ProductDetailPage({
  productCode,
}: {
  /** null = 新建（`/product/catalog/new`）。 */
  productCode: string | null;
}) {
  const isCreate = productCode === null;
  const tShared = useTranslations();
  const locale = useLocale();
  /* 查表函数收 "zh" | "en"，next-intl 给的是 zh-CN / en-US。 */
  const typeLocale = locale.startsWith("en") ? "en" : "zh";
  const { toast } = useToast();
  const { can } = useOperatorSession();
  const canManage = can(MANAGE);
  const { runWithStepUp } = useStepUp();
  const router = useRouter();
  const panel = useSearchParams().get("panel");
  /** `?panel=` 与 `#section-` 只在首次读完时处理一次，保存后重读不再弹。 */
  const arrivalHandled = useRef(false);

  const [product, setProduct] = useState<ProductRecord | null>(null);
  const [webhook, setWebhook] = useState<WebhookRecord | null>(null);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [checklist, setChecklist] = useState<ChecklistEntry[]>([]);
  const [categories, setCategories] = useState<CategoryLite[]>([]);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });

  const [draft, setDraft] = useState<ProductDraft | null>(null);
  const [edgeDraft, setEdgeDraft] = useState<EdgeDraft | null>(null);
  const [clientDrafts, setClientDrafts] = useState<ClientDraft[]>([]);
  /** 待确认的新产品码。非 null 时弹危险确认。 */
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  /** 产品码那一栏解锁了没。放弃 / 重载会回到锁着的默认态。 */
  const [codeUnlocked, setCodeUnlocked] = useState(false);
  /**
   * 产品码能不能改：新建时直接填；草稿态可改，启用之后锁定（owner 2026-09-11）。
   * 界面这道只是不给改的入口，**判据在 BFF**——它锁行再判状态。
   */
  const codeEditable = canManage && (isCreate || product?.state === "draft");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  /** 一次性交接清单。`next` 非空 = 关掉之后去那个地址（新建完、或改了产品码）。 */
  const [handover, setHandover] = useState<{
    lines: string[];
    next: string | null;
  } | null>(null);
  const [advisory, setAdvisory] = useState<ProductAction | null>(null);
  const [applying, setApplying] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  const [secretsOpen, setSecretsOpen] = useState(false);
  const [busyClientId, setBusyClientId] = useState<string | null>(null);
  const [uploadingIcon, setUploadingIcon] = useState(false);

  const reload = useCallback(async () => {
    setLoad({ kind: "loading" });
    setErrors({});
    /* 重新锁上。`reload` 是「放弃」「保存成功后」「首次加载」共同的入口。 */
    setCodeUnlocked(false);
    try {
      if (productCode === null) {
        const cats = await api
          .get<CategoryLite[]>("/api/products/categories")
          .catch(() => [] as CategoryLite[]);
        setCategories(cats);
        setProduct(null);
        setWebhook(null);
        setClients([]);
        setChecklist([]);
        setDraft(EMPTY_DRAFT);
        setEdgeDraft({
          edgeDomain: "",
          edgeUpstream: "",
          webhookUrl: "",
          homeUrl: "",
        });
        setClientDrafts([]);
        setLoad({ kind: "ready" });
        return;
      }
      const p = await api.get<ProductRecord | null>(
        `/api/products/${encodeURIComponent(productCode)}`,
      );
      if (!p) {
        setLoad({ kind: "missing" });
        return;
      }
      setProduct(p);
      setDraft(draftFromProduct(p));

      /* 附属读并行，且各自失败各自兜：webhook 读不到不该让整页空白。 */
      const [wh, cl, ck, cats] = await Promise.all([
        api
          .get<WebhookRecord | null>(`/api/products/${p.id}/webhook`)
          .catch(() => null),
        api
          .get<ClientRecord[]>(`/api/oidc-clients?productId=${p.id}`)
          .catch(() => [] as ClientRecord[]),
        api
          .get<ChecklistEntry[]>(`/api/products/${p.id}/checklist`)
          .catch(() => [] as ChecklistEntry[]),
        api
          .get<CategoryLite[]>("/api/products/categories")
          .catch(() => [] as CategoryLite[]),
      ]);
      setWebhook(wh);
      setClients(cl);
      setChecklist(ck);
      setCategories(cats);
      setEdgeDraft({
        /* 没登记过就按产品码预填——渲染器本来就会对空值做同一个推导，预填只是把
           这条隐含规则摆到运营者眼前，让异 apex 的产品有地方改。 */
        edgeDomain: wh?.edgeDomain?.trim() || `${p.productCode}.vxture.com`,
        edgeUpstream: wh?.edgeUpstream ?? "",
        webhookUrl: wh?.webhookUrl ?? "",
        homeUrl: wh?.homeUrl ?? "",
      });
      setClientDrafts(cl.map(draftFromClient));
      setLoad({ kind: "ready" });
    } catch (error) {
      setLoad({ kind: "error", message: reason(error, "读取产品失败") });
    }
  }, [productCode]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /* 深链落地：旧「产品上线」页带 `?panel=checks`，接入凭据页带 `#section-login`。
     板块在数据读完之后才渲染，浏览器自己的锚点滚动那一刻找不到它，所以这里补一次。 */
  useEffect(() => {
    if (load.kind !== "ready" || !product || arrivalHandled.current) return;
    arrivalHandled.current = true;
    if (panel === "checks") setCheckOpen(true);
    if (panel === "secrets") setSecretsOpen(true);
    const hash = window.location.hash;
    if (hash.startsWith("#section-")) {
      requestAnimationFrame(() =>
        document
          .getElementById(hash.slice(1))
          ?.scrollIntoView({ block: "start", behavior: "smooth" }),
      );
    }
  }, [load.kind, panel, product]);

  function fieldMeta(
    field: string,
  ): { label: string; inputId: string } | undefined {
    const direct = FIELD_META[field];
    if (direct) return direct;
    const m = /^clients\[(\d+)\]\.(\w+)$/.exec(field);
    if (!m) return undefined;
    const index = Number(m[1]);
    const name = m[2] ?? "";
    const who = clientDrafts[index]?.clientId || `客户端 ${index + 1}`;
    return {
      label: `${who} · ${CLIENT_FIELD_LABEL[name] ?? name}`,
      inputId: clientFieldId(index, name),
    };
  }

  /**
   * 提交闸门。改产品码要先过一道确认——那不是普通字段（owner 2026-09-11：「草稿态有
   * 下游对接了，修改明确提示危险操作，并执行一个关联修改流程完成善后工作」）。
   */
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const next = draft.productCode.trim();
    if (product && codeEditable && next && next !== product.productCode) {
      setPendingCode(next);
      return;
    }
    void doSave();
  }

  async function doSave() {
    if (!draft || !edgeDraft) return;
    setPendingCode(null);
    setSaving(true);
    setErrors({});
    const payload = {
      product: {
        productCode:
          codeEditable || !product
            ? draft.productCode.trim()
            : product.productCode,
        categoryId: draft.categoryId ? Number(draft.categoryId) : null,
        standaloneSubscribable: draft.standaloneSubscribable,
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
      },
      edge: {
        edgeDomain: edgeDraft.edgeDomain.trim() || null,
        edgeUpstream: edgeDraft.edgeUpstream.trim() || null,
        webhookUrl: edgeDraft.webhookUrl.trim() || null,
        homeUrl: edgeDraft.homeUrl.trim() || null,
      },
      clients: clientDrafts.map(clientInputFrom),
    };
    try {
      /* 触及安全边界时服务端回 403 step_up_required，`runWithStepUp` 跑完仪式后重发
       **同一个请求**——判定在服务端任何写之前，不存在「前半截已写」。 */
      const result = await runWithStepUp(() =>
        product
          ? api.put<OnboardingResult>(
              `/api/products/${product.id}/onboarding`,
              payload,
            )
          : api.post<OnboardingResult>("/api/products/onboarding", payload),
      );
      /* 新建完、或改了产品码：本页地址按旧码寻址，得换到新地址去。 */
      const next =
        !product || result.product.productCode !== product.productCode
          ? `/product/catalog/${encodeURIComponent(result.product.productCode)}`
          : null;

      if (result.issuedSecrets.length > 0) {
        /* 一次性交接：签发了新客户端才弹。明文关掉就再也拿不到。 */
        setHandover({
          next,
          lines: result.issuedSecrets.flatMap((s, i) => {
            const c = result.clients.find((x) => x.clientId === s.clientId);
            return [
              ...(i > 0 ? [""] : []),
              `client_id：${s.clientId}`,
              `client_secret：${s.clientSecret}`,
              ...(c ? [`登录回调地址：${c.redirectUris.join("、")}`] : []),
            ];
          }),
        });
        return;
      }
      toast({
        tone: "success",
        title: product
          ? "已保存"
          : `${result.product.productCode} 已登记（草稿）`,
        ...(result.product.pinnedEdgeDomain
          ? {
              description: `产品码已改，边缘域名钉在 ${result.product.pinnedEdgeDomain}，路由不变。`,
            }
          : {}),
      });
      if (next) {
        router.replace(next);
        return;
      }
      await reload();
    } catch (error) {
      /* 取消仪式不是失败——弹一句「保存失败」会让人以为点错了什么。 */
      if (isStepUpCancelled(error)) return;
      const field = error instanceof OperaApiError ? error.field : undefined;
      const message = reason(error, "保存失败");
      if (field) {
        setErrors({ [field]: message });
        const meta = fieldMeta(field);
        toast({
          tone: "danger",
          /* 点名。「保存失败」谁都知道，要答的是「哪一个」。 */
          title: meta ? `${meta.label}：请修正` : "保存失败",
          description: message,
        });
        /* 下一帧再找：setErrors 刚触发一次渲染，这一拍 DOM 还没更新到红态。 */
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

  function closeHandover() {
    const next = handover?.next ?? null;
    setHandover(null);
    if (next) {
      router.replace(next);
    } else {
      void reload();
    }
  }

  /**
   * 上传产品图标。走 base64 JSON，不走 multipart——平台没有文件中间件，而图标是
   * 几十 KB 的小文件。本地先判尺寸与类型，不让人等一次上传再被拒。
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

  /**
   * 启用 / 停用一个客户端。**即时生效、不走「保存设置」**：它是一个开关动作，不是一项配置。
   * 只改本地那一行的状态，不重读——重读会冲掉页面上别的没保存的改动。
   */
  async function toggleClientState(clientId: string, next: ClientState) {
    setBusyClientId(clientId);
    try {
      await api.post(
        `/api/oidc-clients/${encodeURIComponent(clientId)}/${next === "active" ? "activate" : "deactivate"}`,
      );
      setClients((cs) =>
        cs.map((c) => (c.clientId === clientId ? { ...c, state: next } : c)),
      );
      setClientDrafts((ds) =>
        ds.map((d) =>
          d.clientId === clientId && !d.isNew ? { ...d, state: next } : d,
        ),
      );
      toast({
        tone: "success",
        title: `${clientId} 已${next === "active" ? "启用" : "停用"}`,
      });
    } catch (error) {
      toast({
        tone: "danger",
        title: "操作失败",
        description: reason(error, "操作失败"),
      });
    } finally {
      setBusyClientId(null);
    }
  }

  /**
   * 检查项的「去处理」。`#secrets` 打开密钥面板，`#section-*` 滚到本页板块，其它新标签页
   * 打开——都不离开这一页。
   */
  function goto(href: string) {
    if (href === "#secrets") {
      setCheckOpen(false);
      setSecretsOpen(true);
      return;
    }
    if (href.startsWith("#")) {
      setCheckOpen(false);
      requestAnimationFrame(() =>
        document
          .getElementById(href.slice(1))
          ?.scrollIntoView({ block: "start", behavior: "smooth" }),
      );
      return;
    }
    window.open(href, "_blank", "noopener,noreferrer");
  }

  async function applyLifecycle(action: ProductAction) {
    if (!product) return;
    setApplying(true);
    try {
      /* 状态迁移（上线 / 停用 / 恢复 / 退役）服务端挂了 step-up，回 403
         后跑完仪式重发同一个请求。确认框另在菜单侧（advisory / destructive）
         ——身份与意图是两道门。 */
      await runWithStepUp(() =>
        api.patch(`/api/products/${product.id}/state`, {
          state: action.to,
        }),
      );
      toast({
        tone: "success",
        title: `${product.productName} · ${action.label}`,
      });
      await reload();
    } catch (error) {
      /* 取消仪式不是失败：什么都没发生，不该弹红。 */
      if (isStepUpCancelled(error)) return;
      /* 判码不判文案。几种拒绝各有各的下一步。 */
      const code = error instanceof OperaApiError ? error.code : undefined;
      if (code === "CATALOG_LAUNCH_CHECKLIST_PENDING") {
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
  /* 徽标上的「还差几项」只数卡上线的那些（`gate = 'launch'`）——发布门的项
     （`acceptance`）没勾不代表这个产品上不了线，数进去会把人引向错误的下一步。 */
  const pendingRequired = checklist.filter(
    (i) => i.isRequired && gatesLaunch(i) && !i.isSatisfied,
  );
  const derivedDomain = `${draft?.productCode.trim() || product?.productCode || "acme"}.vxture.com`;
  const domainForHints = edgeDraft?.edgeDomain.trim() || derivedDomain;

  /* 授权三处各管一段：权益配置看合集，路由 / 能力各去自己的域页（带上本产品筛选）。 */
  const productJumps = product
    ? [
        {
          id: "entitlements",
          label: "权益配置",
          icon: "ticket" as const,
          onSelect: () =>
            router.push(
              "/product/entitlements?productCode=" +
                encodeURIComponent(product.productCode),
            ),
        },
        {
          id: "model-grants",
          label: "模型授权",
          icon: "plug" as const,
          onSelect: () =>
            router.push(
              "/model/grants?productCode=" +
                encodeURIComponent(product.productCode),
            ),
        },
        {
          id: "capability-grants",
          label: "能力授权",
          icon: "shield" as const,
          onSelect: () =>
            router.push(
              "/capability/grants?productCode=" +
                encodeURIComponent(product.productCode),
            ),
        },
      ]
    : [];

  const header = (
    <ViewHeader
      icon="package"
      title={
        isCreate ? "接入产品" : (product?.productName ?? productCode ?? "")
      }
      description={
        isCreate
          ? "登记、边缘与回调、登录客户端一次填完。保存后是草稿，跑通接入检查再上线。"
          : (product?.productCode ?? undefined)
      }
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
          {/* 常用操作提到头部（owner 2026-09-16「操作区减得太过分」）：页面很长，
              底部那组按钮要滚到底才看得到。底部的保留，两处打开的是同一个抽屉。 */}
          {product ? (
            <>
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
                onClick={() => setSecretsOpen(true)}
              >
                <Icon name="key" size="xs" aria-hidden="true" />
                密钥管理
              </Button>
            </>
          ) : null}
          {product ? (
            <ActionMenu
              label={`${product.productName} 操作`}
              disabled={applying}
              items={[
                ...productJumps,
                ...(canManage ? lifecycleActions : []).map((action, index) =>
                  action.id === "launch"
                    ? {
                        /* 上线只有一条路：接入检查抽屉里的「确认上线」，它会先重跑复验。
                         菜单里这一项把抽屉打开，而不是另走一遍没有复验的状态切换。 */
                        id: action.id,
                        separatorBefore: index === 0,
                        label: action.label,
                        icon: action.icon,
                        onSelect: () => setCheckOpen(true),
                      }
                    : action.danger
                      ? {
                          id: action.id,
                          separatorBefore: index === 0,
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
                            separatorBefore: index === 0,
                            label: action.label,
                            icon: action.icon,
                            onSelect: () => setAdvisory(action),
                          }
                        : {
                            id: action.id,
                            separatorBefore: index === 0,
                            label: action.label,
                            icon: action.icon,
                            onSelect: () => void applyLifecycle(action),
                          },
                ),
              ]}
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
              ? `目录里没有产品码「${productCode ?? ""}」。`
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
      <ViewLayout>
        {header}
        <form onSubmit={save} className="flex min-w-0 flex-col gap-2xl">
          {/* ── 基本信息 ─────────────────────────────────────────────────── */}
          <div id="section-basic">
            <Section icon="database" title="基本信息" level={2}>
              <SectionBody>
                <FieldGrid>
                  <FormField
                    id="pd-code"
                    label="产品代码"
                    required={codeEditable}
                    error={errors["productCode"]}
                    help={
                      isCreate
                        ? "产品在平台内外的身份：授权主体、S2S 令牌的 act.sub、默认边缘域名都按它走。小写字母、数字与连字符。"
                        : codeEditable
                          ? "草稿状态可以改，点「修改」解锁；启用之后彻底锁定。改动会同时处理已经按这个码建立的配置。"
                          : "已启用，不可再改。它的客户端配置、边缘路由与已售订阅都按这个码在走。"
                    }
                  >
                    {/* 三态（新建另算）。owner 2026-09-11：「给所有锁定条目，增加修改按钮
                        激活修改，防止误操作」「在已发布产品，该按钮隐藏，直接锁定无法修改」。 */}
                    {isCreate || (codeEditable && codeUnlocked) ? (
                      <Input
                        id="pd-code"
                        value={draft?.productCode ?? ""}
                        autoFocus={!isCreate}
                        disabled={!canManage}
                        aria-invalid={!!errors["productCode"]}
                        className="font-mono text-code-sm"
                        onChange={(e) =>
                          draft &&
                          setDraft({ ...draft, productCode: e.target.value })
                        }
                      />
                    ) : (
                      <LockedInput
                        id="pd-code"
                        locked
                        value={draft?.productCode ?? product?.productCode ?? ""}
                        className="font-mono text-code-sm"
                        {...(codeEditable
                          ? { onUnlock: () => setCodeUnlocked(true) }
                          : {})}
                      />
                    )}
                  </FormField>

                  <FormField
                    id="pd-category"
                    label="产品分类"
                    error={errors["categoryId"]}
                    help="目录归属。不选则归入未分类。"
                  >
                    <NativeSelect
                      id="pd-category"
                      value={draft?.categoryId ?? ""}
                      disabled={!canManage}
                      aria-invalid={!!errors["categoryId"]}
                      onChange={(e) =>
                        draft &&
                        setDraft({ ...draft, categoryId: e.target.value })
                      }
                    >
                      <option value="">未分类</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormField>

                  <FormField
                    id="pd-icon"
                    label="产品图标"
                    group
                    help="PNG / WebP / JPEG，不超过 256KB。不传则 console 显示产品名首字母。"
                  >
                    {product ? (
                      <div className="flex items-center gap-sm">
                        {/* 预览：地址带版本号，换图会换地址，所以不会显示到旧图。 */}
                        {product.iconVersion ? (
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
                            {product.productName.slice(0, 2).toUpperCase()}
                          </span>
                        )}
                        {canManage ? (
                          <>
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
                            {product.iconVersion ? (
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
                    ) : (
                      <p className="text-body-sm text-muted-foreground">
                        保存后可以上传。
                      </p>
                    )}
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
                    label="英文名称"
                    help="外文名或简称。"
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
                      {isCreate ? <option value="">请选择</option> : null}
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

                {product ? (
                  <p className="text-body-sm text-muted-foreground">
                    创建于 {formatDateTime(product.createdAt, locale)} ·
                    最近更新 {formatDateTime(product.updatedAt, locale)}
                  </p>
                ) : null}
              </SectionBody>
            </Section>
          </div>

          {/* ── 可见性与终端 ─────────────────────────────────────────────── */}
          <div id="section-visibility">
            <Section icon="eye" title="可见性与终端" level={2}>
              <SectionBody>
                <FieldGrid>
                  <div className="flex min-w-0 flex-col gap-sm">
                    <SectionHeader level={4} title="可见性" />
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
                    <ToggleRow
                      id="pd-standalone"
                      label="可独立订阅"
                      help="关掉后只能随套餐捆绑售卖，不单独出现在订阅页。"
                      checked={draft?.standaloneSubscribable ?? false}
                      disabled={!canManage}
                      onChange={(v) =>
                        draft &&
                        setDraft({ ...draft, standaloneSubscribable: v })
                      }
                    />
                  </div>

                  <div className="flex min-w-0 flex-col gap-sm">
                    <SectionHeader level={4} title="终端支持" />
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
          </div>

          {/* ── 边缘路由与回调 ───────────────────────────────────────────── */}
          <div id="section-edge">
            <Section icon="plug" title="边缘路由与回调" level={2}>
              <SectionBody>
                <FieldGrid>
                  <FormField
                    id="pd-domain"
                    label="边缘域名"
                    error={errors["edgeDomain"]}
                    help="留空则按产品码推导。异 apex 的产品在这里改。DNS 记录需自行创建。"
                  >
                    <CopyableInput
                      id="pd-domain"
                      value={edgeDraft?.edgeDomain ?? ""}
                      disabled={!canManage}
                      aria-invalid={!!errors["edgeDomain"]}
                      placeholder={derivedDomain}
                      className="font-mono text-code-sm"
                      onChange={(e) =>
                        edgeDraft &&
                        setEdgeDraft({
                          ...edgeDraft,
                          edgeDomain: e.target.value,
                        })
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
                      value={edgeDraft?.edgeUpstream ?? ""}
                      disabled={!canManage}
                      aria-invalid={!!errors["edgeUpstream"]}
                      placeholder="<tailnet-ip>:4050"
                      className="font-mono text-code-sm"
                      onChange={(e) =>
                        edgeDraft &&
                        setEdgeDraft({
                          ...edgeDraft,
                          edgeUpstream: e.target.value,
                        })
                      }
                    />
                  </FormField>

                  <FormField
                    id="pd-callback"
                    label="回调地址"
                    error={errors["webhookUrl"]}
                    help={`平台向产品投递开通 / 停用事件的地址。路径固定为 ${WEBHOOK_PATH}（所有产品同一个，变的只有域名）。留空即撤销登记。签名密钥在「密钥管理」。`}
                  >
                    <CopyableInput
                      id="pd-callback"
                      value={edgeDraft?.webhookUrl ?? ""}
                      disabled={!canManage}
                      aria-invalid={!!errors["webhookUrl"]}
                      placeholder={`https://${domainForHints}${WEBHOOK_PATH}`}
                      className="font-mono text-code-sm"
                      onChange={(e) =>
                        edgeDraft &&
                        setEdgeDraft({
                          ...edgeDraft,
                          webhookUrl: e.target.value,
                        })
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
                      value={edgeDraft?.homeUrl ?? ""}
                      disabled={!canManage}
                      aria-invalid={!!errors["homeUrl"]}
                      placeholder={`https://${domainForHints}`}
                      className="font-mono text-code-sm"
                      onChange={(e) =>
                        edgeDraft &&
                        setEdgeDraft({ ...edgeDraft, homeUrl: e.target.value })
                      }
                    />
                  </FormField>
                </FieldGrid>
              </SectionBody>
            </Section>
          </div>

          {/* ── 登录接入 ─────────────────────────────────────────────────── */}
          <div id="section-login">
            <Section icon="fingerprint" title="登录接入" level={2}>
              <SectionBody>
                <LoginClientsSection
                  drafts={clientDrafts}
                  onChange={setClientDrafts}
                  errors={errors}
                  canManage={canManage}
                  productCode={draft?.productCode ?? ""}
                  productName={draft?.productName ?? ""}
                  edgeDomain={domainForHints}
                  busyClientId={busyClientId}
                  {...(product
                    ? {
                        onToggleState: (id: string, next: ClientState) =>
                          void toggleClientState(id, next),
                      }
                    : {})}
                />
              </SectionBody>
            </Section>
          </div>

          {/* ── 计量指标 ─────────────────────────────────────────────────── */}
          <div id="section-metrics">
            <Section icon="gauge" title="计量指标" level={2}>
              <SectionBody>
                {product ? (
                  <ProductMetricsSection
                    key={product.id}
                    productId={product.id}
                    productName={product.productName}
                    canManage={canManage}
                  />
                ) : (
                  <p className="text-body-sm text-muted-foreground">
                    保存后配置。指标键是跨仓契约，产品按这个键上报用量。
                  </p>
                )}
              </SectionBody>
            </Section>
          </div>

          {/* ── 底部操作区 ─────────────────────────────────────────────────
              owner：上方一条分割线，放弃 / 接入检查 / 保存设置都在这里。 */}
          <div className="flex flex-col gap-lg">
            <Separator />
            <div className="flex flex-wrap items-center justify-between gap-md">
              <div className="flex items-center gap-sm">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!product}
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
                  disabled={!product}
                  onClick={() => setSecretsOpen(true)}
                >
                  <Icon name="key" size="xs" aria-hidden="true" />
                  密钥管理
                </Button>
                {!product ? (
                  <span className="text-body-sm text-muted-foreground">
                    保存后可用
                  </span>
                ) : null}
              </div>
              {canManage ? (
                <div className="flex items-center gap-sm">
                  {/* 「放弃」= 丢掉本地改动、按库里的重读一遍（新建时回到空白）。 */}
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => void reload()}
                  >
                    放弃
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving ? "保存中…" : product ? "保存设置" : "创建草稿"}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </form>
      </ViewLayout>

      {product ? (
        <>
          <LaunchDrawer
            open={checkOpen}
            onClose={() => setCheckOpen(false)}
            product={product}
            clients={clients}
            webhook={webhook}
            checklist={checklist}
            onChecklistChange={setChecklist}
            canManage={canManage}
            locale={locale}
            onGoto={goto}
            onLaunched={async () => {
              setCheckOpen(false);
              await reload();
            }}
          />
          <SecretsDrawer
            open={secretsOpen}
            onClose={() => setSecretsOpen(false)}
            productId={product.id}
            productCode={product.productCode}
            clients={clients}
            webhook={webhook}
            canManage={canManage}
            onWebhookChange={setWebhook}
          />
        </>
      ) : null}

      {/* ── 改产品码：危险确认 + 善后清单 ──────────────────────────────
          不是一句「确定吗」，而是把下游有什么、各自会怎么处理逐条摆出来。 */}
      <DialogForm
        size="sm"
        open={pendingCode !== null}
        onOpenChange={(open) => {
          if (!open) setPendingCode(null);
        }}
        title="修改产品代码"
        description={`${product?.productCode ?? ""} → ${pendingCode ?? ""}`}
        submitLabel="确认修改"
        submitting={saving}
        onSubmit={(e) => {
          e.preventDefault();
          void doSave();
        }}
        cancelLabel={tShared("actions.cancel")}
      >
        <div className="flex flex-col gap-md">
          <Banner
            tone="warning"
            title="产品代码是这个产品在平台内外的身份"
            description="启用之后就锁死了。现在还能改，是因为它还是草稿——但下面这些东西已经按旧的码建起来了。"
          />
          <DetailList>
            <DetailRow label="边缘域名">
              {webhook?.edgeDomain?.trim() ? (
                <span>
                  已显式填写 <code>{webhook.edgeDomain}</code> ——不受影响。
                </span>
              ) : webhook?.edgeUpstream?.trim() ? (
                <span>
                  当前按产品码推导为{" "}
                  <code>{product?.productCode}.vxture.com</code>，会
                  <strong>钉成固定值</strong>
                  ——路由不变，DNS 不用动。要换域名请在保存后单独改这一栏。
                </span>
              ) : (
                <span className="text-muted-foreground">
                  没接边缘路由，不受影响。
                </span>
              )}
            </DetailRow>
            <DetailRow label="登录客户端">
              {clients.length > 0 ? (
                <span>
                  {clients.map((c) => c.clientId).join("、")} —— 客户端标识
                  <strong>保持不变</strong>
                  。它写在产品自己的配置里，跟着改会让产品当场登不进来。
                </span>
              ) : (
                <span className="text-muted-foreground">
                  还没建，不受影响。
                </span>
              )}
            </DetailRow>
            <DetailRow label="回调与密钥">
              <span className="text-muted-foreground">
                按 id 关联，不受影响。
              </span>
            </DetailRow>
          </DetailList>
        </div>
      </DialogForm>

      {/* ── 一次性交接清单：保存时签发了新客户端 ───────────────────────── */}
      <DialogForm
        size="lg"
        open={handover !== null}
        onOpenChange={(open) => {
          if (!open) closeHandover();
        }}
        title="交接清单"
        description="新签发的客户端，下面这些要交给产品侧。"
        submitLabel="我已保存"
        cancelLabel={tShared("common.close")}
        onSubmit={(e) => {
          e.preventDefault();
          closeHandover();
        }}
      >
        <Banner
          tone="warning"
          title="这是唯一一次看到 client_secret 明文"
          description="关闭后无法再次查看，丢了只能在「密钥管理」里轮换。请立即复制。"
        />
        <Textarea
          readOnly
          rows={Math.min(10, (handover?.lines.length ?? 0) + 1)}
          value={(handover?.lines ?? []).join("\n")}
          className="font-mono text-code-sm"
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void navigator.clipboard
              .writeText((handover?.lines ?? []).join("\n"))
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

      {/* advisory 的二次确认。**提醒不是门闩**：它只是拦一下让人看一眼（「恢复」那一档）。 */}
      <DialogForm
        size="sm"
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
        cancelLabel={tShared("actions.cancel")}
      >
        {null}
      </DialogForm>
    </>
  );
}
