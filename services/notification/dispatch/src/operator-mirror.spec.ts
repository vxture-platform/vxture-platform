/**
 * operator-mirror.spec.ts — **每个**客户模板至少一条断言（严重度 / 标题 / 去重键），
 * 警告类再断言链接；镜像与写库 / 查库分开测：composeOperatorNotice 是纯函数，
 * OperatorMirror 用假 pool 只测解析与降级。
 *
 * CASES 的类型也是 Record<NotificationTemplateCode, …>：新加模板不但 OPERATOR_MIRROR
 * 编译不过，这里也编译不过——两处都得补，少一处就红。
 */
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { CreateSystemNoticeInput } from "@vxture/service-notice";
import {
  MIRROR_ORDER_SQL,
  MIRROR_REFUND_SQL,
  MIRROR_TENANT_SQL,
  OPERATOR_MIRROR,
  OPERATOR_MIRROR_INFO_TTL_MS,
  OperatorMirror,
  composeOperatorNotice,
  mirrorDedupeKey,
  mirrorLink,
  type MirrorReference,
} from "./operator-mirror";
import {
  NOTIFICATION_TEMPLATES,
  SECURITY_TEMPLATE_CODES,
  render,
  securityEventStamp,
  type NotificationTemplateCode,
  type SecurityTemplateCode,
  type TemplateParams,
} from "./templates";
/**
 * 发侧（@vxture/service-organization）的引用 id 辅助函数。**样本从这里取，不手抄。**
 *
 * 跨包相对导入的理由与 templates.spec.ts 里那一处相同：`invitation-notifications.ts` 只
 * import node:crypto 与两个同包的零依赖文件，所以按路径只拉它们几个，类型与运行时都成立
 * （dep-cruiser 允许 services → services 同层）。它搬家时这条导入当场报错——那正是希望的
 * 行为：一个事实两处各写一份的对账不该悄悄失效。
 */
import {
  invitationDigest,
  invitationReferenceId,
  type InvitationTerminalState,
} from "../../../identity/organization/src/service/invitation-notifications";

const ORDER_ID = "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const REFUND_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const TENANT_ID = "1a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const orderRef: MirrorReference = { type: "order", id: ORDER_ID };
const refundRef = (stage: string): MirrorReference => ({
  type: "refund",
  id: `${REFUND_ID}:${stage}`,
});
const subRef: MirrorReference = {
  type: "subscription",
  id: "sub-1:2026-09-10",
};
/* 批 5：加油包引用 = 加油包单号（可视码，住 metering.addon_purchases，不是
   billing.orders——所以引用类型另立一档）。
   认证引用 = `{租户可视码}:{本次审核时刻}`（2026-09-28 收尾改的形状）：锚在**这一次
   审核**上，锚租户的话驳回后重新提交再审就被唯一键吞掉；而**不放认证行的 uuid**，
   因为 reference_id 被客户收件箱的读路径原样投影给浏览器（console-bff 的
   inbox.router → InboxMessage.referenceId）。 */
const addonRef: MirrorReference = { type: "addon", id: "ORD-202609-7a1b2c" };
const VERIFY_TENANT_NO = "8800000012";
const verifyRef = (reviewedAt: string): MirrorReference => ({
  type: "tenant",
  id: `${VERIFY_TENANT_NO}:${reviewedAt}`,
});
/* 2026-09-29 成员邀请四态。引用 id = `{租户可视码}:{邀请 id 的短摘要}:{终态}`，过期那一档
   末尾再缀一个到期日，一律**不含邀请行的 uuid**（reference_id 被客户收件箱的读路径原样投影
   给浏览器，与批 5 认证那两条同一条理由）。终态进锚是为了「每个状态各发一次」——同一条邀请
   的 accepted 与 expired 不会被唯一键互相吞掉。租户可视码沿用上面那个常量：是同一个租户。

   **样本调发侧那个函数算，不手抄一串字面量。** 此前这里是手抄的，于是发侧改了摘要位宽、
   或者给某一档加了新的段（过期那一档的到期日就是这么加上的），这边照样绿——注释里那句
   「= 32，镜像锚 70」两处各写一份，也就一起错、一起没人发现。
   邀请行 id 用一个真 uuid：摘要要盖住它，下面的断言按「原样的 uuid 不许出现」验。 */
const INVITE_ID = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
/** 到期日进的是**过期那一档**的引用 id：重发会把过期行救回 pending 并顺延，同一行能过期多次。 */
const INVITE_EXPIRES_AT = new Date("2026-10-06T03:00:00Z");
const inviteRef = (state: InvitationTerminalState): MirrorReference => ({
  type: "invitation",
  id: invitationReferenceId(
    VERIFY_TENANT_NO,
    INVITE_ID,
    state,
    INVITE_EXPIRES_AT,
  ),
});
const inviteParams = {
  tenantName: "Acme",
  /* 参数里是**角色码**（发侧原样传），运营标题里该出现的是中文角色名——词由模板层给，
     见 templates.ts 的 roleNameOf。此前这里传的是码、断言的也是码，于是运营列表里读到的角色
     是那个内部码而不是词。 */
  roleKey: "member",
  inviteeName: "ann@acme.example",
  expiresAt: "2026-10-06",
};

/* ── 账号安全线（2026-09-29）──
   引用与展示时刻都**从 `securityEventStamp` 取，不手抄**：那个函数保证两者出自同一个 Date，
   而手抄一串字面量的代价这一批已经付过一次（邀请那一组的长度算术两处各写一份、一起错）。
   时刻故意带秒（平台的日期时间纪律点名了通知：同一分钟内的先后顺序最要紧）。 */
