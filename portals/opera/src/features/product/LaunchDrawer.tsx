"use client";

/**
 * LaunchDrawer.tsx — 产品页「接入检查」抽屉：一份清单、交给对方、确认上线。
 * @package @vxture/opera
 * @layer Presentation
 * @category Features - Product
 *
 * ── 2026-09-14 下午：两份列表合成一份 ──
 * 上午的版本把「复验结果」（8 项实测）和「接入检查单」（7 项，库里的）上下摆着。owner 走查：
 * 「接入检查单的逻辑和显示感觉还有问题」。问题是具体的——
 *  1. **同一件事出现两次、名字还不一样**：产品登记 / 目录已登记，C2 权益拉取 / C2 权益接入……
 *     两份里有四项是同一个判定，读的人得自己去对。
 *  2. 检查单的说明来自 seed 的 `description` 列，是英文。
 *  3. 未通过的项也写着「xx 确认」——`checked_at` 记的是「判过」，不是「通过」；
 *     状态只靠一个复选框表达，失败原因（`remark`）存在库里却不显示。
 *  4. 顺序按 `sort`，C3（50）排在 C2（60）前。
 *
 * 现在只有一份清单：一行一项，按「我方 / 对方」分组，每行是状态 + 名字 + 原因与下一步 + 来源。
 *  - **平台实测**的项：打开抽屉就跑一遍实测（只读，不写库），状态与原因当场可见；
 *    「重新复验」才把能写回检查单的几项落库（`source: "auto"`）。
 *  - **人工确认**的项：「标记完成 / 撤销确认」，平台观测不到的只有这几项。
 *  - 授权、Webhook 这类实测项没有对应的检查单行，照样列在同一张表里——上线前要看的是合集。
 *
 * **不跳转**（owner 2026-09-11：「切记不能跳转」）：「去处理」以 `#` 开头时交给页面就地处理，
 * 其它去处新标签页打开。
 *
 * **确认上线先重跑**：不接受「三天前通过」——重跑全通过、且检查单必填项全满足，才把草稿
 * 转成已上线；失败不改状态。
 */

import { useEffect, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Drawer,
  Icon,
  SectionHeader,
  Separator,
  StatusBadge,
  useToast,
  type StatusBadgeTone,
} from "@vxture/design-system";
import { isAutoDeterminedChecklistItem } from "@vxture/core-utils";
import { formatDateTime } from "@vxture-platform/shared";
import { api, OperaApiError } from "@/lib/api";
import { isStepUpCancelled, useStepUp } from "@/features/stepup/StepUpProvider";
import {
  allPassed,
  runLaunchChecks,
  type CheckResult,
  type CheckSide,
} from "./launch-checks";
import {
  pendingBySide,
  productStateMeta,
  sideOfChecklistItem,
  type ProductState,
} from "./lifecycle";
import type { ClientRecord, WebhookRecord } from "./onboarding-model";

/** `GET /api/products/:id/checklist` 的一行（opera-bff `ChecklistItemRecord`）。 */
export interface ChecklistEntry {
  itemCode: string;
  itemName: string | null;
  description?: string | null;
  isRequired: boolean;
  /**
   * 卡哪一道门：`launch` 卡上线、`publish` 卡发布（2026-09-17 起由 BFF 返回）。
   *
   * 这个字段必须一路带到 `lifecycle.ts` 的判定里——它缺席时那边按 `launch` 兜底，
   * 于是 `acceptance` 又会被算进「上线还差几项」，与 BFF 的闸门重新分叉。
   */
  gate?: string;
  isSatisfied: boolean;
  checkedAt: string | null;
  /** 自动复验写回时带「自动检查：原因」；人工勾选为空。 */
  remark?: string | null;
}

export interface LaunchDrawerProduct {
  id: string;
  productCode: string;
  productName: string;
  state: ProductState;
  origin: string;
  originProvider: string | null;
}

