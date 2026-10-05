/**
 * operator-mirror.ts — 客户消息的运营镜像（owner 2026-09-28）。
 * @package @vxture/service-notification
 *
 * owner：「根治是做一个服务端「待办」接口，页面和作业读同一份，尤其运营端收到的信息和
 * 客户侧要完整一致。」
 *
 * 生产实测（2026-09-28）：退款单 ¥99 审核 pending 挂了一上午无人知；三条退订只改了订阅
 * 状态；`admin.operator_notices` 系统来源 0 行——那条写路从建表起就没人走过。缺的不是
 * 某一条通知，是「客户那边发生了什么，运营这边同步知道」这条通路本身。
 *
 * ── 一处定义，全部覆盖 ──
 * `OPERATOR_MIRROR` 对每个客户模板给一条运营侧的标题与严重度，类型是
 * `Record<NotificationTemplateCode, …>`：新加客户模板没配镜像**编译不过**，不会静默漏掉
 * （与 templates.ts 的 TOPIC_OF 同一手法）。
 *
 * ── 一事一条 ──
 * 去重锚 = reference_type `customer_event` + reference_id `{模板}:{引用类型}:{引用 id}`
 * ——与客户收件箱唯一键同一粒度，所以一个客户事件不管有几个收件人只镜像一次；调用方
 * 重放、作业重扫都落成 `inserted: false`。落库走 @vxture/service-notice 的
 * `createSystemNotice`，冲突目标照抄部分唯一索引 `uq_operator_notices_system`。
 *
 * ── 严重度与保留 ──
 * warning = 在等运营动手（退款申请、退订退款、申报待确认、退款执行失败），不过期、直到
 * 处理；info = 周知，30 天后退出列表（不删行）。planes 只给 admin——这些都是客户经营
 * 事实，不是运维（opera）或治理（arche）的事。
 *
 * ── 正文 ──
 * 租户名 · 产品 套餐 · 金额 · 客户收到的那条原文（标题 + 正文）。最后一段保证「完整
 * 一致」：运营看到的就是客户看到的，不另编一套说法。金额参数由调用方用
 * formatNotifyMoney 格式化过（已带币符），这里不再加。
 *
 * ── 失败 ──
 * 镜像只记日志，绝不影响客户消息（客户那条已经落库）。运营这边没镜像成功是运营侧的
 * 缺口，待办接口（@vxture/service-ops-todos）直接算库里的状态兜底。
 */
import type { Pool } from "pg";
import type {
  CreateSystemNoticeInput,
  CreateSystemNoticeResult,
  NoticePlane,
} from "@vxture/service-notice";
import {
  PROVIDER_PARAM,
  ROLE_PARAM,
  providerNameOf,
  roleNameOf,
} from "./templates";
import type {
  NotificationReferenceType,
  NotificationTemplateCode,
  TemplateParams,
} from "./templates";

export type OperatorMirrorSeverity = "info" | "warning";

export interface OperatorMirrorEntry {
  readonly severity: OperatorMirrorSeverity;
  /** 运营标题。参数 = 客户模板参数 ∪ 从引用解析出的可视码（orderNo / refundNo）。 */
  readonly title: (params: TemplateParams) => string;
  /** 公告类：一条覆盖多个租户，正文不带租户名、不查租户。 */
  readonly broadcast?: true;
}

/** 缺参留空串——镜像不因一个参数缺失而丢（与 interpolate 同一纪律）。 */
function pick(params: TemplateParams, key: string): string {
  const v = params[key];
  return v === undefined || v === null ? "" : String(v);
}

/**
 * 角色段。参数里放的是**角色码**（`access.roles.role_code`，发侧原样传，见 templates.ts 的
 * roleNameOf），词由模板层按收件人语言给；运营这一面固定中文——本文件整张表的标题都是写死
 * 的中文，运营平面不按语言渲染。
 *
 * 此前这里直接把码印出来，于是运营列表里读到「Acme 邀请了新成员（member）」——与客户那边
 * 「以「member」身份加入」是同一个缺陷的两处现场。
 */
function role(params: TemplateParams): string {
  return roleNameOf(params[ROLE_PARAM], "zh-CN");
}

/**
 * 第三方登录段。与 `role` 完全同形，同一条理由：参数里放的是**码**，成词是模板层按收件人
 * 语言做的事，而运营这一面固定中文（本文件整张表的标题都是写死的中文）。此前 `role` 那里
 * 直接把码印出来，运营列表里于是读到「Acme 邀请了新成员（member）」。
 *
 * **操作者（`actorLabel`）故意没有对应的这么一段。** 它的词是从**客户视角**写的
 * （「你本人」「你所在组织的管理员」，见 templates.ts 的 ACTOR_NAMES），搬进运营标题会读成
 * 「客户登录密码已修改（你所在组织的管理员）」——对着运营说「你的组织」，视角错了。
 * 再为运营写第二张表又是同一个事实的第二处文案。所以操作者不进标题：它在正文里，而正文
 * 明写着「客户收到：…」，那一段用客户视角的措辞正是对的。
 */
function provider(params: TemplateParams): string {
  return providerNameOf(params[PROVIDER_PARAM], "zh-CN");
}

/** 账号安全事件的时刻段（已由发侧的 `securityEventStamp` 格式化好，这里不再加工）。 */
function occurredAt(params: TemplateParams): string {
  return pick(params, "occurredAt");
}

