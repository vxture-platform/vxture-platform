/**
 * 产品生命周期 —— 状态、动作、验证态的**唯一判断来源**。
 *
 * 权威设计在 `portals/opera/docs/opera-navigation-design.md` §6.4；服务端守卫在
 * `bff/opera-bff/src/routers/product-catalog.router.ts` 的 `STATE_TRANSITIONS`。
 * **这三处必须一致**，改一处就要改另外两处——这里是界面侧的那一份，它决定菜单里
 * 出现哪几个动作，但它挡不住任何东西：真正的约束在 BFF，理由见那边的注释。
 *
 * ── 两个状态，不是一个 ───────────────────────────────────────────────────────
 *
 * **生命周期状态**（接口字段 `state`，落库仍是 `product.products.status` —— 改名
 * 只发生在接口层，见 product_251 B-3）与**验证态**（最近一次检查的结果）分开。合成一个字段立刻出问题：上线半年后一次复验失败，难道把一个正在跑的
 * 产品自动改回草稿？
 *
 * 这与本仓反复出现的同一条原则一致——**意图与后果分列**：模型路由的 `state`
 * （意图）与 `resolution`（后果）也是两个字段，且只在上游坏掉时才分叉。
 *
 * ── 为什么没有「删除」 ───────────────────────────────────────────────────────
 *
 * 退役是状态跃迁不是删行：「谁曾经接入过、什么时候退的」必须答得出。与撤销授权迁
 * `revoked`、api-key 撤销保留行同一条规则。因此 `deprecated` 是**终态**，出边为空。
 *
 * ── 为什么没有「失败」这一档验证态 ───────────────────────────────────────────
 *
 * 失败总是有归属的。「待我方」「待对方」既说明状态也说明下一步，而「失败」两个字
 * 谁都不知道该动谁。真实错误文本在报告里，不在状态标签里。
 */

import type { IconName, StatusBadgeTone } from "@vxture/design-system";

export type ProductState = "draft" | "active" | "inactive" | "deprecated";

export const PRODUCT_STATE_META: Record<
  ProductState,
  { label: string; tone: StatusBadgeTone; hint: string }
> = {
  draft: {
    label: "草稿",
    tone: "neutral",
    hint: "已登记、拿到产品码，接入尚未完成。草稿会一直留着——等对方配置常常是几天的事，不是重试一次。",
  },
  active: {
    label: "已上线",
    tone: "success",
    hint: "接入验证通过并确认上线。",
  },
  inactive: {
    label: "已停用",
    tone: "warning",
    hint: "可逆。已配好的授权与凭据不受影响，只是产品本身不再对外可用。",
  },
  deprecated: {
    label: "已退役",
    tone: "danger",
    hint: "终态，不可逆。要重新接入是登记一个新的产品码。",
  },
};

interface ProductActionBase {
  id: string;
  label: string;
  icon: IconName;
  to: ProductState;
  /** 从哪些状态可以做这个动作。与 BFF 的 `STATE_TRANSITIONS` 互为镜像。 */
  from: readonly ProductState[];
  /**
   * 需要接入检查单全部必填项已满足才可执行。
   *
   * 目前只有「确认上线」需要。设计 §6.4 约束一要求**点击时自动重跑验证、通过才
   * 跃迁**——不接受"三天前通过了"，配置随时会变，拿过期的通过去上线就是让声明冒充
   * 事实。自动探针见 `runLaunchChecks()`（B4b-3）；在它到位之前，这里以检查单的
   * 必填项作为门槛，并在界面上如实说明这是**人工勾选**而非实测。
   */
  requiresChecklist?: boolean;
}

/**
 * 非破坏性动作。`advisory` 是**提醒**不是门闩：它拦一下让人看一眼，但没有任何
 * 条件可以不满足——「恢复前建议重新验证」正是这一档。
 */
interface ProductActionPlain extends ProductActionBase {
  danger?: false;
  advisory?: { title: string; description: string };
  destructive?: never;
}

/**
 * 破坏性动作。
 *
 * `verb` 与 `consequence` **必填**，与 DS 的 `DestructiveConfirm` 对齐——这张表
 * 是「这个状态能做哪些动作」的单一权威，那么「做了会怎样」属于同一件事，不该散
 * 在调用页里。做成判别联合而不是可选字段，是为了让**加一个 danger 动作却不写后果
 * 编译不过**：DS 在组件层用同一招，这里只是把同一条判据往上游挪了一层。
 *
 * `target` 不在这里：表描述「这个动作是什么」，不描述「作用在谁身上」——后者是
 * 行数据，由调用点拼。
 */
interface ProductActionDestructive extends ProductActionBase {
  danger: true;
  destructive: { verb: string; consequence: string };
  advisory?: never;
}

export type ProductAction = ProductActionPlain | ProductActionDestructive;