const SEC_USER_NO = "8800000012";
const SEC_AT = new Date("2026-09-29T12:14:32Z");
const secStamp = (code: NotificationTemplateCode) =>
  securityEventStamp(code as SecurityTemplateCode, SEC_USER_NO, SEC_AT);
const secRef = (code: NotificationTemplateCode): MirrorReference =>
  secStamp(code).reference;
/** 十四条共用的展示时刻（同一个 Date ⇒ 同一个串）。 */
const SEC_WHEN = secStamp("account.locked").occurredAt;
const secParams: TemplateParams = { occurredAt: SEC_WHEN };
/** 运营填的原因（owner 裁定 3：那三个弹窗的原因改必填，并照搬给客户）。 */
const secReasonParams: TemplateParams = {
  occurredAt: SEC_WHEN,
  reason: "风控命中：同一账号在 10 分钟内 40 次失败登录",
};

const planParams = { productName: "Arda", planName: "Pro" };
const orderParams = { ...planParams, orderNo: "ORD-202609-1" };
const addonParams = {
  packName: "AI 加油包 10 万 tokens",
  orderNo: "ORD-202609-7a1b2c",
  endAt: "2026-12-27",
};

interface Case {
  reference: MirrorReference;
  params: TemplateParams;
  severity: "info" | "warning";
  title: string;
  /** 警告类必须给：运营点开要能落到处理页。 */
  link?: string;
}