function plan(params: TemplateParams): string {
  return `${pick(params, "productName")} ${pick(params, "planName")}`.trim();
}

function order(params: TemplateParams): string {
  return pick(params, "orderNo");
}

/**
 * 加油包段：包名 · 加油包单号。缺哪个就不出现那一段，不留空的分隔符。
 *
 * 单号参数与订单共用 `orderNo`（全仓一套词汇）。它住 `metering.addon_purchases`
 * 而不是 `billing.orders`，这件事由**引用类型**承担，不由参数名承担：见 `mirrorLink`。
 */
function addon(params: TemplateParams): string {
  return [pick(params, "packName"), order(params)]
    .filter((v) => v !== "")
    .join(" · ");
}

/**
 * 工单段：**只有可视工单码**（`support.tickets.ticket_no`，TK-…）。
 *
 * 不带标题、不带回复原文：标题是客户（或代录的运营）写的自由文本，而运营在通告列表里认领
 * 一张单靠的是码——码也是点开那个链接用的那一段。正文里那句「客户收到：…」已经把客户看到
 * 的原话搬过来了，而那三条文案本身不引用运营写的话（见 templates.ts）。
 */
function ticket(params: TemplateParams): string {
  return pick(params, "ticketNo");
}

/**
 * 客户模板 → 运营镜像。标题写运营视角，事实与客户模板同一条。
 * 严重度只在 warning / info 两档里选：critical 留给运维事故，客户事件不用。
 */
export const OPERATOR_MIRROR: Readonly<
  Record<NotificationTemplateCode, OperatorMirrorEntry>