export const PRODUCT_ACTIONS: readonly ProductAction[] = [
  {
    id: "launch",
    label: "确认上线",
    icon: "rocket",
    from: ["draft"],
    to: "active",
    requiresChecklist: true,
  },
  {
    id: "suspend",
    label: "停用",
    icon: "pause",
    from: ["active"],
    to: "inactive",
  },
  {
    id: "resume",
    label: "恢复",
    icon: "play",
    from: ["inactive"],
    to: "active",
    advisory: {
      title: "恢复前建议重新验证",
      description:
        "停用期间对方可能改过回调地址、轮换过密钥、或调整了自己那侧的实现。恢复本身不跑验证——它只是把产品重新置为可用。",
    },
  },
  {
    id: "retire",
    label: "退役",
    icon: "archive",
    from: ["draft", "active", "inactive"],
    to: "deprecated",
    danger: true,
    destructive: {
      verb: "退役",
      /* 后半句是 2026-08-31 加的闸门（BFF `assertNoActiveUpstreamGrants`）：Atlas 的
         模型路由授权与 Runos 的能力授权都按产品码挂在各自的库里，退役不会替人撤。
         先说清楚，比落锤后被 409 弹回来再去猜要少一次往返。 */
      consequence:
        "退役是终态：产品行会保留（「谁曾经接入过、什么时候退的」要答得出），但不能再回到任何其它状态。要重新接入必须登记一个新的产品码。退役前必须先撤销这个产品在 Atlas 的模型路由授权与在 Runos 的能力授权——还有生效中的授权时会被拒绝。",
    },
  },
];

/** 当前状态下可做的动作。`deprecated` 返回空数组——终态没有出边。 */
export function actionsFor(state: ProductState): readonly ProductAction[] {
  return PRODUCT_ACTIONS.filter((a) => a.from.includes(state));
}

/* ── 验证态 ──────────────────────────────────────────────────────────────── */

export type VerificationState = "unverified" | "ours" | "theirs" | "passed";

export const VERIFICATION_META: Record<
  VerificationState,
  { label: string; tone: StatusBadgeTone; nextStep: string }
> = {
  unverified: {
    label: "未验证",
    tone: "neutral",
    nextStep: "跑一次接入检查。",
  },
  ours: {
    label: "待我方",
    tone: "warning",
    nextStep: "有检查项卡在平台侧配置，去对应的授权 / 凭据页补配。",
  },
  theirs: {
    label: "待对方",
    tone: "warning",
    nextStep: "平台侧齐了，失败项归因于对方——把交接信息与报告发过去。",
  },
  passed: {
    label: "通过",
    tone: "success",
    nextStep: "草稿态可以确认上线。",
  },
};

export interface ChecklistItem {
  itemCode: string;
  /** 人看的名字。错误报告里列 item_code 等于把内部标识符甩给读报告的人。 */
  itemName?: string;
  isRequired: boolean;
  isSatisfied: boolean;
  checkedAt: string | null;
}

/**
 * 哪些检查项卡在**对方**那一侧。
 *
 * 判据是这一项能不能由平台单方面完成：
 *   - `catalog_registered` 目录登记 —— 平台自己做
 *   - `c1_identity` 身份接入 —— 平台发 client，**对方要实现登录/回调/会话**
 *   - `c2_entitlement` 权益接入 —— **对方**要接权益拉取与失效
 *   - `c3_metering` 计量上报 —— **对方**要实现 webhook 接收与消费上报
 *   - `data_plane` 数据面 —— 平台按模板 provision
 *   - `acceptance` 端到端验收 —— 两侧一起，卡在这一项通常意味着前面某项其实没真通
 *
 * 归到「对方」不是推卸：这三项平台**观测不到**（opera 从外面看不出对方有没有接好
 * C2/C3），勾选是操作员根据对方回报做的判断。把它们标成待对方，是让运营者知道下一
 * 步该发邮件而不是该去改配置。
 */
const THEIR_SIDE = new Set(["c1_identity", "c2_entitlement", "c3_metering"]);

export function verificationOf(
  items: readonly ChecklistItem[],
): VerificationState {
  const required = items.filter((i) => i.isRequired);
  if (required.length === 0) return "unverified";
  /* 一次都没勾过 = 未验证。用「有没有 checkedAt」而不是「有没有 satisfied」判断：
     全部勾过但都判否，与从来没人看过，是两件不同的事。 */
  if (required.every((i) => i.checkedAt === null)) return "unverified";

  const pending = required.filter((i) => !i.isSatisfied);
  if (pending.length === 0) return "passed";
  /* 我方的事优先报：只要还有一项卡在平台侧，"待对方"就是误导——对方补完了这边照样
     不通。两侧都有未完成时报「待我方」，因为那是运营者现在就能动的。 */
  return pending.some((i) => !THEIR_SIDE.has(i.itemCode)) ? "ours" : "theirs";
}

/** 未满足的必填项，按侧分栏——错误报告与草稿页的「等对方做」都用它。 */
export function pendingBySide(items: readonly ChecklistItem[]): {
  ours: ChecklistItem[];
  theirs: ChecklistItem[];
} {
  const pending = items.filter((i) => i.isRequired && !i.isSatisfied);
  return {
    ours: pending.filter((i) => !THEIR_SIDE.has(i.itemCode)),
    theirs: pending.filter((i) => THEIR_SIDE.has(i.itemCode)),
  };
}