export interface LaunchDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly product: LaunchDrawerProduct;
  readonly clients: readonly ClientRecord[];
  readonly webhook: WebhookRecord | null;
  readonly checklist: readonly ChecklistEntry[];
  readonly onChecklistChange: (next: ChecklistEntry[]) => void;
  readonly canManage: boolean;
  readonly locale: string;
  /** 「去处理」。`#` 开头的交给页面就地处理，其余由页面决定怎么打开。 */
  readonly onGoto: (href: string) => void;
  /** 上线成功之后。页面重读。 */
  readonly onLaunched: () => Promise<void>;
}

type RowStatus = "pass" | "fail" | "pending" | "unchecked";

const STATUS_META: Record<RowStatus, { label: string; tone: StatusBadgeTone }> =
  {
    pass: { label: "通过", tone: "success" },
    fail: { label: "未通过", tone: "danger" },
    pending: { label: "待确认", tone: "warning" },
    unchecked: { label: "未检查", tone: "neutral" },
  };

interface Row {
  key: string;
  label: string;
  side: CheckSide;
  source: "auto" | "manual";
  required: boolean;
  status: RowStatus;
  /** 这一项在判什么——只对人工项显示（实测项有具体的 `detail`，不必再说一遍）。 */
  what: string;
  detail: string | null;
  remedy: string | null;
  href?: string;
  /** 人工项：确认时刻。 */
  confirmedAt: string | null;
  item?: ChecklistEntry;
  order: number;
}

/**
 * 检查单各项的中文名、说明与排序。
 *
 * **名字只有一套**：实测结果与检查单是同一个判定时用这里的名字，不再各叫各的。
 * 说明不读 seed 的 `description`（英文），在这里写——它是给运营者看的，不是给库看的。
 * 侧（我方 / 对方）不在这里：它由 `lifecycle.ts` 的 `sideOfChecklistItem` 统一给，
 * 目录页的验证态徽标用的是同一份。
 */
const ITEM_META: Record<
  string,
  { label: string; what: string; order: number }
> = {
  catalog_registered: {
    label: "产品登记",
    what: "产品码已登记、来源信息完整。",
    order: 10,
  },
  data_plane: {
    label: "数据面就绪",
    what: "产品侧的库按模板建好（vx_provision / local_authz / local_usage 与领域 schema）。平台观测不到，按实际情况确认。",
    order: 60,
  },
  acceptance: {
    label: "端到端验收",
    what: "登录 → 开通 → 权益门控 → 用量上报 → 失效，整条链实际跑通过一次。卡在这一项通常意味着前面某项其实没真通。",
    order: 70,
  },
  c1_identity: {
    label: "C1 身份接入",
    what: "对方实现了登录、回调与会话，用平台账号能登进产品。平台只看得到客户端注册，看不到对方实现，按对方回报确认。",
    order: 110,
  },
  c1_s2s: {
    label: "C1 出站换票",
    what: "对方用 S2S 令牌去调 Atlas / Runos / Karda。",
    order: 120,
  },
  c2_entitlement: {
    label: "C2 权益接入",
    what: "对方拉过权益。",
    order: 130,
  },
  c3_metering: {
    label: "C3 用量上报",
    what: "对方上报过用量。",
    order: 140,
  },
};

/** 没有检查单行的实测项：排序与没跑之前的占位。 */
const MEASURE_ONLY: Record<string, { label: string; order: number }> = {
  client: { label: "登录接入", order: 20 },
  "atlas-grants": { label: "模型授权", order: 30 },
  "runos-grants": { label: "能力授权", order: 40 },
  webhook: { label: "Webhook 登记", order: 50 },
};

function reason(error: unknown, fallback: string): string {
  return error instanceof OperaApiError && error.message
    ? error.message
    : fallback;
}

/** 自动写回的备注带着「自动检查：」前缀，显示时去掉。 */
function remarkDetail(remark: string | null | undefined): string | null {
  const text = (remark ?? "").replace(/^自动检查：/, "").trim();
  return text || null;
}