> = {
  "subscription.expiring_soon": {
    severity: "info",
    title: (p) => `客户订阅即将到期 ${plan(p)}（${pick(p, "endAt")}）`,
  },
  "subscription.expired": {
    severity: "info",
    title: (p) => `客户订阅已到期 ${plan(p)}`,
  },
  "subscription.renewed": {
    severity: "info",
    title: (p) => `客户已续费 ${plan(p)} · ${order(p)}`,
  },
  "order.fulfilled": {
    severity: "info",
    title: (p) => `订阅已开通 ${plan(p)} · ${order(p)}`,
  },
  "order.renewal_created": {
    severity: "info",
    title: (p) => `已生成续费订单待付款 ${plan(p)} · ${order(p)}`,
  },
  /* 在等运营审核：直到处理不过期。 */
  "refund.requested": {
    severity: "warning",
    title: (p) => `客户申请退款 ${pick(p, "amount")} · ${order(p)}`,
  },
  "refund.approved": {
    severity: "info",
    title: (p) => `退款已审核通过 ${pick(p, "amount")} · ${order(p)}`,
  },
  "refund.rejected": {
    severity: "info",
    title: (p) => `退款申请已驳回 · ${order(p)}`,
  },
  "refund.completed": {
    severity: "info",
    title: (p) => `退款已完成 ${pick(p, "amount")} · ${order(p)}`,
  },
  /* 公告是运营自己发的，镜像只作「已推送」的回执；一条覆盖全部目标租户。 */
  "announcement.published": {
    severity: "info",
    broadcast: true,
    title: (p) => `公告已推送：${pick(p, "title")}`,
  },
  "tenant.invitation": {
    severity: "info",
    title: (p) => `${pick(p, "tenantName")} 邀请了新成员（${role(p)}）`,
  },
  /* 客户已申报、在等确认收款：拖着就是拖客户的钱。 */
  "order.payment_declared": {
    severity: "warning",
    title: (p) =>
      `客户已申报付款 ${pick(p, "amount")} · ${order(p)}，待确认收款`,
  },
  "order.cancelled": {
    severity: "info",
    title: (p) => `客户取消订单 · ${order(p)}（${pick(p, "productName")}）`,
  },
  "order.expired": {
    severity: "info",
    title: (p) => `订单付款超时关闭 · ${order(p)}（${pick(p, "productName")}）`,
  },
  "tenant.converted": {
    severity: "info",
    title: (p) => `${pick(p, "tenantName")} 已升为组织租户`,
  },
  /* 退订三态按退款结果分：只有「要退钱」那一条在等运营。 */
  "subscription.cancelled_refunded": {
    severity: "warning",
    title: (p) => `客户退订并申请退款 ${plan(p)} · ${order(p)}`,
  },
  "subscription.cancelled_no_charge": {
    severity: "info",
    title: (p) => `客户退订 ${plan(p)} · ${order(p)}（¥0 无收费）`,
  },
  "subscription.cancelled_no_refund": {
    severity: "info",
    title: (p) => `客户退订 ${plan(p)} · ${order(p)}（未退款：已过退款窗口）`,
  },
  "subscription.suspension_ended": {
    severity: "info",
    title: (p) => `暂停超期，订阅已终止 ${plan(p)}`,
  },
  "subscription.overdue": {
    severity: "info",
    title: (p) =>
      `客户订阅进入欠费宽限期 ${plan(p)}（${pick(p, "payBy")} 前付款）`,
  },
  "subscription.suspended": {
    severity: "info",
    title: (p) => `订阅已暂停 ${plan(p)}`,
  },
  "subscription.resumed": {
    severity: "info",
    title: (p) => `订阅已恢复 ${plan(p)}`,
  },
  "order.payment_rejected": {
    severity: "info",
    title: (p) => `付款申报已驳回 · ${order(p)}`,
  },
  "order.restored": {
    severity: "info",
    title: (p) => `订单已恢复付款 ${pick(p, "amount")} · ${order(p)}`,
  },
  /* 钱没打出去：客户模板参数里只有 orderNo，refundNo 由镜像从引用解析（见 resolveCodes）。 */
  "refund.failed": {
    severity: "warning",
    title: (p) => `退款执行失败 · ${pick(p, "refundNo") || order(p)}`,
  },
  /* 2026-12-01 退款转账线。「已打出」是运营自己刚登记的回执，info；两条 *_original_channel
     与它们的本体同一档——分的是客户那边的措辞，不是运营这边的严重度。镜像锚从客户引用 id
     派生，而发侧对 transfer_initiated 的引用 id 带第几次，所以第二次发起的镜像不会被吞。 */
  "refund.transfer_initiated": {
    severity: "info",
    title: (p) => `退款已打出 ${pick(p, "amount")} · ${order(p)}`,
  },
  "refund.approved_original_channel": {
    severity: "info",
    title: (p) => `退款已审核通过 ${pick(p, "amount")} · ${order(p)}`,
  },
  "refund.completed_original_channel": {
    severity: "info",
    title: (p) => `退款已完成 ${pick(p, "amount")} · ${order(p)}`,
  },
  /* ── 批 5（2026-09-28）的七条，逐条定过，结论是**七条全 info**。────────────
     本文件的 warning 有一个成文含义：「在等运营动手」，于是**不过期**、留在列表里
     直到有人处理。按这条判据逐条问「哪个运营动作能让这条消失」：
       · 两条认证结果 —— 运营**刚刚**自己审的（写入方就是 admin-bff 的 reviewVerification），
         镜像是回执；驳回之后球在客户那边（改资料重交），运营这边没有下一步。
       · 试用到期未转化 —— 没有任何「处理试用到期」的动作；那是销售跟进，不是待办。
       · 加油包开通 / 即将到期 / 用尽 / 过期 —— 客户自助再买一份即可，运营无动作；而且
         这三条来自**每趟重扫同一批行**的巡检，给成不过期的 warning 会在列表里越堆越多。
     给一条永远没人能「处理完」的 warning，正是 info / warning 这个分档要防的事。
     去重锚（mirrorDedupeKey = 模板:引用类型:引用 id）：
       认证 → `tenant:{租户可视码}:{本次审核时刻}`（发侧锚在**这一次审核**上，不锚租户：
         驳回后重新提交再审是另一件事，客户要再收到一次——所以审核时刻必须在键里。
         **不放认证行的 uuid**：`reference_id` 被客户收件箱的读路径原样投影给浏览器
         （console-bff 的 inbox.router → `InboxMessage.referenceId`），uuid 一进这一列
         就过了客户端那条线。形状照 console-bff 席位通告那条：冒号连接的可视码 + 一个
         会变的键。同形的历史债是 `tenant.converted`——那条今天仍是租户 uuid）；
       加油包 → `addon:{加油包单号}`（一单一池、池不重置，每条各一次）；
       「即将到期」那条再带上到期日（`单号:到期日`）：到期日被改了就该再提醒一次。
     链接：认证走引用类型 tenant → `/tenants/{tenant_no}`；加油包**没有**链接——admin 侧
     只有 `/addon-orders` 列表页，按本文件判据（有详情页才给链接）不给列表页链接，
     `mirrorLink` 为此按引用类型把 addon 排除在 `/orders/…` 之外。 */
  "tenant.verification_approved": {
    severity: "info",
    title: (p) => `企业认证已通过 ${pick(p, "tenantName")}`,
  },
  "tenant.verification_rejected": {
    severity: "info",
    title: (p) => `企业认证已驳回 ${pick(p, "tenantName")}`,
  },
  "subscription.trial_expired": {
    severity: "info",
    title: (p) => `客户试用到期未转化 ${plan(p)}`,
  },
  "addon.activated": {
    severity: "info",
    title: (p) => `加油包已开通 ${addon(p)}（${pick(p, "amount")}）`,
  },
  "addon.expiring_soon": {
    severity: "info",
    title: (p) => `客户加油包即将到期 ${addon(p)}（${pick(p, "endAt")}）`,
  },
  "addon.exhausted": {
    severity: "info",
    title: (p) => `客户加油包额度已用尽 ${addon(p)}`,
  },
  "addon.expired": {
    severity: "info",
    title: (p) => `客户加油包已到期 ${addon(p)}`,
  },
  /* 代客续期（2026-09-28 收尾）。**info**：运营自己刚按下的那个按钮，镜像是回执，
     没有任何「下一步」在等人做——正是本文件 warning（不过期、直到处理）要防的反面。
     标题里带上新的到期日：运营在列表里要能一眼看出续到了哪天。 */
  "subscription.renewed_by_operator": {
    severity: "info",
    title: (p) => `运营代客续期 ${plan(p)}（${pick(p, "endAt")}）`,
  },
  /* 维护暂停（2026-09-28 收尾）。**info，不是 warning**，按本文件对 warning 的成文含义
     （「在等运营动手」⇒ 不过期）逐条问「哪个运营动作能让这条消失」：
       · 暂停这件事是运营自己开维护窗口造成的，镜像是回执；
       · 恢复不需要人动手（窗口结束后作业自己放回来），单条订阅这边没有下一步；
       · 而且窗口一延长，同一条模板会带着新的预计恢复日期再镜像一条——给成不过期的
         warning 只会在列表里越堆越多。
     标题带上预计恢复日期：运营看这条最常被问的就是「什么时候回来」。 */
  "subscription.suspended_maintenance": {
    severity: "info",
    title: (p) =>
      `产品升级维护，客户订阅已暂停 ${plan(p)}（预计 ${pick(p, "resumeAt")} 恢复）`,
  },
  /* ── 成员邀请四态（2026-09-29）：**四条全 info**。────────────────────────────
     先问要不要镜像。邀请的收发是**租户自助**，运营在整条链上没有任何位置——发邀请、撤回、
     接受、拒绝都由客户自己点，过期由巡检算出来。按理这四条一条都不必进运营平面。
     但 `OPERATOR_MIRROR` 的类型是 `Record<NotificationTemplateCode, …>` 且分发器在第一个
     收件人落库后无条件镜像：这个形状**没有「不镜像」这一档**，只有 info / warning。硬造
     一档（比如 `skip: true`）要改分发器那条无条件路径，不在本次范围里，所以按现有形状走
     info——而且已经有先例：`tenant.invitation`（邀请发出）本来就是 info 镜像的，这四条正是
     它的另一半，只镜像「发出」不镜像「结果」反而是半截账。

     为什么不是 warning：本文件对 warning 的成文含义是「在等运营动手」⇒ 不过期、留在列表里
     直到有人处理。逐条问「哪个运营动作能让这条消失」：
       · accepted —— 人已经进来了，没有下一步；
       · declined —— 球在客户那边（要不要再邀请是他的事），运营不替他决定；
       · revoked  —— 客户自己撤的，镜像是回执；
       · expired  —— 来自**每趟重扫同一批行**的巡检，给成不过期的 warning 只会越堆越多，
                     而且平台没有「处理过期邀请」这个动作。
     给一条永远没人能「处理完」的 warning，正是 info / warning 这个分档要防的事。

     链接：引用类型是 `invitation` ⇒ `mirrorLink` 落在 null 那一档。判据与订阅 / 公告相同
     ——admin 侧没有按邀请的详情页，不给列表页链接。

     去重锚（`{模板}:invitation:{引用 id}`）：引用 id 的形状是
     `{租户可视码 10}:{邀请 id 的短摘要 12}:{终态}`，**过期那一档末尾再缀一个到期日**
     （`:{YYYY-MM-DD}`），一律**不含邀请行的 uuid**（reference_id 被客户收件箱的读路径原样
     投影给浏览器，见批 5 认证那段的同一条理由）。终态进锚是为了「每个状态各发一次」：同一条
     邀请 accepted 与 expired 不会互相吞掉。
     算术（列宽 varchar(128)）**分两档**——过期那一档长一截，此前这里只算了另一档：
       三个终态（accepted / declined / revoked）：引用 id = 10 + 1 + 12 + 1 + 终态最长 8
         = 32；镜像锚 = 最长模板码 `tenant.invitation_declined` 26 + 1 + `invitation` 10
         + 1 + 32 = 70。
       过期：重发会把过期行救回 pending 并顺延有效期，同一行能过期多次，所以发侧把到期日也
         写进引用 id（`invitationReferenceId`）：10 + 1 + 12 + 1 + 7 + 1 + 10 = 42；
         镜像锚 = `tenant.invitation_expired` 25 + 1 + 10 + 1 + 42 = 79。
     最坏情况 **79，余 49** —— 仍然远在列宽之内（行为一直没有风险，错的只是这个数）。
     摘要位宽由发侧定（@vxture/service-organization 的 invitationDigest，今天是 sha256 前
     12 位）；用例的样本现在**从那个函数取**而不是手抄，所以位宽一改这里当场红。 */
  "tenant.invitation_accepted": {
    severity: "info",
    title: (p) => `${pick(p, "tenantName")} 新成员已加入（${role(p)}）`,
  },
  "tenant.invitation_declined": {
    severity: "info",
    title: (p) => `${pick(p, "tenantName")} 的成员邀请被拒绝（${role(p)}）`,
  },
  "tenant.invitation_revoked": {
    severity: "info",
    title: (p) => `${pick(p, "tenantName")} 撤回了成员邀请（${role(p)}）`,
  },
  "tenant.invitation_expired": {
    severity: "info",
    title: (p) => `${pick(p, "tenantName")} 的成员邀请已过期（${role(p)}）`,
  },
  /* ══ 账号安全线（2026-09-29）：**这张表没有「不镜像」这一档，而 owner 裁定要的正是它** ══
     owner 裁定 5：「安全事件不进运营通告流。」裁定同时写着：镜像是**按模板强制配**的，
     所以落码时要查清这张表有没有「运营侧看不见 / 不打扰」的那一档，**没有就停下来说，
     不要自己发明一个**。

     查的结果是：**没有**。逐条核实过，写在这里，免得下一个人再查一遍：
       · `OperatorMirrorEntry` 只有三个字段：`severity`（成文的两档 `info | warning`）、
         `title`、`broadcast?: true`。
       · `broadcast` **不是**「不镜像」：它只让 `mirrorBody` 不查租户、正文不带租户名
         （见 `composeOperatorNotice`），那一行照样写进 `admin.operator_notices`。
       · `composeOperatorNotice` 无条件返回一条待写的通告，没有「返回空」的形状。
       · 分发器那一侧也是无条件的：`notify` 在**第一个**站内落库成功之后直接
         `await this.mirrorToOperators(...)`，不看模板。
     所以在本文件里表达「这条不镜像」，只能给 `OperatorMirrorEntry` 加一个字段并在分发器那条
     无条件路径上开一个分支——那是**发明一档**，裁定明文不许，本批因此没有做。
     （成员邀请四态那一段里已经记着同一件事：「硬造一档（比如 skip: true）要改分发器那条
     无条件路径，不在本次范围里」。那一批的结论是照现有形状走 info；本批不能照抄那个结论，
     因为 owner 对安全事件**明确裁定过相反的方向**。）

     ── 那么这十四条现在怎么办 ──
     现有形状里**唯一**能表达「不镜像」的地方不在本文件，而在装配处：
     `NotificationDispatcherOptions.operatorMirror` 显式传 `null`，它的注释原话是
     「显式 null = 不镜像（只给测试 / 明确不要镜像的装配处）」——**这是既有的逃生口，不是
     发明的**。本批的写入方里：
       · auth-bff（重置令牌、三方绑解绑、新设备登录）与 website-bff（改密）今天**没有**
         任何 `new NotificationDispatcher`，要新建装配，所以它们那一侧**必须**传
         `operatorMirror: null` —— 客户自助的那十一条就此一条都不进运营通告流，裁定 5 成立。
       · 锁定 / 解锁 / 全端下线这三条的写入方**不在 admin-bff**。admin-bff 从来不
         构造 `AccountService`：`commerce-services.provider.ts` 里那个共享分发器只交给
         订单 / 加油包 / 订阅三个 service（`setCustomerNotifier` 就这三处），而这三个动作
         走的是 `OperatorAdminService.delegate`——一次 S2S POST 打到 IdP 的
         `/internal/account/users/:id/{disable,enable,sessions/revoke}`。所以它们和客户自助
         那几条**跑在同一个进程里**：auth-bff 的 `AccountAdminInternalRouter`
         → `AccountService.adminDisableAccount / adminEnableAccount / adminForceLogout`
         → `notifySecurity`。
         而那个进程在本批之前**一个分发器都没有**，`setCustomerNotifier` 从未被调过，
         而未注入 = 一条都不发——**这才是这三条今天没在镜像的唯一原因**，不是「共享
         分发器做不到按模板关掉」。一个零调用方的缺口被记成了一条技术约束。
         本批给那个进程新建的装配（auth-bff 的
         `notifications/customer-notifications.wiring.ts`）因此**必须**传 `operatorMirror: null`，
         与 console-bff 交给 `AccountService` 那个逐字相同。而一个进程一条装配、一条装配
         管落在它身上的全部模板，所以这个逃生口是**全有或全无**的：今天做不到「只
         镜像运营这三条、压掉客户自助那些」。
         （这三条本身的性质没变：它们是**运营自己刚按下的那个按钮**的回执，与
         `tenant.verification_approved` 同一形状，既不是客户侧的流水、也不带任何设备与位置
         信息，不构成裁定 5 说的那个「淹没」——所以该不该镜像仍然是个开放项，只是拦住
         它的不是技术上做不到。）
     **这一条是给 owner 的开放项**：要让它在模板这一层也能关掉，就得在 `OperatorMirrorEntry`
     上开一档并改分发器那条无条件路径；本批按裁定停在这里，不替他决定。

     ── 落进这些标题里的东西，逐样过了一遍 ──
     **没有 IP、没有 User-Agent、没有设备串、没有地区、没有邮箱与手机号、没有 uuid。**
     客户文案里本来就一个都没写（见 templates.ts 那几段），而镜像正文是「客户收到的原文」
     ——原文里没有的东西，镜像里也变不出来。所以即使某一处装配忘了传 `operatorMirror: null`，
     运营屏幕上出现的也只是「某租户的某个账号在某时刻发生了某件事」，不会是一串客户的设备与
     位置。这是本段第二个必须守住的点，与上面那个同等重要。

     ── 为什么十四条**全 info**，一条 warning 都没有 ──
     本文件对 warning 有一个成文含义：「在等运营动手」⇒ **不过期**、留在列表里直到有人处理。
     逐条问「哪个运营动作能让这条消失」：
       · 锁定 / 解锁 / 全端下线 —— 运营**刚刚**自己做的，镜像是回执，没有下一步；
       · 改密 / 重置 / 换手机号 / 换邮箱 / 绑解绑 / 密码登录开关 / 自己下线设备 —— 全是客户
         自助，运营一个动作都没有；真被接管了，客户走的是「联系客服」那条人工线，不是通告列表；
       · 新设备登录 —— 同上，而且它是本批里唯一会**反复**发生的一条，给成不过期的 warning
         只会在列表里越堆越多。
     给一条永远没人能「处理完」的 warning，正是 info / warning 这个分档要防的事。

     去重锚 = `{模板}:security:{sec:可视用户号:事件名:ISO 时刻}`（形状与长度见 templates.ts 的
     `securityEventStamp`，用例按真实码表重算，不手抄）。链接一律 null：引用类型 `security`
     落在 `mirrorLink` 的兜底档，admin 侧没有按安全事件的详情页（判据与订阅 / 邀请 / 公告相同）。 */
  "account.locked": {
    severity: "info",
    title: (p) => `客户账号已被平台锁定（${occurredAt(p)}）`,
  },
  "account.unlocked": {
    severity: "info",
    title: (p) => `客户账号已解除锁定（${occurredAt(p)}）`,
  },
  "account.sessions_ended_by_operator": {
    severity: "info",
    title: (p) => `客户账号已被平台全端下线（${occurredAt(p)}）`,
  },
  /* 标题不带操作者（是客户自己改的还是组织管理员代设的）：那个词是客户视角写的，
     见 `provider` 上面那段。运营要分辨时看正文里客户收到的原文。 */
  "account.password_changed": {
    severity: "info",
    title: (p) => `客户登录密码已修改（${occurredAt(p)}）`,
  },
  "account.password_reset": {
    severity: "info",
    title: (p) => `客户已用邮件链接重置登录密码（${occurredAt(p)}）`,
  },
  "account.phone_changed": {
    severity: "info",
    title: (p) => `客户账号手机号已更换（${occurredAt(p)}）`,
  },
  /* 邮箱变更两条各自成条：运营要能看出「原地址那封发出去了」——那封是真正的本人唯一
     可能收到的线索，漏发与发了在处理接管投诉时是两回事。**两条都不印地址。** */
  "account.email_changed_old": {
    severity: "info",
    title: (p) => `客户账号邮箱已换走，已通知原地址（${occurredAt(p)}）`,
  },
  "account.email_changed_new": {
    severity: "info",
    title: (p) => `客户账号邮箱已换为新地址（${occurredAt(p)}）`,
  },
  "account.identity_linked": {
    severity: "info",
    title: (p) => `客户绑定了「${provider(p)}」登录（${occurredAt(p)}）`,
  },
  "account.identity_unlinked": {
    severity: "info",
    title: (p) => `客户解绑了「${provider(p)}」登录（${occurredAt(p)}）`,
  },
  "account.password_login_enabled": {
    severity: "info",
    title: (p) => `客户开启了账号密码登录（${occurredAt(p)}）`,
  },
  "account.password_login_disabled": {
    severity: "info",
    title: (p) => `客户关闭了账号密码登录（${occurredAt(p)}）`,
  },
  "account.session_ended_by_self": {
    severity: "info",
    title: (p) => `客户自行下线了一台设备（${occurredAt(p)}）`,
  },
  "account.new_device_signin": {
    severity: "info",
    title: (p) => `客户在新设备上登录（${occurredAt(p)}）`,
  },
  /* ── 工单线（2026-09-29）：**三条全 info**。──────────────────────────────────
     按本文件对 warning 的成文含义（「在等运营动手」⇒ 不过期、留在列表里直到有人处理）
     逐条问「哪个运营动作能让这条消失」：
       · replied  —— 运营**刚刚**自己按下的那个「回复客户」，镜像是回执；球回到客户那边
         （要不要接着说话是他的事），运营这边没有下一步。
       · resolved —— 同上，是我方刚做出的判断；客户不认可时他会回一句，而那一句由
         **运营侧信号巡检**单独发一条不过期的 warning（platform-api 的
         `ticket.customer_replied`），不靠这张表。

         初稿这里写的是「那一句会自己变成待办（由 @vxture/service-ops-todos 那条算法管）」
         ——**那个机制不存在**。ops-todos 把 `support.ticket_comments` 列在它的禁用关系
         清单里，按设计不读流水；它的 `ticket` 那一档只看状态
         （`status not in (resolved/closed/cancelled)`），客户回一句既不换档也不换严重度。
         写下这条理由时客户侧还没有回复入口，所以没人能发现它是句空话。
         客户侧上线同一批里补上了巡检那一类，这条理由才算真成立。

         尚未做的一处（已知，不假装它不存在）：客户回复会抬 `tickets.updated_at`，
         而 ops-todos 未超时时取 `waiting_since = updated_at` 且按它升档——所以客户追得越勤，
         那张单在待办列表里越不容易升档。信号本身不丢（巡检那条 warning 不过期），
         但排序这一层要改得动 ops-todos 那条唯一算法的取值语义，不在本批自决。
       · closed   —— 终态，工作已经裁定不再继续，定义上没有下一步。
     而且 `replied` 是本批里会**反复**发生的一条（一张单来回十句是常态），给成不过期的
     warning 只会在列表里越堆越多——这正是 info / warning 这个分档要防的事。

     **正文里不会出现回复原文**：镜像正文的最后一段是「客户收到的那条原文」，而客户那三条
     文案一个字都不引用运营写的话（见 templates.ts 那一段）。所以运营在通告列表里读到的是
     「某租户的某张单被回复了」，不是那段话本身——那段话在工单详情页，一处。
     顺带这也答了一个会被问到的问题：内部备注（`internal_note`）压根不会走到这里，
     因为它**不发通知**（写入方只在 `reply` / `resolved` / `closed` 三处调分发器）。

     去重锚 = `{模板}:ticket:{可视工单码:事件名:ISO 时刻}`（形状与长度见 templates.ts 的
     `ticketEventReference`，用例按真实码表重算，不手抄）。
     链接：引用类型 `ticket` ⇒ `/tickets/{可视工单码}`。判据是本文件一贯的那条「有详情页才
     给链接」——admin 侧确实有按工单码的详情页（`tickets/[ticketId]`，那个参数收的就是
     `ticket_no`），这与订阅 / 邀请 / 加油包落在 null 那一档的理由正好相反。 */
  "ticket.replied": {
    severity: "info",
    title: (p) => `工单已回复客户 · ${ticket(p)}`,
  },
  "ticket.resolved": {
    severity: "info",
    title: (p) => `工单已标记处理完成 · ${ticket(p)}`,
  },
  "ticket.closed": {
    severity: "info",
    title: (p) => `工单已关闭 · ${ticket(p)}`,
  },
};

