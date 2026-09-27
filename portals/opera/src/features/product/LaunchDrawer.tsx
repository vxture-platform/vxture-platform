"use client";

/**
 * LaunchDrawer.tsx — 产品页「接入检查」抽屉：四个环节、逐环节确认、交给对方、确认上线。
 * @package @vxture/opera
 * @layer Presentation
 * @category Features - Product
 *
 * ── 2026-09-27：按环节拆开（owner：「接入检查的面板一团浆糊」）──
 * 此前是一张长清单，三道门的项混在一屏：上线阶段还测不到的项灰着挂着写「待确认」，既不能
 * 在这一屏确认、也没有手动确认的口子，运营只能猜。owner 的规矩：
 *   「按照设计的每个步骤拆开，全部转绿可以下一步。不能自动的先手动确认，在下一个环节可以
 *    自动确认。完全不能自动的保留手动确认。但必须在该环节能够全部确认，不是猜测。不留红
 *    执行下一步。」
 * 于是：
 *  ① 登记与配置          我方配置，全部实测
 *  ② 对方接入 · 上线前确认  登录接通实测；换票 / 权益 / 用量 / 回调接收端此时平台看不见，
 *                          按对方回报**人工确认**——全绿才「确认上线」
 *  ③ 发布套餐            套餐已发布（实测；动作在 admin）
 *  ④ 测试租户验证 · 转正式版  测试租户已订阅 + 换票 / 权益 / 用量（②里人工确认过的三件事，
 *                          到这里由真实使用**自动**点亮）；全绿后在 admin 改承诺等级
 * 环节按顺序解锁：当前环节展开，已完成的折起，后面的只写「上一环节完成后开始」——不把
 * 后面环节的项摆在前面让人猜。回调接收端的验签 / 幂等平台永远看不见，它只在②人工确认一次。
 *
 * 环节由 `lifecycle.ts` 的 `stageOfCheck` 派生（launch 门 → ①②，stable 门 → ③④），
 * 不是第三根轴。「带缺项上线」从界面拿掉了（owner：不再出现带缺陷上线）；BFF 侧的
 * override 参数仍在，那是给事故用的逃生口，不是运营的常规路。
 *
 * ── 更早的几条约束照旧 ──
 *  - 一份清单、名字只有一套（ITEM_META），说明不读 seed 的英文 description。
 *  - **平台实测**的项：打开抽屉就跑一遍实测（只读，不写库）；「重新复验」与「确认上线」
 *    才把能写回检查单的几项落库（`source: "auto"`）。
 *  - **人工确认**的项：「标记完成 / 撤销确认」。
 *  - **不跳转**（owner 2026-09-11）：「去处理」以 `#` 开头时交给页面就地处理。
 *  - **确认上线先重跑**：不接受「三天前通过」——重跑①②全通过、且人工确认项齐，才把
 *    草稿 / 开发中转成已上线；失败不改状态。
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
  canLaunchFrom,
  CHECKLIST_STAGES,
  pendingBySide,
  productStateMeta,
  sideOfChecklistItem,
  stageGatesLaunch,
  stageOfCheck,
  type ChecklistStage,
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
   * 卡哪一道门：`launch` 卡上线、`stable` 卡转正式版（由 BFF 返回）。
   *
   * 这个字段必须一路带到 `lifecycle.ts` 的判定里——它缺席时那边按 `launch` 兜底，
   * stable 门的项就会被算进「上线还差几项」，与 BFF 的闸门分叉。
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
  /** 承诺等级；`stable` = 环节④已完成。 */
  releaseStage: string;
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

type RowStatus = "pass" | "fail" | "pending" | "unchecked" | "probing";