function buildRows(
  checklist: readonly ChecklistEntry[],
  checks: readonly CheckResult[] | null,
  running: boolean,
): Row[] {
  const liveByItem = new Map(
    (checks ?? [])
      .filter((c) => c.itemCode)
      .map((c) => [c.itemCode as string, c]),
  );
  const rows: Row[] = [];

  for (const item of checklist) {
    const meta = ITEM_META[item.itemCode];
    const auto = isAutoDeterminedChecklistItem(item.itemCode);
    const live = liveByItem.get(item.itemCode);
    let status: RowStatus;
    if (!auto) {
      status = item.isSatisfied ? "pass" : "pending";
    } else if (live) {
      status = live.status === "pass" ? "pass" : "fail";
    } else if (item.checkedAt === null) {
      status = "unchecked";
    } else {
      status = item.isSatisfied ? "pass" : "fail";
    }
    rows.push({
      key: item.itemCode,
      label: meta?.label ?? item.itemName ?? item.itemCode,
      side: sideOfChecklistItem(item.itemCode),
      source: auto ? "auto" : "manual",
      required: item.isRequired,
      status,
      what: meta?.what ?? "",
      detail: auto ? (live?.detail ?? remarkDetail(item.remark)) : null,
      remedy: live && live.status !== "pass" ? live.remedy : null,
      ...(live?.href ? { href: live.href } : {}),
      confirmedAt: !auto && item.isSatisfied ? item.checkedAt : null,
      item,
      order: meta?.order ?? 900,
    });
  }

  for (const [id, meta] of Object.entries(MEASURE_ONLY)) {
    const live = (checks ?? []).find((c) => c.id === id);
    rows.push({
      key: id,
      label: meta.label,
      side: live?.side ?? "ours",
      source: "auto",
      required: true,
      status: live ? (live.status === "pass" ? "pass" : "fail") : "unchecked",
      what: "",
      detail: live ? live.detail : running ? "检查中…" : null,
      remedy: live && live.status !== "pass" ? live.remedy : null,
      ...(live?.href ? { href: live.href } : {}),
      confirmedAt: null,
      order: meta.order,
    });
  }

  return rows.sort(
    (a, b) =>
      (a.side === b.side ? 0 : a.side === "ours" ? -1 : 1) || a.order - b.order,
  );
}