/** 去重锚的 reference_type。与 opera 人工发布（reference 两列为空）天然分开。 */
export const OPERATOR_MIRROR_REFERENCE_TYPE = "customer_event";
/** 只投 admin 平面。 */
export const OPERATOR_MIRROR_PLANES: readonly NoticePlane[] = ["admin"];
/** info 类保留 30 天；warning 类不过期（expires_at = null）。 */
export const OPERATOR_MIRROR_INFO_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface MirrorReference {
  readonly type: NotificationReferenceType;
  readonly id: string;
}

/** 与客户收件箱唯一键同一粒度：模板 × 引用。 */
export function mirrorDedupeKey(
  code: NotificationTemplateCode,
  reference: MirrorReference,
): string {
  return `${code}:${reference.type}:${reference.id}`;
}

/**
 * 链接：能落到 admin 路由就给。
 *   · 参数里有 orderNo（订单 / 退款 / 退订类都带）→ /orders/{order_no}
 *   · 引用是工单 → /tickets/{ticket_no}
 *   · 引用是租户 → /tenants/{tenant_no}
 *   · 其余 null（订阅到期 / 暂停 / 邀请 / 公告 / 安全事件没有对应的详情页）
 * 只给可视码，绝不把 uuid 放进地址栏。
 *
 * **加油包（引用类型 addon）故意落在 null 这一档**：admin 只有 `/addon-orders` 列表页，
 * 没有按加油包单号的详情页，判据是「有详情页才给链接」。
 *
 * 它的单号参数与订单一样叫 `orderNo`（全仓一套词汇，调用方按直觉就是这么传的），所以
 * 第一条必须**按引用类型**把 addon 排除掉：`metering.addon_purchases.order_no` 在
 * `billing.orders` 里查不到，`/orders/{加油包单号}` 是一条点开 404 的死链。把这道防线
 * 放在参数名上是只长在一条分支的守卫——下一个人照直觉传 `orderNo` 就又开了门。
 */