const STATUS_META: Record<RowStatus, { label: string; tone: StatusBadgeTone }> =
  {
    pass: { label: "通过", tone: "success" },
    fail: { label: "未通过", tone: "danger" },
    /* 只给人工项用：等运营按对方回报勾。它不是猜——这一项在这一屏就能确认。 */
    pending: { label: "待确认", tone: "warning" },
    unchecked: { label: "未检查", tone: "neutral" },
    /* 「自动」不写进标签:旁边的「平台实测」徽标已经说了，而现有四个标签都是三字，
       六字会把徽标撑成两倍宽。 */
    probing: { label: "探测中…", tone: "info" },
  };

interface Row {
  key: string;
  stage: ChecklistStage;
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
 * 说明不读 seed 的 `description` 列（英文），在这里写——它是给运营者看的。
 * 侧（我方 / 对方）与环节不在这里：由 `lifecycle.ts` 的 `sideOfChecklistItem` /
 * `stageOfCheck` 统一给，目录页用的是同一份。
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
  c1_identity: {
    label: "登录接入",
    what: "有人真的用平台账号登进了这个产品——登录流程没接通就不会有这一行。",
    order: 110,
  },
  /* 环节②的四项人工确认：这一屏平台观测不到对方做没做，按对方回报勾。前三项到环节④
     由同名去掉 _declared 的实测项自动点亮；回调接收端那一项平台永远测不了。 */
  c1_s2s_declared: {
    label: "对方已实现 S2S 换票",
    what: "对方按《产品接入通则》C1 出站实现了 token-exchange 客户端（service / OBO 任一）。上线前换不到票——服务模式换票要过覆盖门，先得有订阅——所以这里按对方回报确认；到环节④由真实换票自动点亮。",
    order: 120,
  },
  c2_entitlement_declared: {
    label: "对方已实现权益拉取与门控",
    what: "对方实现了 GET /platform/entitlements 的拉取、45 秒缓存与失效、UI 门控 tier != null。到环节④由真实拉取自动点亮。",
    order: 130,
  },
  c3_metering_declared: {
    label: "对方已实现用量上报",
    what: "对方实现了 POST /usage/consume（带 idempotency_key，gated 当信息不当异常）。到环节④由真实上报自动点亮。",
    order: 140,
  },
  webhook_receiver_declared: {
    label: "对方回调接收端就绪",
    what: "对方在 /api/webhooks/vxture 验签（X-Vxture-Signature，原始字节）、按投递 id 幂等、按 seq 拒倒序。验签与幂等平台永远看不见——这一项只能人工确认，仅统一登录的产品确认「不适用」即可。",
    order: 150,
  },
  plan_published: {
    label: "套餐已发布",
    what: "有已发布、且组件含本产品的套餐版本。",
    order: 210,
  },
  tenant_subscribed: {
    label: "测试租户已订阅",
    what: "有一条覆盖本产品的有效订阅。",
    order: 310,
  },
  c1_s2s: {
    label: "C1 出站换票",
    what: "对方用 S2S 令牌去调 Atlas / Runos / Karda。",
    order: 320,
  },
  c2_entitlement: {
    label: "C2 权益拉取",
    what: "对方拉过权益。",
    order: 330,
  },
  c3_metering: {
    label: "C3 用量上报",
    what: "对方上报过用量。",
    order: 340,
  },
};

/**
 * 没有检查单行的实测项：排序与没跑之前的占位。
 *
 * **这张表是「实测结果能不能被看见」的唯一开关。** 不在这里、又没有 `itemCode` 的
 * 条目，`buildRows` 一行都不建。
 */
const MEASURE_ONLY: Record<
  string,
  { label: string; order: number; advisory?: boolean }
> = {
  client: { label: "登录客户端", order: 20 },
  "atlas-grants": { label: "模型授权", order: 30 },
  "runos-grants": { label: "能力授权", order: 40 },
  webhook: { label: "Webhook 登记", order: 50 },
  /* 端到端链路痕迹与开通回执**不在这一屏**（2026-11-03）：它们答的是「跑起来之后
     最近还正常吗」，去了「运行健康」抽屉，在那里是三态，没有「未通过」这个说法。 */
};