export function LaunchDrawer({
  open,
  onClose,
  product,
  clients,
  webhook,
  checklist,
  onChecklistChange,
  canManage,
  locale,
  onGoto,
  onLaunched,
}: LaunchDrawerProps) {
  const { toast } = useToast();
  const [checks, setChecks] = useState<CheckResult[] | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [launching, setLaunching] = useState(false);
  const { runWithStepUp } = useStepUp();
  const [ticking, setTicking] = useState<string | null>(null);

  async function reloadChecklist(): Promise<ChecklistEntry[] | null> {
    const fresh = await api
      .get<ChecklistEntry[]>(`/api/products/${product.id}/checklist`)
      .catch(() => null);
    if (fresh) onChecklistChange(fresh);
    return fresh;
  }

  /**
   * 跑一遍实测。`persist` 为真时把能写回检查单的几项落库。
   *
   * 打开抽屉时只读地跑：状态与原因当场可见，但不因为「看了一眼」就写库。
   * `source: "auto"` 让 BFF 把 `checked_by` 写成 NULL（自动校验不署名），同时它拒绝人手
   * 去勾这几项——「这一项是谁说通过的」在数据里答得出来。
   */
  async function runChecks(persist: boolean): Promise<CheckResult[] | null> {
    setRunning(true);
    try {
      const results = await runLaunchChecks(product, { locale });
      if (persist) {
        await Promise.all(
          results
            .filter((r) => r.itemCode)
            .map((r) =>
              api
                .patch(`/api/products/${product.id}/checklist/${r.itemCode}`, {
                  isSatisfied: r.status === "pass",
                  remark: `自动检查：${r.detail}`,
                  source: "auto",
                })
                .catch(() => undefined),
            ),
        );
        await reloadChecklist();
      }
      setChecks(results);
      setCheckedAt(formatDateTime(new Date(), locale));
      return results;
    } catch (error) {
      toast({
        tone: "danger",
        title: "复验没跑成",
        description: reason(error, "复验没跑成"),
      });
      return null;
    } finally {
      setRunning(false);
    }
  }

  /* 每次打开都现测一遍（只读）。关着的时候不跑，也不留着上一次的结果冒充现在。 */
  useEffect(() => {
    if (!open) {
      setChecks(null);
      setCheckedAt(null);
      return;
    }
    void runChecks(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只跟着开关走；runChecks 每次渲染都是新函数
  }, [open, product.id]);

  async function tick(item: ChecklistEntry, isSatisfied: boolean) {
    setTicking(item.itemCode);
    try {
      await api.patch(
        `/api/products/${product.id}/checklist/${item.itemCode}`,
        { isSatisfied },
      );
      await reloadChecklist();
    } catch (error) {
      toast({
        tone: "danger",
        title: "更新失败",
        description: reason(error, "更新失败"),
      });
    } finally {
      setTicking(null);
    }
  }

  async function confirmLaunch() {
    setLaunching(true);
    try {
      const results = await runChecks(true);
      if (!results) return;
      if (!allPassed(results)) {
        const failed = results.filter((r) => r.status !== "pass").length;
        toast({
          tone: "danger",
          title: `${failed} 项实测未通过，未上线`,
          description:
            "生命周期状态没有改变。未通过的项在清单里标红，各自写着下一步。",
        });
        return;
      }
      const items = await reloadChecklist();
      if (!items) {
        toast({
          tone: "danger",
          title: "读不到接入检查单，不能确认上线",
          description: "读不到不等于通过。稍后重试。",
        });
        return;
      }
      const { ours, theirs } = pendingBySide(
        items.map((i) => ({
          itemCode: i.itemCode,
          isRequired: i.isRequired,
          isSatisfied: i.isSatisfied,
          checkedAt: i.checkedAt,
          ...(i.itemName ? { itemName: i.itemName } : {}),
        })),
      );
      const pending = ours.length + theirs.length;
      if (pending > 0) {
        toast({
          tone: "danger",
          title: `还有 ${pending} 项人工确认没有完成`,
          description:
            "实测项已过，但数据面就绪、端到端验收这类平台观测不到的项还没确认。",
        });
        return;
      }
      /* 上线是对外面的重大变化，服务端挂了 step-up（`@Patch(":id/state")`）。
         这条路径本身已经是「看完整份检查单再落锤」，意图已经表达过一次，
         所以不再叠一个确认框；身份那一道由 step-up 负责。 */
      await runWithStepUp(() =>
        api.patch(`/api/products/${product.id}/state`, { state: "active" }),
      );
      toast({ tone: "success", title: `${product.productName} 已上线` });
      await onLaunched();
    } catch (error) {
      /* 取消仪式不是失败：生命周期没有改变，不该弹红。 */
      if (isStepUpCancelled(error)) return;
      toast({
        tone: "danger",
        title: "确认上线失败",
        description: reason(error, "确认上线失败"),
      });
    } finally {
      setLaunching(false);
    }
  }

  /**
   * 交接清单的纯文本。owner：「需要转交的信息，应该提供一键复制——全部格式化信息。」
   * 转交通常是贴进邮件或聊天，所以一段排好版的文字，而不是让人逐格去复制。
   * **密钥不在里面**：它们只在签发与轮换时明文出现一次，这里只写「另行交付」。
   */
  function handoverText(): string {
    const lines = [
      `【${product.productName}（${product.productCode}）平台接入交接】`,
      "",
      `产品码：${product.productCode}`,
    ];
    if (clients.length === 0) {
      lines.push("登录客户端：尚未添加");
    }
    for (const c of clients) {
      const isPublic = c.tokenEndpointAuthMethod === "none";
      lines.push(
        "",
        `登录客户端（${c.releaseChannel}）`,
        `  client_id：${c.clientId}`,
        `  认证方式：${isPublic ? "公共客户端（无 client_secret，强制 PKCE）" : "机密客户端（client_secret 另行交付）"}`,
        `  登录回调地址：${c.redirectUris.join("、") || "尚未配置"}`,
        `  登出回跳地址：${c.postLogoutRedirectUris.join("、") || "未配置"}`,
        `  Scopes：${c.allowedScopes.join(" ")}`,
      );
    }
    lines.push(
      "",
      `Webhook 回调地址：${webhook?.webhookUrl ?? "尚未配置"}`,
      `Webhook 签名密钥：${webhook?.hasWebhookSecret ? "已登记（另行交付）" : "尚未登记"}`,
    );
    return lines.join("\n");
  }

  function copyHandover() {
    void navigator.clipboard.writeText(handoverText()).then(
      () => toast({ tone: "success", title: "已复制交接信息" }),
      () =>
        toast({
          tone: "danger",
          title: "复制失败",
          description: "浏览器拒绝了剪贴板访问，请手动选中复制。",
        }),
    );
  }

  const rows = buildRows(checklist, checks, running);
  const open_ = rows.filter((r) => r.required && r.status !== "pass");
  const openOurs = open_.filter((r) => r.side === "ours").length;
  const openTheirs = open_.length - openOurs;

  function renderRow(row: Row) {
    const status =
      running && row.source === "auto" && !checks ? "unchecked" : row.status;
    const meta = STATUS_META[status];
    return (
      <div
        key={row.key}
        className="flex flex-col gap-2xs rounded-md border border-border p-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-sm">
          <div className="flex min-w-0 flex-wrap items-center gap-sm">
            <StatusBadge tone={meta.tone} dot>
              {meta.label}
            </StatusBadge>
            <span className="text-label-md text-foreground">{row.label}</span>
            <Badge variant={row.source === "auto" ? "secondary" : "outline"}>
              {row.source === "auto" ? "平台实测" : "人工确认"}
            </Badge>
            {!row.required ? <Badge variant="outline">可选</Badge> : null}
          </div>
          <div className="flex items-center gap-xs">
            {row.href && row.status === "fail" ? (
              <Button
                type="button"
                variant="ghost"
                size="md"
                onClick={() => onGoto(row.href!)}
              >
                去处理
              </Button>
            ) : null}
            {row.source === "manual" && row.item && canManage ? (
              <Button
                type="button"
                variant={row.status === "pass" ? "ghost" : "outline"}
                size="md"
                disabled={ticking !== null}
                onClick={() =>
                  row.item && void tick(row.item, row.status !== "pass")
                }
              >
                {row.status === "pass" ? "撤销确认" : "标记完成"}
              </Button>
            ) : null}
          </div>
        </div>
        {row.source === "manual" ? (
          <p className="text-body-sm text-muted-foreground">{row.what}</p>
        ) : null}
        {row.detail ? (
          <p className="text-body-sm text-foreground">{row.detail}</p>
        ) : null}
        {row.remedy ? (
          <p className="text-body-sm text-warning-text">下一步：{row.remedy}</p>
        ) : null}
        {row.confirmedAt ? (
          <p className="text-body-sm text-muted-foreground">
            {formatDateTime(row.confirmedAt, locale)} 确认
          </p>
        ) : null}
      </div>
    );
  }

  const ours = rows.filter((r) => r.side === "ours");
  const theirs = rows.filter((r) => r.side === "theirs");

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title="接入检查"
      description={product.productCode}
    >
      <div className="flex flex-col gap-xl">
        {/* ── 汇总 ─────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-sm">
          <div className="flex min-w-0 flex-col gap-2xs">
            <p className="text-label-md text-foreground">
              {running && !checks
                ? "检查中…"
                : open_.length === 0
                  ? "全部通过"
                  : `还差 ${open_.length} 项：我方 ${openOurs} · 对方 ${openTheirs}`}
            </p>
            <p className="text-body-sm text-muted-foreground">
              {checkedAt
                ? `实测于 ${checkedAt}。实测只读平台自己的存储，不向对方端点发任何请求。`
                : "实测只读平台自己的存储，不向对方端点发任何请求。"}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={running || launching}
            onClick={() => void runChecks(true)}
          >
            <Icon name="refresh" size="sm" aria-hidden="true" />
            {running ? "复验中…" : "重新复验"}
          </Button>
        </div>

        {/* ── 我方 ─────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-sm">
          <SectionHeader
            level={3}
            icon="settings"
            title={`我方 · 平台侧配置${openOurs > 0 ? `（还差 ${openOurs} 项）` : ""}`}
          />
          {ours.map(renderRow)}
        </div>

        {/* ── 对方 ─────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-sm">
          <SectionHeader
            level={3}
            icon="plug"
            title={`对方 · 产品侧接通${openTheirs > 0 ? `（还差 ${openTheirs} 项）` : ""}`}
          />
          {theirs.map(renderRow)}
        </div>

        <Separator />

        {/* ── 交给对方 ─────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-sm">
          <SectionHeader
            level={3}
            icon="share"
            title="交给对方"
            action={
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={copyHandover}
              >
                <Icon name="copy" size="sm" aria-hidden="true" />
                复制全部
              </Button>
            }
          />
          <p className="text-body-sm text-muted-foreground">
            接入是双边的：平台侧配完之后，下面这些要发给产品侧。密钥不在这里——它们只在签发与轮换时明文出现一次。
          </p>
          <HandoverRow
            term="产品码"
            value={product.productCode}
            note="授权主体，也是 S2S 令牌的 act.sub。"
          />
          <HandoverRow
            term="client_id"
            value={
              clients.length > 0
                ? clients
                    .map((c) => `${c.clientId}（${c.releaseChannel}）`)
                    .join("、")
                : "尚未添加"
            }
            note="在「登录接入」添加；client_secret 在保存或轮换时明文显示一次。"
          />
          <HandoverRow
            term="登录回调地址"
            value={
              clients.flatMap((c) => c.redirectUris).join("、") || "尚未配置"
            }
            note="产品侧实现的回调要与这里逐字一致，否则授权会被拒。"
          />
          <HandoverRow
            term="Webhook 回调地址"
            value={webhook?.webhookUrl ?? "尚未配置"}
            note="产品侧按这个地址收开通与停用事件；签名密钥在「密钥管理」。"
          />
        </div>

        {/* ── 终点动作 ─────────────────────────────────────────────────── */}
        {product.state === "draft" ? (
          <Banner
            tone={open_.length === 0 ? "success" : "info"}
            title={
              open_.length === 0
                ? "可以确认上线"
                : `还差 ${open_.length} 项，全部通过才能上线`
            }
            description="确认上线会先重跑一遍实测：全通过、且人工确认项齐了，才把草稿转成已上线。失败不改状态。"
            {...(canManage
              ? {
                  action: (
                    <Button
                      type="button"
                      disabled={running || launching || open_.length > 0}
                      onClick={() => void confirmLaunch()}
                    >
                      <Icon name="rocket" size="sm" aria-hidden="true" />
                      {launching ? "检查中…" : "确认上线"}
                    </Button>
                  ),
                }
              : {})}
          />
        ) : (
          <Banner
            tone="info"
            title={`当前是「${productStateMeta(product.state).label}」，这里只做复验`}
            description={
              product.state === "active"
                ? "对方改过配置、或密钥轮换后应当跑一次。复验失败不会自动停用——自动停用一个正在跑的产品，是把监测信号变成破坏性动作。要停由人在页头的生命周期菜单里停。"
                : productStateMeta(product.state).hint
            }
          />
        )}
      </div>
    </Drawer>
  );
}

function HandoverRow({
  term,
  value,
  note,
}: {
  readonly term: string;
  readonly value: string;
  readonly note: string;
}) {
  return (
    <div className="flex flex-col gap-2xs rounded-md border border-border p-sm">
      <span className="text-label-md text-foreground">{term}</span>
      <span className="break-all font-mono text-code-sm text-foreground">
        {value}
      </span>
      <span className="text-body-sm text-muted-foreground">{note}</span>
    </div>
  );
}