export function mirrorLink(
  referenceType: NotificationReferenceType,
  params: TemplateParams,
  tenantNo: string | null,
): string | null {
  const orderNo = order(params);
  if (orderNo && referenceType !== "addon") {
    return `/orders/${encodeURIComponent(orderNo)}`;
  }
  /* 工单（2026-09-29）：admin 侧有按可视工单码的详情页（`tickets/[ticketId]`，那个参数收的
     就是 `ticket_no`），所以按本函数一贯的判据「有详情页才给链接」给出链接。
     码取不到时回 null 而不是 `/tickets/`——一个指向列表页的半截链接比没有链接更糟。 */
  if (referenceType === "ticket") {
    const ticketNo = ticket(params);
    return ticketNo ? `/tickets/${encodeURIComponent(ticketNo)}` : null;
  }
  if (referenceType === "tenant" && tenantNo) {
    return `/tenants/${encodeURIComponent(tenantNo)}`;
  }
  return null;
}

export interface OperatorMirrorFacts {
  readonly code: NotificationTemplateCode;
  readonly reference: MirrorReference;
  readonly params: TemplateParams;
  /** 客户实际收到的那条（第一个落库收件人的渲染结果）。 */
  readonly customer: { readonly title: string; readonly body: string };
  readonly tenant: { readonly name: string | null; readonly no: string | null };
  /** 从引用解析出的可视码；参数里已有的优先。 */
  readonly resolved: {
    readonly orderNo: string | null;
    readonly refundNo: string | null;
  };
  readonly now?: Date | undefined;
}