const STAGE_ICON: Record<
  ChecklistStage,
  "settings" | "plug" | "receipt" | "rocket"
> = {
  configure: "settings",
  prelaunch: "plug",
  publish: "receipt",
  verify: "rocket",
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

/** 一条实测结果落在哪个环节（检查单项按 item_code，纯实测项按 id）。 */
function stageOfResult(r: CheckResult): ChecklistStage {
  return stageOfCheck(r.itemCode ?? r.id);
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
      stage: stageOfCheck(item.itemCode, item.gate),
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
      stage: stageOfCheck(id),
      label: meta.label,
      side: live?.side ?? "ours",
      source: "auto",
      required: !meta.advisory,
      /* advisory 项没通过时画「待确认」不画红:它报的是事实，不是准入条件。 */
      status: live
        ? live.status === "pass"
          ? "pass"
          : meta.advisory
            ? "pending"
            : "fail"
        : "unchecked",
      what: "",
      detail: live ? live.detail : running ? "探测中…" : null,
      remedy: live && live.status !== "pass" ? live.remedy : null,
      ...(live?.href ? { href: live.href } : {}),
      confirmedAt: null,
      order: meta.order,
    });
  }

  return rows.sort((a, b) => a.order - b.order);
}

type StageState = "done" | "current" | "locked";

interface StageView {
  key: ChecklistStage;
  no: number;
  title: string;
  hint: string;
  rows: Row[];
  /** 必填且未通过的行（人工项「待确认」也算未通过——它就是这一屏要做的事）。 */
  open: Row[];
  state: StageState;
}

/**
 * 四个环节的完成判据。**完成不只看这一屏的项**：环节②的完成是「已上线」这一事实——
 * 一个早就上线的产品即便②里有人工项没勾，也不该把它退回上线前；同理环节④看的是
 * 承诺等级已是正式版。当前环节 = 第一个没完成的；再往后的锁着。
 */