const CASES: Record<NotificationTemplateCode, Case> = {
  "subscription.expiring_soon": {
    reference: subRef,
    params: { ...planParams, endAt: "2026-09-10", days: 3 },
    severity: "info",
    title: "客户订阅即将到期 Arda Pro（2026-09-10）",
  },
  "subscription.expired": {
    reference: subRef,
    params: { ...planParams, endAt: "2026-09-10" },
    severity: "info",
    title: "客户订阅已到期 Arda Pro",
  },
  "subscription.renewed": {
    reference: orderRef,
    params: { ...orderParams, endAt: "2027-09-10", amount: "¥199.00" },
    severity: "info",
    title: "客户已续费 Arda Pro · ORD-202609-1",
  },
  "order.fulfilled": {
    reference: orderRef,
    params: { ...orderParams, endAt: "2027-09-10", amount: "¥199.00" },
    severity: "info",
    title: "订阅已开通 Arda Pro · ORD-202609-1",
  },
  "order.renewal_created": {
    reference: orderRef,
    params: { ...orderParams, amount: "¥199.00", payBy: "2026-10-01" },
    severity: "info",
    title: "已生成续费订单待付款 Arda Pro · ORD-202609-1",
  },
  "refund.requested": {
    reference: refundRef("requested"),
    params: { orderNo: "ORD-202609-1", amount: "¥99.00" },
    severity: "warning",
    title: "客户申请退款 ¥99.00 · ORD-202609-1",
    link: "/orders/ORD-202609-1",
  },
  "refund.approved": {
    reference: refundRef("approved"),
    params: { orderNo: "ORD-202609-1", amount: "¥99.00", reason: "ok" },
    severity: "info",
    title: "退款已审核通过 ¥99.00 · ORD-202609-1",
  },
  "refund.rejected": {
    reference: refundRef("rejected"),
    params: { orderNo: "ORD-202609-1", amount: "¥99.00", reason: "超期" },
    severity: "info",
    title: "退款申请已驳回 · ORD-202609-1",
  },
  "refund.completed": {
    reference: refundRef("completed"),
    params: { orderNo: "ORD-202609-1", amount: "¥99.00" },
    severity: "info",
    title: "退款已完成 ¥99.00 · ORD-202609-1",
  },
  "announcement.published": {
    reference: { type: "announcement", id: "ann-1" },
    params: { title: "维护通知", content: "周六 02:00 升级。" },
    severity: "info",
    title: "公告已推送：维护通知",
  },
  "tenant.invitation": {
    reference: { type: "invitation", id: "inv-1" },
    params: {
      tenantName: "Acme",
      inviterName: "Ann",
      roleKey: "member",
      expiresAt: "2026-09-12",
    },
    severity: "info",
    title: "Acme 邀请了新成员（成员）",
  },
  "order.payment_declared": {
    reference: orderRef,
    params: { ...orderParams, amount: "¥199.00" },
    severity: "warning",
    title: "客户已申报付款 ¥199.00 · ORD-202609-1，待确认收款",
    link: "/orders/ORD-202609-1",
  },
  "order.cancelled": {
    reference: orderRef,
    params: orderParams,
    severity: "info",
    title: "客户取消订单 · ORD-202609-1（Arda）",
  },
  "order.expired": {
    reference: orderRef,
    params: orderParams,
    severity: "info",
    title: "订单付款超时关闭 · ORD-202609-1（Arda）",
  },
  "tenant.converted": {
    reference: { type: "tenant", id: TENANT_ID },
    params: { tenantName: "Acme" },
    severity: "info",
    title: "Acme 已升为组织租户",
  },
  "subscription.cancelled_refunded": {
    reference: subRef,
    params: { ...orderParams, amount: "¥99.00" },
    severity: "warning",
    title: "客户退订并申请退款 Arda Pro · ORD-202609-1",
    link: "/orders/ORD-202609-1",
  },
  "subscription.cancelled_no_charge": {
    reference: subRef,
    params: { ...orderParams, amount: "¥0.00" },
    severity: "info",
    title: "客户退订 Arda Pro · ORD-202609-1（¥0 无收费）",
  },
  "subscription.cancelled_no_refund": {
    reference: subRef,
    params: { ...orderParams, amount: "¥99.00" },
    severity: "info",
    title: "客户退订 Arda Pro · ORD-202609-1（未退款：已过退款窗口）",
  },
  "subscription.suspension_ended": {
    reference: subRef,
    params: { ...planParams, endAt: "2026-09-10" },
    severity: "info",
    title: "暂停超期，订阅已终止 Arda Pro",
  },
  "subscription.overdue": {
    reference: subRef,
    params: { ...planParams, endAt: "2026-09-10", payBy: "2026-09-17" },
    severity: "info",
    title: "客户订阅进入欠费宽限期 Arda Pro（2026-09-17 前付款）",
  },
  "subscription.suspended": {
    reference: subRef,
    params: { ...planParams, endAt: "2026-09-10" },
    severity: "info",
    title: "订阅已暂停 Arda Pro",
  },
  "subscription.resumed": {
    reference: subRef,
    params: { ...planParams, endAt: "2026-09-10" },
    severity: "info",
    title: "订阅已恢复 Arda Pro",
  },
  "order.payment_rejected": {
    reference: orderRef,
    params: { ...orderParams, reason: "金额不符" },
    severity: "info",
    title: "付款申报已驳回 · ORD-202609-1",
  },
  "order.restored": {
    reference: orderRef,
    params: { ...orderParams, amount: "¥199.00" },
    severity: "info",
    title: "订单已恢复付款 ¥199.00 · ORD-202609-1",
  },
  "refund.failed": {
    reference: refundRef("failed"),
    params: { orderNo: "ORD-202609-1", amount: "¥99.00" },
    severity: "warning",
    title: "退款执行失败 · RFD-202609-1",
    link: "/orders/ORD-202609-1",
  },
  /* 批 5（2026-09-28）：七条**全 info**。判据是本文件对 warning 的成文含义——
     「在等运营动手，直到处理才消失」。两条认证结果是运营刚刚自己审的回执；试用到期
     没有「处理试用到期」这个动作；加油包四条客户自助再买一份即可，而且来自每趟重扫
     同一批行的巡检，给成不过期的 warning 只会越堆越多。 */
  "tenant.verification_approved": {
    reference: verifyRef("2026-09-28T02:30:00.000Z"),
    params: { tenantName: "Acme", reviewedAt: "2026-09-28" },
    severity: "info",
    title: "企业认证已通过 Acme",
  },
  /* 第二次审核 = 另一个审核时刻，去重锚因此不同（同一个租户可视码也不会撞）——这就是
     「驳回后重新提交再审，客户要再收到一次」那一条靠的东西。 */
  "tenant.verification_rejected": {
    reference: verifyRef("2026-09-30T06:00:00.000Z"),
    params: { tenantName: "Acme", reason: "营业执照号与企业名称不一致" },
    severity: "info",
    title: "企业认证已驳回 Acme",
  },
  "subscription.trial_expired": {
    reference: subRef,
    params: { ...planParams, endAt: "2026-09-10" },
    severity: "info",
    title: "客户试用到期未转化 Arda Pro",
  },
  "addon.activated": {
    reference: addonRef,
    params: { ...addonParams, amount: "¥99.00" },
    severity: "info",
    title: "加油包已开通 AI 加油包 10 万 tokens · ORD-202609-7a1b2c（¥99.00）",
  },
  "addon.expiring_soon": {
    // 发侧的去重键是 `单号:到期日`（到期日被改了该再提醒一次）；这里照那个形状。
    reference: { type: "addon", id: "ORD-202609-7a1b2c:2026-12-27" },
    params: { ...addonParams, days: 7 },
    severity: "info",
    title:
      "客户加油包即将到期 AI 加油包 10 万 tokens · ORD-202609-7a1b2c（2026-12-27）",
  },
  "addon.exhausted": {
    reference: addonRef,
    params: addonParams,
    severity: "info",
    title: "客户加油包额度已用尽 AI 加油包 10 万 tokens · ORD-202609-7a1b2c",
  },
  "addon.expired": {
    reference: addonRef,
    params: addonParams,
    severity: "info",
    title: "客户加油包已到期 AI 加油包 10 万 tokens · ORD-202609-7a1b2c",
  },
  /* 代客续期（2026-09-28 收尾）：发侧的去重键是「订阅 × **新的**到期日」（续一期、
     日期变了，下一次续期自然是另一条）。info——运营自己刚做的动作，镜像是回执。 */
  "subscription.renewed_by_operator": {
    reference: { type: "subscription", id: "sub-1:2027-09-10" },
    params: { ...planParams, endAt: "2027-09-10" },
    severity: "info",
    title: "运营代客续期 Arda Pro（2027-09-10）",
  },
  /* 维护暂停（2026-09-28 收尾）：发侧的去重键是「订阅 × **预计恢复日期**」，不是订阅 ×
     到期日——窗口一延长，日期变了，同一条模板自然再发 / 再镜像一条。这里照那个形状。 */
  "subscription.suspended_maintenance": {
    reference: { type: "subscription", id: "sub-1:2026-09-30" },
    params: { ...planParams, resumeAt: "2026-09-30" },
    severity: "info",
    title: "产品升级维护，客户订阅已暂停 Arda Pro（预计 2026-09-30 恢复）",
  },
  /* 成员邀请四态（2026-09-29）：**四条全 info**。邀请的收发是租户自助，运营在整条链上
     没有位置——按本文件对 warning 的成文含义（「在等运营动手」⇒ 不过期）逐条问「哪个运营
     动作能让这条消失」，四条的答案都是「没有」。过期那条还来自每趟重扫同一批行的巡检，
     给成不过期的 warning 只会越堆越多。理由与「为什么仍然镜像」写在 operator-mirror.ts。 */
  "tenant.invitation_accepted": {
    reference: inviteRef("accepted"),
    params: inviteParams,
    severity: "info",
    title: "Acme 新成员已加入（成员）",
  },
  "tenant.invitation_declined": {
    reference: inviteRef("declined"),
    params: inviteParams,
    severity: "info",
    title: "Acme 的成员邀请被拒绝（成员）",
  },
  "tenant.invitation_revoked": {
    reference: inviteRef("revoked"),
    params: inviteParams,
    severity: "info",
    title: "Acme 撤回了成员邀请（成员）",
  },
  "tenant.invitation_expired": {
    reference: inviteRef("expired"),
    params: inviteParams,
    severity: "info",
    title: "Acme 的成员邀请已过期（成员）",
  },
  /* ── 账号安全线（2026-09-29）：**十四条全 info**。────────────────────────────
     严重度的理由逐条写在 operator-mirror.ts 那一段里（问「哪个运营动作能让这条消失」，
     十四条的答案都是「没有」）。**这十四条本该一条都不进运营通告流**（owner 裁定 5），
     而这张表没有「不镜像」那一档——所以它们仍然有条目，只是现有形状里唯一的关法在装配处
     （`operatorMirror: null`）。整件事记在 operator-mirror.ts 那一段里，这里只钉住行为：
     真镜像出去的时候，标题与正文里**没有 IP、没有设备串、没有地区、没有 uuid**。 */
  "account.locked": {
    reference: secRef("account.locked"),
    params: secReasonParams,
    severity: "info",
    title: `客户账号已被平台锁定（${SEC_WHEN}）`,
  },
  "account.unlocked": {
    reference: secRef("account.unlocked"),
    params: secReasonParams,
    severity: "info",
    title: `客户账号已解除锁定（${SEC_WHEN}）`,
  },
  "account.sessions_ended_by_operator": {
    reference: secRef("account.sessions_ended_by_operator"),
    params: secReasonParams,
    severity: "info",
    title: `客户账号已被平台全端下线（${SEC_WHEN}）`,
  },
  /* 操作者不进标题（那个词是客户视角写的），但**要进客户正文**——下面「完整一致」那条
     断言会连正文一起比，所以这里给一个真码。 */
  "account.password_changed": {
    reference: secRef("account.password_changed"),
    params: { occurredAt: SEC_WHEN, actorLabel: "tenant_admin" },
    severity: "info",
    title: `客户登录密码已修改（${SEC_WHEN}）`,
  },
  "account.password_reset": {
    reference: secRef("account.password_reset"),
    params: secParams,
    severity: "info",
    title: `客户已用邮件链接重置登录密码（${SEC_WHEN}）`,
  },
  "account.phone_changed": {
    reference: secRef("account.phone_changed"),
    params: secParams,
    severity: "info",
    title: `客户账号手机号已更换（${SEC_WHEN}）`,
  },
  "account.email_changed_old": {
    reference: secRef("account.email_changed_old"),
    params: secParams,
    severity: "info",
    title: `客户账号邮箱已换走，已通知原地址（${SEC_WHEN}）`,
  },
  "account.email_changed_new": {
    reference: secRef("account.email_changed_new"),
    params: secParams,
    severity: "info",
    title: `客户账号邮箱已换为新地址（${SEC_WHEN}）`,
  },
  /* 第三方登录参数里是**码**（dingtalk），标题里该出现的是词（钉钉）——与角色那一处
     同一个缺陷形状，所以这里传码、断言词。 */
  "account.identity_linked": {
    reference: secRef("account.identity_linked"),
    params: { occurredAt: SEC_WHEN, providerName: "dingtalk" },
    severity: "info",
    title: `客户绑定了「钉钉」登录（${SEC_WHEN}）`,
  },
  "account.identity_unlinked": {
    reference: secRef("account.identity_unlinked"),
    params: { occurredAt: SEC_WHEN, providerName: "dingtalk" },
    severity: "info",
    title: `客户解绑了「钉钉」登录（${SEC_WHEN}）`,
  },
  "account.password_login_enabled": {
    reference: secRef("account.password_login_enabled"),
    params: secParams,
    severity: "info",
    title: `客户开启了账号密码登录（${SEC_WHEN}）`,
  },
  "account.password_login_disabled": {
    reference: secRef("account.password_login_disabled"),
    params: secParams,
    severity: "info",
    title: `客户关闭了账号密码登录（${SEC_WHEN}）`,
  },
  "account.session_ended_by_self": {
    reference: secRef("account.session_ended_by_self"),
    params: secParams,
    severity: "info",
    title: `客户自行下线了一台设备（${SEC_WHEN}）`,
  },
  "account.new_device_signin": {
    reference: secRef("account.new_device_signin"),
    params: secParams,
    severity: "info",
    title: `客户在新设备上登录（${SEC_WHEN}）`,
  },
};