/** 纯函数：事实 → 一条待写的系统通告。单测逐模板断言的就是它。 */
export function composeOperatorNotice(
  facts: OperatorMirrorFacts,
): CreateSystemNoticeInput {
  const entry = OPERATOR_MIRROR[facts.code];
  const params: TemplateParams = { ...facts.params };
  if (!order(params) && facts.resolved.orderNo) {
    params.orderNo = facts.resolved.orderNo;
  }
  if (!pick(params, "refundNo") && facts.resolved.refundNo) {
    params.refundNo = facts.resolved.refundNo;
  }
  const now = facts.now ?? new Date();
  return {
    targetPlanes: OPERATOR_MIRROR_PLANES,
    severity: entry.severity,
    // 列宽 varchar(256)；参数来自库里的产品名 / 单号，正常远不到，截断只是兜底。
    title: entry.title(params).slice(0, 256),
    body: mirrorBody(entry, params, facts.tenant.name, facts.customer),
    link: mirrorLink(facts.reference.type, params, facts.tenant.no),
    referenceType: OPERATOR_MIRROR_REFERENCE_TYPE,
    referenceId: mirrorDedupeKey(facts.code, facts.reference),
    expiresAt:
      entry.severity === "warning"
        ? null
        : new Date(now.getTime() + OPERATOR_MIRROR_INFO_TTL_MS),
  };
}