function buildStages(rows: Row[], product: LaunchDrawerProduct): StageView[] {
  const launched = !canLaunchFrom(product.state);
  const byKey = (k: ChecklistStage) => rows.filter((r) => r.stage === k);
  const openOf = (list: Row[]) =>
    list.filter((r) => r.required && r.status !== "pass");
  const doneByFact: Record<ChecklistStage, boolean> = {
    configure: launched || openOf(byKey("configure")).length === 0,
    prelaunch: launched,
    publish: byKey("publish").some(
      (r) => r.key === "plan_published" && r.status === "pass",
    ),
    verify: product.releaseStage === "stable",
  };
  let currentTaken = false;
  return CHECKLIST_STAGES.map((s) => {
    const list = byKey(s.key);
    let state: StageState;
    if (doneByFact[s.key] && !currentTaken) state = "done";
    else if (!currentTaken) {
      state = "current";
      currentTaken = true;
    } else state = "locked";
    return {
      key: s.key,
      no: s.no,
      title: s.title,
      hint: s.hint,
      rows: list,
      open: openOf(list),
      state,
    };
  });
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
  /* 已完成的环节默认折起；点标题展开。当前环节永远展开，锁着的环节没有内容可展。 */
  const [expanded, setExpanded] = useState<Set<ChecklistStage>>(new Set());

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
      setExpanded(new Set());
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

  /**
   * 确认上线：重跑环节①②的实测、人工项全勾、再改状态。
   *
   * 只数卡上线门的两个环节——环节③④的实测项（套餐、订阅、对方三项）在上线前必然是
   * 红的，那是它们该在的状态，不是上不了线的理由。
   */
  async function confirmLaunch() {
    setLaunching(true);
    try {
      const results = await runChecks(true);
      if (!results) return;
      const launchResults = results.filter((r) =>
        stageGatesLaunch(stageOfResult(r)),
      );
      if (!allPassed(launchResults)) {
        const failed = launchResults.filter((r) => r.status !== "pass").length;
        toast({
          tone: "danger",
          title: `${failed} 项实测未通过，未上线`,
          description:
            "生命周期状态没有改变。未通过的项在环节①②里标红，各自写着下一步。",
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
          /* gate 必须带上：缺席时 gatesLaunch 按 launch 兜底，stable 门的项会被算进来。 */
          ...(i.gate ? { gate: i.gate } : {}),
          isSatisfied: i.isSatisfied,
          checkedAt: i.checkedAt,
          ...(i.itemName ? { itemName: i.itemName } : {}),
        })),
      );
      const pending = [...ours, ...theirs];
      if (pending.length > 0) {
        toast({
          tone: "danger",
          title: `还有 ${pending.length} 项人工确认没有完成`,
          description: `${pending
            .map(
              (i) => ITEM_META[i.itemCode]?.label ?? i.itemName ?? i.itemCode,
            )
            .join("、")}——在环节②按对方回报逐项「标记完成」。`,
        });
        return;
      }
      /* 上线是对外面的重大变化，服务端挂了 step-up（`@Patch(":id/state")`）。
         这条路径本身已经是「看完整份检查单再落锤」，意图已经表达过一次，
         所以不再叠一个确认框；身份那一道由 step-up 负责。 */
      await runWithStepUp(() =>
        api.patch(`/api/products/${product.id}/state`, { state: "active" }),
      );
      toast({
        tone: "success",
        title: `${product.productName} 已上线`,
        description: "下一步：在 admin · 服务套餐发布本产品的套餐版本。",
      });
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

  /* **只取上线门那一组**（2026-11-03）。运行健康那两项走另一个抽屉——一屏回答一个问题。 */
  const launchChecks =
    checks?.filter((c) => (c.scope ?? "launch") === "launch") ?? null;
  const rows = buildRows(checklist, launchChecks, running);
  const stages = buildStages(rows, product);
  const current = stages.find((s) => s.state === "current") ?? null;

  function toggleStage(key: ChecklistStage) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function renderRow(row: Row) {
    /* 自动项在复验期间一律显示「探测中…」——包括已经有上一轮结果的时候。
       旧结果让位一瞬，换来的是这个标签名副其实:它说的是此刻在做什么。 */
    const status: RowStatus =
      running && row.source === "auto" ? "probing" : row.status;
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
            <Badge variant="outline">
              {row.side === "ours" ? "我方" : "对方"}
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
                variant="ghost"
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

  /** 环节标题右侧的一句话：完成 / 还差几项 / 锁着。 */
  function stageStatus(s: StageView): { tone: StatusBadgeTone; label: string } {
    if (s.state === "locked") return { tone: "neutral", label: "未开始" };
    if (s.state === "done") {
      return s.open.length === 0
        ? { tone: "success", label: "已完成" }
        : { tone: "warning", label: `已完成 · ${s.open.length} 项待补` };
    }
    if (running && s.rows.some((r) => r.source === "auto"))
      return { tone: "info", label: "复验中…" };
    return s.open.length === 0
      ? { tone: "success", label: "全部通过" }
      : { tone: "danger", label: `还差 ${s.open.length} 项` };
  }

  /** 每个环节的终点动作或说明——只在当前环节出现。 */
  function renderStageAction(s: StageView) {
    if (s.state !== "current") return null;
    const allGreen = s.open.length === 0;
    if (s.key === "configure") {
      return (
        <Banner
          tone={allGreen ? "success" : "info"}
          title={allGreen ? "配置齐了" : `还差 ${s.open.length} 项`}
          description="全部通过后进入环节②。这一屏的项都在产品页上改，改完「重新复验」。"
        />
      );
    }
    if (s.key === "prelaunch") {
      if (!canLaunchFrom(product.state)) {
        return (
          <Banner
            tone="info"
            title={`当前是「${productStateMeta(product.state).label}」，这里只做复验`}
            description={productStateMeta(product.state).hint}
          />
        );
      }
      const manualOpen = s.open.filter((r) => r.source === "manual").length;
      return (
        <Banner
          tone={allGreen ? "success" : "info"}
          title={allGreen ? "可以确认上线" : `还差 ${s.open.length} 项才能上线`}
          description={
            allGreen
              ? "确认上线会先重跑一遍环节①②的实测，全通过且人工确认项齐了，才把产品转成已上线。失败不改状态。"
              : manualOpen > 0
                ? `其中 ${manualOpen} 项要按对方回报「标记完成」。这一屏的每一项都能在这里确认——没有下一步才测得到的项。`
                : "未通过的项各自写着下一步。"
          }
          {...(canManage && allGreen
            ? {
                action: (
                  <Button
                    type="button"
                    disabled={running || launching}
                    onClick={() => void confirmLaunch()}
                  >
                    <Icon name="rocket" size="sm" aria-hidden="true" />
                    {launching ? "检查中…" : "确认上线"}
                  </Button>
                ),
              }
            : {})}
        />
      );
    }
    if (s.key === "publish") {
      return (
        <Banner
          tone="info"
          title="在 admin 发布套餐"
          description="admin · 服务套餐 → 本产品 → 发布版本。发布没有别的前置；发布后回这里「重新复验」，套餐那一项就绿。"
        />
      );
    }
    return (
      <Banner
        tone={allGreen ? "success" : "info"}
        title={allGreen ? "五项全绿，可以转正式版" : `还差 ${s.open.length} 项`}
        description={
          allGreen
            ? "在 admin · 产品内容把承诺等级改成「正式版」。admin 会再验一次这五项，缺任一项拒绝（409）。"
            : "让一个测试用途的真实租户在 console 订阅本产品并真实使用一次：登录、换票、拉权益、报用量各发生一次，这几项就由平台观测点亮。不用人勾。"
        }
      />
    );
  }

  function renderStage(s: StageView) {
    const status = stageStatus(s);
    const isOpen =
      s.state === "current" || (s.state === "done" && expanded.has(s.key));
    return (
      <div key={s.key} className="flex flex-col gap-sm">
        <SectionHeader
          level={3}
          icon={STAGE_ICON[s.key]}
          title={`环节 ${s.no} · ${s.title}`}
          action={
            <div className="flex items-center gap-sm">
              <StatusBadge tone={status.tone} dot>
                {status.label}
              </StatusBadge>
              {s.state === "done" ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  onClick={() => toggleStage(s.key)}
                >
                  {isOpen ? "收起" : "展开"}
                </Button>
              ) : null}
            </div>
          }
        />
        <p className="text-body-sm text-muted-foreground">{s.hint}</p>
        {s.state === "locked" ? (
          <p className="text-body-sm text-muted-foreground">
            上一环节完成后开始。这一屏有 {s.rows.length}{" "}
            项，到时在这里实测或确认。
          </p>
        ) : isOpen ? (
          s.rows.map(renderRow)
        ) : null}
        {renderStageAction(s)}
      </div>
    );
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title="接入检查"
      description={`${product.productCode} · 四个环节，逐环节确认`}
    >
      <div className="flex flex-col gap-xl">
        {/* ── 汇总 ─────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-sm">
          <div className="flex min-w-0 flex-col gap-2xs">
            <p className="text-label-md text-foreground">
              {running && !checks
                ? "检查中…"
                : current
                  ? `当前环节 ${current.no} / ${CHECKLIST_STAGES.length} · ${current.title}${
                      current.open.length === 0
                        ? " —— 全部通过"
                        : ` —— 还差 ${current.open.length} 项`
                    }`
                  : "四个环节全部完成 —— 已是正式版"}
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

        {/* ── 四个环节 ─────────────────────────────────────────────────── */}
        {stages.map(renderStage)}

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