const NOW = new Date("2026-09-28T10:00:00Z");

function compose(code: NotificationTemplateCode) {
  const c = CASES[code];
  const rendered = render(code, c.params, null, "zh-CN");
  return composeOperatorNotice({
    code,
    reference: c.reference,
    params: c.params,
    customer: { title: rendered.title, body: rendered.body },
    tenant: { name: "Acme", no: "8800000012" },
    // refund_no 只有库里有：这里模拟解析结果，解析本身在下面的 OperatorMirror 组里测。
    resolved: {
      orderNo: null,
      refundNo: c.reference.type === "refund" ? "RFD-202609-1" : null,
    },
    now: NOW,
  });
}

describe("OPERATOR_MIRROR 覆盖全部客户模板", () => {
  it("键集合与 NOTIFICATION_TEMPLATES 完全一致（类型之外再钉一次运行时）", () => {
    expect(Object.keys(OPERATOR_MIRROR).sort()).toEqual(
      Object.keys(NOTIFICATION_TEMPLATES).sort(),
    );
    expect(Object.keys(CASES).sort()).toEqual(
      Object.keys(NOTIFICATION_TEMPLATES).sort(),
    );
  });

  for (const code of Object.keys(CASES) as NotificationTemplateCode[]) {
    const c = CASES[code];
    it(`${code} → ${c.severity}：标题 / 去重键${c.link ? " / 链接" : ""}`, () => {
      const notice = compose(code);
      expect(notice.severity).toBe(c.severity);
      expect(notice.title).toBe(c.title);
      expect(notice.referenceType).toBe("customer_event");
      expect(notice.referenceId).toBe(
        `${code}:${c.reference.type}:${c.reference.id}`,
      );
      expect(notice.targetPlanes).toEqual(["admin"]);
      if (c.severity === "warning") {
        // 在等运营动手：不过期，直到处理。
        expect(notice.expiresAt).toBeNull();
        expect(notice.link).toBe(c.link);
      } else {
        expect(notice.expiresAt).toEqual(
          new Date(NOW.getTime() + OPERATOR_MIRROR_INFO_TTL_MS),
        );
      }
      // 完整一致：客户收到的那句话原文进正文。
      const rendered = render(code, c.params, null, "zh-CN");
      expect(notice.body).toContain(`客户收到：「${rendered.title}」`);
      expect(notice.body).toContain(rendered.body);
    });
  }
});