function mirrorBody(
  entry: OperatorMirrorEntry,
  params: TemplateParams,
  tenantName: string | null,
  customer: { title: string; body: string },
): string {
  const parts: string[] = [];
  if (!entry.broadcast && tenantName) parts.push(`租户 ${tenantName}`);
  const planText = plan(params);
  if (planText) parts.push(planText);
  const amount = pick(params, "amount");
  if (amount) parts.push(amount);
  parts.push(`客户收到：「${customer.title}」${customer.body}`);
  return parts.join(" · ");
}

/** 写侧端口：@vxture/service-notice 的 PgNoticeRepository / NoticeService 都满足。 */
export interface SystemNoticeWriter {
  createSystemNotice(
    input: CreateSystemNoticeInput,
  ): Promise<CreateSystemNoticeResult>;
}

export interface MirrorLogger {
  warn(message: string): void;
}

export interface OperatorMirrorInput {
  readonly tenantId: string;
  readonly templateCode: NotificationTemplateCode;
  readonly reference: MirrorReference;
  readonly params: TemplateParams;
}

/** 分发器看到的镜像面。测试用它注入一个会抛的实现，证明客户消息不受影响。 */
export interface OperatorMirrorPort {
  mirror(
    input: OperatorMirrorInput,
    customer: { readonly title: string; readonly body: string },
  ): Promise<void>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 三条查询导出**只为让 spec 能对谓词下断言**——假 pool 不解析 SQL。
 * 租户名取 display_name（日常展示名），空则回落认证名 name；tenant_no 是 bigint，
 * 转 text 免得 pg 交回 string 还是 number 要猜。
 */
export const MIRROR_TENANT_SQL = `select tenant_no::text as tenant_no,
              coalesce(nullif(display_name, ''), name) as tenant_name
         from tenancy.tenants
        where id = $1`;
export const MIRROR_ORDER_SQL = `select order_no from billing.orders where id = $1`;
export const MIRROR_REFUND_SQL = `select r.refund_no, o.order_no
         from billing.refunds r
         left join billing.orders o on o.id = r.order_id
        where r.id = $1`;

export class OperatorMirror implements OperatorMirrorPort {
  constructor(
    private readonly pool: Pool,
    private readonly notices: SystemNoticeWriter,
    private readonly logger: MirrorLogger,
  ) {}

  /**
   * 永不抛。三步各自降级：租户查不到就不带租户名，可视码解析不到就不带链接，
   * 写库失败只记日志——客户那条消息已经落库，这里的任何失败都不该反过来影响它。
   */
  async mirror(
    input: OperatorMirrorInput,
    customer: { readonly title: string; readonly body: string },
  ): Promise<void> {
    const key = mirrorDedupeKey(input.templateCode, input.reference);
    try {
      const entry = OPERATOR_MIRROR[input.templateCode];
      const [tenant, resolved] = await Promise.all([
        entry.broadcast
          ? Promise.resolve({ name: null, no: null })
          : this.safe(
              () => this.lookupTenant(input.tenantId),
              { name: null, no: null },
              `${key}: tenant lookup failed`,
            ),
        this.safe(
          () => this.resolveCodes(input.reference, input.params),
          { orderNo: null, refundNo: null },
          `${key}: reference lookup failed`,
        ),
      ]);
      await this.notices.createSystemNotice(
        composeOperatorNotice({
          code: input.templateCode,
          reference: input.reference,
          params: input.params,
          customer,
          tenant,
          resolved,
        }),
      );
    } catch (err) {
      this.logger.warn(`operator mirror skipped for ${key} — ${String(err)}`);
    }
  }

  private async safe<T>(
    fn: () => Promise<T>,
    fallback: T,
    label: string,
  ): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      this.logger.warn(`${label} — ${String(err)}`);
      return fallback;
    }
  }

  private async lookupTenant(
    tenantId: string,
  ): Promise<{ name: string | null; no: string | null }> {
    const res = await this.pool.query<{
      tenant_no: string | null;
      tenant_name: string | null;
    }>(MIRROR_TENANT_SQL, [tenantId]);
    const row = res.rows[0];
    const name = row?.tenant_name?.trim();
    return { name: name ? name : null, no: row?.tenant_no ?? null };
  }

  /**
   * 从引用解析可视码。订单引用 = 订单 uuid；退款引用 = `{退款 uuid}:{阶段}`。
   * 参数里已带 orderNo 的订单引用不查；退款引用总要查一次——refund_no 只有库里有，
   * 而「退款执行失败」的标题要它。形状不像 uuid 的引用（复合键等）不查，免得 22P02。
   */
  private async resolveCodes(
    reference: MirrorReference,
    params: TemplateParams,
  ): Promise<{ orderNo: string | null; refundNo: string | null }> {
    const none = { orderNo: null, refundNo: null };
    if (reference.type === "refund") {
      const refundId = reference.id.split(":")[0] ?? "";
      if (!UUID_RE.test(refundId)) return none;
      const res = await this.pool.query<{
        refund_no: string | null;
        order_no: string | null;
      }>(MIRROR_REFUND_SQL, [refundId]);
      const row = res.rows[0];
      return {
        orderNo: row?.order_no ?? null,
        refundNo: row?.refund_no ?? null,
      };
    }
    if (reference.type === "order" && !order(params)) {
      if (!UUID_RE.test(reference.id)) return none;
      const res = await this.pool.query<{ order_no: string | null }>(
        MIRROR_ORDER_SQL,
        [reference.id],
      );
      return { orderNo: res.rows[0]?.order_no ?? null, refundNo: null };
    }
    return none;
  }
}