describe("composeOperatorNotice 正文与去重键", () => {
  it("正文 = 租户 · 产品 套餐 · 金额 · 客户原文，段间用「 · 」", () => {
    const notice = compose("refund.requested");
    expect(notice.body).toBe(
      "租户 Acme · ¥99.00 · 客户收到：「退款申请已收到：订单 ORD-202609-1」退款金额 ¥99.00，我们会尽快审核。",
    );
    const withPlan = compose("order.fulfilled");
    expect(withPlan.body.startsWith("租户 Acme · Arda Pro · ¥199.00 · ")).toBe(
      true,
    );
  });

  it("公告是广播：正文不带租户名", () => {
    const notice = compose("announcement.published");
    expect(notice.body).not.toContain("租户");
    expect(notice.body).toBe("客户收到：「维护通知」周六 02:00 升级。");
    expect(notice.link).toBeNull();
  });

  it("租户名查不到时正文从产品段开始，不留空段", () => {
    const c = CASES["order.fulfilled"];
    const rendered = render("order.fulfilled", c.params, null);
    const notice = composeOperatorNotice({
      code: "order.fulfilled",
      reference: c.reference,
      params: c.params,
      customer: rendered,
      tenant: { name: null, no: null },
      resolved: { orderNo: null, refundNo: null },
    });
    expect(notice.body.startsWith("Arda Pro · ¥199.00 · 客户收到")).toBe(true);
  });

  it("参数里没有 orderNo 时用解析出来的；有则参数优先", () => {
    const fromResolved = composeOperatorNotice({
      code: "order.cancelled",
      reference: orderRef,
      params: { productName: "Arda", planName: "Pro" },
      customer: { title: "t", body: "b" },
      tenant: { name: "Acme", no: "8800000012" },
      resolved: { orderNo: "ORD-RESOLVED", refundNo: null },
    });
    expect(fromResolved.title).toBe("客户取消订单 · ORD-RESOLVED（Arda）");
    expect(fromResolved.link).toBe("/orders/ORD-RESOLVED");

    const fromParams = composeOperatorNotice({
      code: "order.cancelled",
      reference: orderRef,
      params: { ...orderParams },
      customer: { title: "t", body: "b" },
      tenant: { name: "Acme", no: "8800000012" },
      resolved: { orderNo: "ORD-RESOLVED", refundNo: null },
    });
    expect(fromParams.link).toBe("/orders/ORD-202609-1");
  });

  it("refund.failed 没解析到 refund_no 时退回订单号，标题不留空", () => {
    const notice = composeOperatorNotice({
      code: "refund.failed",
      reference: refundRef("failed"),
      params: { orderNo: "ORD-202609-1", amount: "¥99.00" },
      customer: { title: "t", body: "b" },
      tenant: { name: null, no: null },
      resolved: { orderNo: null, refundNo: null },
    });
    expect(notice.title).toBe("退款执行失败 · ORD-202609-1");
  });

  it("去重键 = 模板:引用类型:引用id，最长组合仍在 reference_id varchar(128) 之内", () => {
    const longest = (Object.keys(CASES) as NotificationTemplateCode[]).reduce(
      (a, b) => (b.length > a.length ? b : a),
    );
    const key = mirrorDedupeKey(longest, refundRef("requested"));
    expect(key).toBe(`${longest}:refund:${REFUND_ID}:requested`);
    expect(key.length).toBeLessThanOrEqual(128);
  });

  it("链接规则：orderNo → /orders；租户引用 → /tenants；其余 null；只放可视码", () => {
    expect(mirrorLink("subscription", { orderNo: "ORD-1" }, "88")).toBe(
      "/orders/ORD-1",
    );
    expect(mirrorLink("tenant", {}, "8800000012")).toBe("/tenants/8800000012");
    expect(mirrorLink("tenant", {}, null)).toBeNull();
    expect(
      mirrorLink("subscription", { productName: "Arda" }, "88"),
    ).toBeNull();
    expect(mirrorLink("invitation", {}, "88")).toBeNull();
    // 租户引用带 orderNo 时订单页优先——它更具体。
    expect(mirrorLink("tenant", { orderNo: "ORD-1" }, "88")).toBe(
      "/orders/ORD-1",
    );
  });

  it("成员邀请四态：去重锚不含 uuid、每个终态各一条、不给链接", () => {
    const codes = [
      "tenant.invitation_accepted",
      "tenant.invitation_declined",
      "tenant.invitation_revoked",
      "tenant.invitation_expired",
    ] as NotificationTemplateCode[];
    const keys = codes.map((code) =>
      mirrorDedupeKey(code, CASES[code].reference),
    );
    // 每个终态各一条：四个锚互不相同，同一条邀请的 accepted 与 expired 不互相吞掉。
    expect(new Set(keys).size).toBe(4);
    for (const key of keys) {
      expect(key).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      );
      // 摘要要盖住邀请行 id：原样的那串一个字符都不许漏出来。
      expect(key).not.toContain(INVITE_ID);
      expect(key.length).toBeLessThanOrEqual(128);
    }
    /* 算术（reference_id varchar(128)）**分两档**。此前这里（与发侧的注释）只写了前一档，
       而过期那一档的引用 id 末尾带一个到期日，所以最坏情况比 70 长：
         三个终态（accepted / declined / revoked）：引用 id = 可视码 10 + 1 + 摘要 12 + 1 +
           终态最长 8 = 32；镜像锚 = 最长模板码 `tenant.invitation_declined` 26 + 1 +
           `invitation` 10 + 1 + 32 = 70。
         过期：引用 id = 10 + 1 + 12 + 1 + 7 + 1 + 到期日 10 = 42；
           镜像锚 = `tenant.invitation_expired` 25 + 1 + 10 + 1 + 42 = 79。
       最坏 **79，余 49** —— 仍然远在列宽之内（行为一直没有风险，错的只是这个数）。
       摘要位宽由发侧的 `invitationDigest` 定，上面的样本也从那里取：改那个常量，下面三条
       长度断言当场红（实测把 12 改成 13：红；改回：绿）。 */
    const longest = mirrorDedupeKey(
      "tenant.invitation_declined",
      inviteRef("declined"),
    );
    expect(longest).toBe(
      `tenant.invitation_declined:invitation:${VERIFY_TENANT_NO}:${invitationDigest(INVITE_ID)}:declined`,
    );
    expect(longest.length).toBe(70);
    /* 过期那一档单独钉：最坏情况在这里，而它是本批新加的那一档——上一行的 70 看不见它。 */
    const expired = mirrorDedupeKey(
      "tenant.invitation_expired",
      inviteRef("expired"),
    );
    expect(expired.endsWith(":expired:2026-10-06")).toBe(true);
    expect(expired.length).toBe(79);
    expect(expired.length).toBeLessThanOrEqual(128);
    // 邀请引用落在 null 那一档：admin 侧没有按邀请的详情页（判据与订阅 / 公告相同）。
    for (const code of codes) expect(compose(code).link).toBeNull();
  });

  it("账号安全十四条：锚不含 uuid、每件事各一条、不给链接、最长仍在 128 之内", () => {
    const codes = [...SECURITY_TEMPLATE_CODES];
    /* 读不到要红，不许当成通过：这个数字也是「加了码却没进这一组」的探针。 */
    expect(codes).toHaveLength(14);

    const keys = codes.map((code) =>
      mirrorDedupeKey(code, CASES[code].reference),
    );
    // 每件事各一条：十四个锚互不相同（模板名在锚里，所以同一时刻的两件事不互相吞掉）。
    expect(new Set(keys).size).toBe(14);
    for (const key of keys) {
      expect(key).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      );
      expect(key).toContain(SEC_USER_NO);
      expect(key.length).toBeLessThanOrEqual(128);
    }
    /* 长度**按真实码表算，不手抄一个数**：最长模板码 + `security` + 锚。上一批的注释里
       手抄的那个数算漏了一档，所以这里连「最长的是哪一条」都让代码去找。 */
    const longestCode = codes.reduce((a, b) => (b.length > a.length ? b : a));
    expect(longestCode).toBe("account.sessions_ended_by_operator");
    const longestKey = mirrorDedupeKey(
      longestCode,
      CASES[longestCode].reference,
    );
    expect(
      longestKey.startsWith(`${longestCode}:security:sec:${SEC_USER_NO}:`),
    ).toBe(true);
    expect(longestKey.length).toBe(110);
    expect(128 - longestKey.length).toBe(18);
    // 安全事件没有 admin 详情页（判据与订阅 / 邀请 / 公告相同）。
    for (const code of codes) expect(compose(code).link).toBeNull();
  });

  it("账号安全的镜像正文里没有 IP、没有设备串、没有地区、没有邮箱手机号", () => {
    /* 这一条是 owner 裁定 5 的**第二半**：那一档「不镜像」这张表表达不出来（理由见
       operator-mirror.ts），所以至少要钉住「万一镜像出去了，运营屏幕上也不会出现客户的
       设备与位置」。判据落在**镜像正文**上而不是模板表上：正文 = 客户收到的原文，原文里
       没有的东西这里也变不出来，反过来说原文里一旦被加上，这条当场红。 */
    for (const code of [...SECURITY_TEMPLATE_CODES]) {
      const body = compose(code).body;
      for (const leak of [
        "User-Agent",
        "user-agent",
        "Mozilla",
        "Chrome",
        "Windows",
        "iPhone",
        "@",
        "IP",
        "ip 地址",
        "地区",
        "城市",
      ]) {
        expect(body).not.toContain(leak);
      }
      // 纯数字的一串（IPv4 的点分十进制、或一个手机号）也不许出现。
      expect(body).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
      expect(body).not.toMatch(/\b1\d{10}\b/);
    }
  });

  it("租户引用给租户页链接", () => {
    expect(compose("tenant.converted").link).toBe("/tenants/8800000012");
    // 认证结果也是租户引用：运营点开落在那个租户上。
    expect(compose("tenant.verification_rejected").link).toBe(
      "/tenants/8800000012",
    );
  });

  it("加油包引用**不给链接**：admin 只有列表页，没有按加油包单号的详情页", () => {
    // 判据与订阅 / 邀请 / 公告那几档相同：有详情页才给链接。单号参数也因此叫
    // addonOrderNo 而不是 orderNo——后者会命中 /orders/{单号}，给出一个按 billing
    // 单号查不到的死链。
    for (const code of [
      "addon.activated",
      "addon.expiring_soon",
      "addon.exhausted",
      "addon.expired",
    ] as NotificationTemplateCode[]) {
      expect(compose(code).link).toBeNull();
    }
    // 真正的陷阱形状：参数里**有** orderNo（发侧就是这么传的），只有引用类型能分辨
    // 这个单号住哪张表。同一个参数走 order 引用时，订单详情页链接照旧要给。
    expect(
      mirrorLink("addon", { orderNo: "ORD-202609-7a1b2c" }, "88"),
    ).toBeNull();
    expect(mirrorLink("order", { orderNo: "ORD-202609-1" }, "88")).toBe(
      "/orders/ORD-202609-1",
    );
  });

  it("加油包与认证的去重锚都是可视值，不含 uuid；长度在 varchar(128) 之内", () => {
    /* 2026-09-28 收尾：认证那两条此前锚的是认证行 uuid，注释里写着「引用 id 从不上屏」
       ——那句话是错的：console-bff 的 inbox.router 把 reference_id 原样投影成
       `InboxMessage.referenceId` 交给浏览器。所以这条断言现在管到认证。 */
    const addonKey = mirrorDedupeKey("addon.exhausted", addonRef);
    expect(addonKey).toBe("addon.exhausted:addon:ORD-202609-7a1b2c");
    for (const code of [
      "addon.exhausted",
      "addon.expiring_soon",
      "tenant.verification_approved",
      "tenant.verification_rejected",
    ] as NotificationTemplateCode[]) {
      const key = mirrorDedupeKey(code, CASES[code].reference);
      expect(key).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      );
      // 认证那条最长：模板 28 + 1 + "tenant" 6 + 1 + 可视码 10 + 1 + ISO 24 = 71。
      expect(key.length).toBeLessThanOrEqual(128);
    }
    /* 同一个租户的两次审核必须是两条：这就是去重锚里那个审核时刻的全部用处。 */
    expect(
      mirrorDedupeKey(
        "tenant.verification_rejected",
        verifyRef("2026-09-28T02:30:00.000Z"),
      ),
    ).not.toBe(
      mirrorDedupeKey(
        "tenant.verification_rejected",
        verifyRef("2026-09-30T06:00:00.000Z"),
      ),
    );
  });
});

/**
 * 假 pool：只装三条查询与一个写侧。未知 SQL 一律抛——多出一条查询不该静默变成
 * 「查不到」。
 */
function fakePool(opts: {
  tenant?: { tenant_no: string; tenant_name: string | null } | null;
  order?: { order_no: string } | null;
  refund?: { refund_no: string; order_no: string | null } | null;
  failTenant?: boolean;
}) {
  const seen = { tenant: 0, order: 0, refund: 0 };
  const query = vi.fn(async (sql: string, _params: unknown[] = []) => {
    if (sql === MIRROR_TENANT_SQL) {
      seen.tenant += 1;
      if (opts.failTenant) throw new Error("tenants unreachable");
      return { rows: opts.tenant ? [opts.tenant] : [], rowCount: 0 };
    }
    if (sql === MIRROR_ORDER_SQL) {
      seen.order += 1;
      return { rows: opts.order ? [opts.order] : [], rowCount: 0 };
    }
    if (sql === MIRROR_REFUND_SQL) {
      seen.refund += 1;
      return { rows: opts.refund ? [opts.refund] : [], rowCount: 0 };
    }
    throw new Error(`unexpected sql: ${sql}`);
  });
  return { pool: { query } as unknown as Pool, query, seen };
}

function writer(impl?: () => Promise<never>) {
  const written: CreateSystemNoticeInput[] = [];
  const createSystemNotice = vi.fn(async (input: CreateSystemNoticeInput) => {
    if (impl) await impl();
    written.push(input);
    return { inserted: true, id: `n-${written.length}` };
  });
  return { notices: { createSystemNotice }, written, createSystemNotice };
}

const customer = { title: "客户标题", body: "客户正文" };
const silent = { warn: () => {} };

describe("OperatorMirror（解析与降级）", () => {
  it("订单引用、参数缺 orderNo → 按 uuid 查一次 order_no，进标题与链接", async () => {
    const f = fakePool({
      tenant: { tenant_no: "8800000012", tenant_name: "Acme" },
      order: { order_no: "ORD-DB" },
    });
    const w = writer();
    await new OperatorMirror(f.pool, w.notices, silent).mirror(
      {
        tenantId: TENANT_ID,
        templateCode: "order.restored",
        reference: orderRef,
        params: { productName: "Arda", planName: "Pro", amount: "¥1.00" },
      },
      customer,
    );
    expect(f.query).toHaveBeenCalledWith(MIRROR_ORDER_SQL, [ORDER_ID]);
    expect(w.written[0]!.title).toBe("订单已恢复付款 ¥1.00 · ORD-DB");
    expect(w.written[0]!.link).toBe("/orders/ORD-DB");
    expect(w.written[0]!.body).toContain("租户 Acme");
  });

  it("订单引用、参数已带 orderNo → 不查订单表", async () => {
    const f = fakePool({ tenant: { tenant_no: "1", tenant_name: "Acme" } });
    const w = writer();
    await new OperatorMirror(f.pool, w.notices, silent).mirror(
      {
        tenantId: TENANT_ID,
        templateCode: "order.cancelled",
        reference: orderRef,
        params: orderParams,
      },
      customer,
    );
    expect(f.seen.order).toBe(0);
    expect(w.written[0]!.link).toBe("/orders/ORD-202609-1");
  });

  it("退款引用 `{uuid}:{阶段}` → 拆出 uuid 查退款单；refund_no 进「退款执行失败」标题", async () => {
    const f = fakePool({
      tenant: { tenant_no: "1", tenant_name: "Acme" },
      refund: { refund_no: "RFD-DB", order_no: "ORD-DB" },
    });
    const w = writer();
    await new OperatorMirror(f.pool, w.notices, silent).mirror(
      {
        tenantId: TENANT_ID,
        templateCode: "refund.failed",
        reference: refundRef("failed"),
        params: { orderNo: "ORD-202609-1", amount: "¥99.00" },
      },
      customer,
    );
    expect(f.query).toHaveBeenCalledWith(MIRROR_REFUND_SQL, [REFUND_ID]);
    expect(w.written[0]!.title).toBe("退款执行失败 · RFD-DB");
    // 参数里的 orderNo 优先于库里查到的。
    expect(w.written[0]!.link).toBe("/orders/ORD-202609-1");
    expect(w.written[0]!.severity).toBe("warning");
    expect(w.written[0]!.expiresAt).toBeNull();
  });

  it("形状不像 uuid 的引用不查库（免得 22P02），链接为 null", async () => {
    const f = fakePool({ tenant: { tenant_no: "1", tenant_name: "Acme" } });
    const w = writer();
    await new OperatorMirror(f.pool, w.notices, silent).mirror(
      {
        tenantId: TENANT_ID,
        templateCode: "subscription.expired",
        reference: subRef,
        params: planParams,
      },
      customer,
    );
    expect(f.seen.order + f.seen.refund).toBe(0);
    expect(w.written[0]!.link).toBeNull();
  });

  it("租户引用 → /tenants/{tenant_no}", async () => {
    const f = fakePool({
      tenant: { tenant_no: "8800000012", tenant_name: "Acme" },
    });
    const w = writer();
    await new OperatorMirror(f.pool, w.notices, silent).mirror(
      {
        tenantId: TENANT_ID,
        templateCode: "tenant.converted",
        reference: { type: "tenant", id: TENANT_ID },
        params: { tenantName: "Acme" },
      },
      customer,
    );
    expect(w.written[0]!.link).toBe("/tenants/8800000012");
  });

  it("公告不查租户", async () => {
    const f = fakePool({ tenant: { tenant_no: "1", tenant_name: "Acme" } });
    const w = writer();
    await new OperatorMirror(f.pool, w.notices, silent).mirror(
      {
        tenantId: TENANT_ID,
        templateCode: "announcement.published",
        reference: { type: "announcement", id: "ann-1" },
        params: { title: "维护", content: "c" },
      },
      customer,
    );
    expect(f.seen.tenant).toBe(0);
    expect(w.written).toHaveLength(1);
  });

  it("租户查询抛 → 记日志、照样写通告（只是不带租户名）", async () => {
    const f = fakePool({ failTenant: true });
    const w = writer();
    const warn = vi.fn();
    await new OperatorMirror(f.pool, w.notices, { warn }).mirror(
      {
        tenantId: TENANT_ID,
        templateCode: "order.cancelled",
        reference: orderRef,
        params: orderParams,
      },
      customer,
    );
    expect(w.written).toHaveLength(1);
    expect(w.written[0]!.body).not.toContain("租户");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("tenant lookup failed");
  });

  it("写库抛 → 记日志、不抛出", async () => {
    const f = fakePool({ tenant: { tenant_no: "1", tenant_name: "Acme" } });
    const w = writer(async () => {
      throw new Error("operator_notices down");
    });
    const warn = vi.fn();
    await expect(
      new OperatorMirror(f.pool, w.notices, { warn }).mirror(
        {
          tenantId: TENANT_ID,
          templateCode: "refund.requested",
          reference: refundRef("requested"),
          params: { orderNo: "ORD-1", amount: "¥99.00" },
        },
        customer,
      ),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain(
      "operator mirror skipped for refund.requested:refund:",
    );
  });
});

describe("镜像查询谓词", () => {
  it("租户名取 display_name 回落 name；tenant_no 转 text", () => {
    expect(MIRROR_TENANT_SQL).toContain(
      "coalesce(nullif(display_name, ''), name) as tenant_name",
    );
    expect(MIRROR_TENANT_SQL).toContain("tenant_no::text as tenant_no");
    expect(MIRROR_TENANT_SQL).toContain("from tenancy.tenants");
  });
  it("退款查询同时取 refund_no 与所属订单的 order_no", () => {
    expect(MIRROR_REFUND_SQL).toContain("select r.refund_no, o.order_no");
    expect(MIRROR_REFUND_SQL).toContain(
      "left join billing.orders o on o.id = r.order_id",
    );
    expect(MIRROR_ORDER_SQL).toBe(
      "select order_no from billing.orders where id = $1",
    );
  });
});
