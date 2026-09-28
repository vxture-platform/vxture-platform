/**
 * templates.ts — 客户通知模板（product_330 P2-g / P2-h）。zh-CN + en-US，按收件人语言渲染。
 * @package @vxture/service-notification
 *
 * owner 规则：只写机制、不写承诺（"到期后权益停止""可随时续费"是机制描述）。
 * 参数一律 `{{name}}` 插值，渲染时 HTML 转义（邮件）——参数来自库里的产品名 / 单号 / 金额字符串。
 * 注意：两种语言各自一张平表（键 → 文案）；不要写成九个同形对象字面量——Sonar CPD 会按
 * 字面量归一化把它们判成重复块。
 */

export type NotificationTemplateCode =
  | "subscription.expiring_soon"
  | "subscription.expired"
  | "subscription.renewed"
  | "order.fulfilled"
  | "order.renewal_created"
  | "refund.requested"
  | "refund.approved"
  | "refund.rejected"
  | "refund.completed"
  | "announcement.published"
  | "tenant.invitation"
  /* owner 2026-09-09:「我订阅了产品，付费，放弃付费，订单取消，都有操作…
     如果没有，那就是发消息方有纰漏」。下面四条补的就是那几处——每一条都对应一个
     **已经在跑的方法**（declarePayment / cancel / cancel(kind=expired) /
     convertPersonalToOrganization），只是此前一句话都不发。 */
  | "order.payment_declared"
  | "order.cancelled"
  | "order.expired"
  | "tenant.converted"
  /* owner 2026-09-25:「订阅开通 free 有消息通知，退订没有」「站在客户视角，退订就是
     退款，毫无歧义。差别在于能退 / 不能退（过了限期）/ 无需退款（0 付费）」。
     所以这三条**按退款结果命名，不按动作命名**——客户点的是「退订」，想知道的是
     「我的钱怎么样了」。三种结果各一条，因为它们导向的下一步不同：
       refunded    → 去看退款进度（另有 refund.requested 那条讲细节）
       no_charge   → 到此为止，本来就没付钱
       no_refund   → 到此为止，但要说清为什么（过了 24 小时窗口）
     当前策略：24 小时内全额退、超过不退（owner 2026-09-25）。24 小时内按配额消耗折算
     是后续的事——那时这三条不用动，变的是金额与 refunded 那条的文案参数。 */
  | "subscription.cancelled_refunded"
  | "subscription.cancelled_no_charge"
  | "subscription.cancelled_no_refund"
  /* 暂停到点被终止（2026-09-25 步骤三）。不复用 cancelled_* 那三条：它们讲的是「退订
     这张单退不退钱」，而这条讲的是「服务不会再恢复了」，客户此刻要知道的是后者。 */
  | "subscription.suspension_ended"
  /* 2026-09-25 状态机定稿（批 2）补的六条，全是「事情发生了但没人告诉客户」：
       subscription.overdue        → 新接上的「欠费宽限」这一档（服务还在、钱没到）
       subscription.suspended/resumed → 运营冻结与恢复，此前客户服务被停了不知为何
       order.payment_rejected      → 申报被驳回，此前只有付款页横幅，客户不回那页就不知道
       order.restored              → 运营把关掉的单救回来，客户不知道还能去付
     本来还想补 refund.failed，撤了：`refunds.refund_status` 的 `failed` 与 `processing`
     **全仓零写入方**——退款执行没有失败路径，缺的不是一条通知而是一个状态转移。等那条
     路补上时再连着模板一起加；先加模板就又是一处「做了没接」。 */
  | "subscription.overdue"
  | "subscription.suspended"
  | "subscription.resumed"
  | "order.payment_rejected"
  | "order.restored"
  /* 2026-09-25 批 3：退款执行失败（`failRefund`）。批 2 撤掉过一次，理由与现在补上的
     理由是同一个——那时没有写入方，现在有了。 */
  | "refund.failed"
  /* 2026-09-28 批 5：客户侧的七条「状态变了但一句话不发」。前四批把**运营侧**做全了
     （服务端唯一待办 + 客户通知的运营镜像 + 两轮巡检 + 两个平面的筛选与已读），客户这
     边仍有几处发生了却不告诉本人的事。七条各自都有**已经在跑的写入方**：
       tenant.verification_approved / _rejected → admin-bff 的 reviewVerification（运营人工审核）
       subscription.trial_expired               → sweepLapsedTrials（试用到点转 expired）
       addon.activated                          → 加油包付款确认后授予配额池
       addon.expiring_soon / _exhausted / _expired → 加油包池巡检（每趟重扫同一批行，
         去重只靠收件箱那个唯一键 —— 与 notifyExpiringSoon 同一形状）
     **个人实名认证不在本批**：`kyc.user_kycs` 全仓零写入方，先加模板就又是一处
     「做了没接」。工单同理（活的实现是 admin-bff 的裸 SQL，服务包是已声明孤儿）。

     加油包为什么是**三条**而不是两条：用尽（量没了、时间还在，下一步是再买一份）与
     过期（时间到了、没用完的量作废，下一步不同）客户要做的事不一样，合成一条就得写
     「或者…或者」。这与上面 `subscription.cancelled_*` 拆三条用的是同一条判据。 */
  | "tenant.verification_approved"
  | "tenant.verification_rejected"
  | "subscription.trial_expired"
  | "addon.activated"
  | "addon.expiring_soon"
  | "addon.exhausted"
  | "addon.expired"
  /* 2026-09-28 收尾：**运营代客续期**。运营在订阅侧按下「续期确认」时客户一句话都
     收不到，而自助续费与自动续费两条路都会发 `subscription.renewed`。
     不复用那一条：它的正文要说「实付 {{amount}}」，而代客续期是订阅侧的直接动作，
     没有订单、没有付款，那个字段没有诚实的值——填 ¥0 与「收入 = 真实实付」冲突，
     留空就是半截话。拆开而不在一条里写「或者…或者」，判据与 `subscription.cancelled_*`
     三条相同：事实不同就拆开。 */
  | "subscription.renewed_by_operator"
  /* 2026-09-28 收尾：**产品升级维护的暂停另立一条**，不复用 `subscription.suspended`。
     那条的正文写着「如需恢复请联系客服」——对**人工**暂停是对的（只有运营放得开），对
     产品维护是假话：维护结束后 `sweepProductMaintenance` 的第 2 段自己把订阅放回 active、
     闭合 episode、结算顺延、发恢复通知。让客户去问一件系统自己会做完的事，既错，又白造
     工单。拆成两条而不是在一条里写「或者…或者」，判据与 `subscription.cancelled_*` 三条、
     加油包「用尽 / 过期」两条是同一条：事实不同就拆开。
     两条的分岔靠**暂停原因**，不靠新开一个标记：维护那条腿开的 episode 写的是
     `platform_ops`，而 `SUSPENSION_REASON_EXTENDS_TERM.platform_ops === true`——所以正文里
     「暂停的天数不计入有效期」不是新加的承诺，是把已经成立的事说出来。 */
  | "subscription.suspended_maintenance";

/**
 * 业务引用类型 = 「reference_id 住在哪张表」这个问题的答案（`support.inbox_messages`
 * 的 reference_type，varchar(64) 无 CHECK，加值不需要迁移）。
 *
 * 2026-09-28 批 5 新增 `addon`，**没有复用 `order`**：加油包单的可视码 order_no 住
 * `metering.addon_purchases`，而 `order` 这个值的既有含义是 `billing.orders` 的行——
 * 两张表共用一个判别值，任何按引用去解析的消费方都会查错表并给出一个**确定的错答案**
 * （`resolveCodes` 的 `select order_no from billing.orders`、`mirrorLink` 的
 * `/orders/{单号}` 详情页）：不是报错，是一个点开 404 的死链。
 *
 * 新值不必改 `resolveCodes`：它对 order / refund 之外的引用类型直接回 none，可视码走
 * params 传。`mirrorLink` 则**必须**认这个值：加油包的单号参数与订单一样叫 `orderNo`
 * （全仓一套词汇），所以那里按引用类型排除 addon，不产出 `/orders/{加油包单号}`——
 * admin 侧只有 `/addon-orders` 列表页，没有按单号的详情页。
 */
export type NotificationReferenceType =
  | "subscription"
  | "order"
  | "refund"
  | "announcement"
  | "invitation"
  | "tenant"
  | "addon";

/**
 * 偏好主题（与 @vxture/service-account NOTIFICATION_TOPICS 同一集合）。
 *
 * 这里只列**本包发得出模板**的那几个；那边的全集还含事件源已存在、模板待接的四个
 * （界面标「开发中」：security / invoice_progress / ticket_activity，以及故意留在那里
 * 的 member_invitation）。两边不一致会被 `topicOf` 的穷尽映射挡住——它对每个模板键
 * 显式给主题，加模板忘了给主题就编译不过。
 *
 * 2026-09-28 批 5 加两个：`verification_result`（企业认证结果）与 `quota_alert`
 * （额度用尽）。**偏好中心的主题清单与这张联合是两个清单**——那边早就占了位，这边没有
 * 就写不出映射；顺手把那两个从「开发中」里挪出去，否则客户收得到却关不掉。
 */
export type NotificationTopic =
  | "subscription_expiry"
  | "provision_result"
  | "payment_due"
  | "refund_progress"
  | "announcement"
  | "member_invitation"
  | "order_status"
  | "tenant_change"
  | "verification_result"
  | "quota_alert";

export type NotificationLocale = "zh-CN" | "en-US";

export interface TemplateDef {
  topic: NotificationTopic;
  title: string;
  body: string;
}

const TITLES_ZH: Record<NotificationTemplateCode, string> = {
  "subscription.expiring_soon": "订阅即将到期：{{productName}} {{planName}}",
  "subscription.expired": "订阅已到期：{{productName}} {{planName}}",
  "subscription.renewed": "订阅已续费：{{productName}} {{planName}}",
  "order.fulfilled": "订阅已开通：{{productName}} {{planName}}",
  "order.renewal_created": "续费订单待付款：{{productName}} {{planName}}",
  "refund.requested": "退款申请已收到：订单 {{orderNo}}",
  "refund.approved": "退款已审核通过：订单 {{orderNo}}",
  "refund.rejected": "退款申请未通过：订单 {{orderNo}}",
  "refund.completed": "退款已完成：订单 {{orderNo}}",
  "announcement.published": "{{title}}",
  "tenant.invitation": "{{tenantName}} 邀请你加入",
  "order.payment_declared": "已收到你的付款信息：订单 {{orderNo}}",
  "order.cancelled": "订单已取消：{{orderNo}}",
  "order.expired": "订单已关闭：{{orderNo}}",
  "tenant.converted": "{{tenantName}} 已升为组织租户",
  "subscription.cancelled_refunded":
    "已退订，退款处理中：{{productName}} {{planName}}",
  "subscription.cancelled_no_charge": "已退订：{{productName}} {{planName}}",
  "subscription.cancelled_no_refund":
    "已退订，本单不退款：{{productName}} {{planName}}",
  "subscription.suspension_ended": "订阅已终止：{{productName}} {{planName}}",
  "subscription.overdue": "订阅已进入宽限期：{{productName}} {{planName}}",
  "subscription.suspended": "订阅已暂停：{{productName}} {{planName}}",
  "subscription.resumed": "订阅已恢复：{{productName}} {{planName}}",
  "order.payment_rejected": "付款信息未通过核对：订单 {{orderNo}}",
  "order.restored": "订单已恢复：{{orderNo}}",
  "refund.failed": "退款未能完成：订单 {{orderNo}}",
  "tenant.verification_approved": "企业认证已通过：{{tenantName}}",
  "tenant.verification_rejected": "企业认证未通过：{{tenantName}}",
  "subscription.trial_expired": "试用已结束：{{productName}} {{planName}}",
  "addon.activated": "加油包已开通：{{packName}}",
  "addon.expiring_soon": "加油包即将到期：{{packName}}",
  "addon.exhausted": "加油包额度已用尽：{{packName}}",
  "addon.expired": "加油包已到期：{{packName}}",
  "subscription.renewed_by_operator":
    "订阅已续期：{{productName}} {{planName}}",
  "subscription.suspended_maintenance":
    "订阅已暂停，产品升级维护中：{{productName}} {{planName}}",
};

const BODIES_ZH: Record<NotificationTemplateCode, string> = {
  "subscription.expiring_soon":
    "将于 {{endAt}} 到期（{{days}} 天后）。未开启自动续费，到期后权益停止；可在「我的订阅」续费或开启自动续费。",
  "subscription.expired":
    "已于 {{endAt}} 到期，权益已停止。随时可在「我的订阅」续费恢复。",
  "subscription.renewed": "新周期至 {{endAt}}，实付 {{amount}}。",
  "order.fulfilled":
    "订单 {{orderNo}} 已开通，有效期至 {{endAt}}，实付 {{amount}}。",
  "order.renewal_created":
    "已按自动续费生成续费订单 {{orderNo}}，应付 {{amount}}，请在 {{payBy}} 前完成付款；逾期订单关闭，订阅到期后权益停止。",
  "refund.requested": "退款金额 {{amount}}，我们会尽快审核。",
  "refund.approved": "退款 {{amount}} 将按原付款渠道退回，到账后另行通知。",
  "refund.rejected": "原因：{{reason}}。如有疑问请联系客服。",
  "refund.completed":
    "退款 {{amount}} 已退回原付款渠道，订阅已回到未订阅状态。",
  "announcement.published": "{{content}}",
  /* 只说机制:谁、什么身份、到什么时候截止。不写「欢迎加入」这类替对方做决定的话——
     这条消息的意义就是那个决定还没做。 */
  "tenant.invitation":
    "{{inviterName}} 邀请你以「{{roleName}}」身份加入 {{tenantName}}，{{expiresAt}} 前有效。",
  /* 只说机制，不做承诺：核对要多久由人工决定，写「很快」就是替他们许诺。 */
  "order.payment_declared":
    "金额 {{amount}}。我们会核对到账情况，确认后订单自动开通；在此之前订单保持待确认。",
  "order.cancelled": "订单 {{orderNo}}（{{productName}}）已取消，未产生费用。",
  /* 「放弃付费」的机制面：付款窗口到点，订单自己关。不写「你放弃了」——
     人可能只是没看到，说他放弃是在替他下结论。 */
  "order.expired":
    "付款窗口已过，订单 {{orderNo}}（{{productName}}）自动关闭，未产生费用。需要的话可以重新下单。",
  "tenant.converted":
    "{{tenantName}} 已从个人租户升为组织租户，现在可以邀请成员、按角色分配权限。原有订阅与用量记录不变。",
  /* 三条都先说「服务已停止」——那是客户按下那个按钮后最先要确认的事；再说钱。
     不写「感谢使用」这类客套：owner 规则是只写机制、不写承诺。 */
  "subscription.cancelled_refunded":
    "服务已停止。订单 {{orderNo}} 在退款窗口内，已为你发起退款 {{amount}}，进度可在「费用中心」查看。" +
    "已消耗的配额不在退款范围内。",
  "subscription.cancelled_no_charge":
    "服务已停止。订单 {{orderNo}} 实付 {{amount}}，无需退款。",
  "subscription.cancelled_no_refund":
    "服务已停止。订单 {{orderNo}} 已超过 24 小时退款窗口，本单不退款。",
  "subscription.suspension_ended":
    "暂停时间已超过上限，订阅已终止，服务不再恢复。如需继续使用请重新订购。",
  /* 宽限期这条先说「服务仍在运行」——客户看到「宽限期」最先担心的是服务是不是已经停了。
     再给截止时间与后果，不写「请尽快」这类催促。 */
  "subscription.overdue":
    "续费订单尚未付款，服务仍在运行。请在 {{payBy}} 前完成付款；超过该时间服务停止。",
  "subscription.suspended":
    "服务已暂停，暂停期间无法使用。如需恢复请联系客服。",
  "subscription.resumed": "服务已恢复，有效期至 {{endAt}}。",
  /* 与付款页横幅同一口径（那句话客户可能已经在页面上见过一次，两处不许各写各的）。 */
  "order.payment_rejected":
    "原因：{{reason}}。券与折扣已释放，可重新申报付款或取消订单，付款倒计时已重置。",
  "order.restored":
    "订单 {{orderNo}}（{{productName}}）已重新开放付款，应付 {{amount}}。",
  /* 只说事实：钱没退回去。不写「我们会重新处理」——那是替人工许诺。
     提一句「尽快」是因为 24 小时退款窗仍在走，拖过就真退不了。 */
  "refund.failed":
    "退款 {{amount}} 未能完成，款项尚未退回。请尽快联系客服跟进。",
  /* ── 批 5（2026-09-28）──
     参数名与来源列写在这里，两个包的调用方按这份对：
       tenantName  tenancy.tenants.display_name 回落 name（可视名，不是 tenant_no）
       reviewedAt  kyc.tenant_verifications.reviewed_at（已格式化的日期串）
       reason      同表 reject_reason
       endAt       「到点的那个日子」，来源按模板分：试用那条是订阅的 trial_end_at（试用行
                   的 end_at 常为 NULL，发侧显式换掉）；加油包三条是授予池
                   metering.quota_pools.expires_at。都已格式化成日期串
       packName    metering.addon_purchases.pack_name（快照，名字里本来就带量，所以正文
                   不再单列数量——单位随 metric_key 变，正文写不准）
       orderNo     同表 order_no（可视码 ORD-{YYYYMM}-{10hex}）
       amount      同表 price，经 formatNotifyMoney（带币符）
     **沿用全仓既有的三个名字**（orderNo / endAt / amount）而不是另起
     addonOrderNo / expiresAt / price：同一件事两套词汇，调用方会按直觉写既有的那套，
     于是参数名对不上、文案渲染成空串——这正是第一版写完后与发侧对出来的实际偏差。
     「加油包单号不属于 billing.orders」这件事**不靠参数名防**，靠引用类型：
     `mirrorLink` 对 `addon` 引用不再产出 `/orders/{单号}`（见 operator-mirror.ts）。
     参数名当防线是只长在一条分支上的守卫——下一个人照直觉传 `orderNo` 就又开了门。
     认证通过这条不写「可以开票」：能力按认证方式派生（简易认证不能开票），写死就是
     对一半客户说假话。 */
  "tenant.verification_approved":
    "认证已于 {{reviewedAt}} 审核通过。认证状态挂在租户层，所有工作空间继承；详情可在「企业认证」页查看。",
  "tenant.verification_rejected":
    "原因：{{reason}}。可在「企业认证」页修改资料后重新提交。",
  /* 不提数据保留：平台今天对试用结束后的数据没有成文承诺，写「保留 N 天」就是替产品
     许诺一件还不存在的事。只说机制——权益停了，以及下一步去哪。 */
  "subscription.trial_expired":
    "试用已于 {{endAt}} 结束，权益已停止。可在「我的订阅」选择套餐继续使用。",
  "addon.activated":
    "订单 {{orderNo}} 已开通，额度已计入可用余量，有效期至 {{endAt}}，实付 {{amount}}。余量在「费用中心」的加油包板块查看。",
  "addon.expiring_soon":
    "订单 {{orderNo}} 将于 {{endAt}} 到期（{{days}} 天后）。加油包不自动续订，到期未用完的额度作废；需要的话可在「费用中心」再买一份。",
  /* 用尽：量没了、时间还在 ⇒ 下一步是再买一份。 */
  "addon.exhausted":
    "订单 {{orderNo}} 的额度已全部用完，有效期到 {{endAt}}，但已无可用余量。需要继续使用请在「费用中心」再买一份。",
  /* 过期：时间到了、没用完的量作废 ⇒ 下一步与「用尽」不同，不必然要再买。 */
  "addon.expired":
    "订单 {{orderNo}} 已于 {{endAt}} 到期，未用完的额度随之作废。需要的话可在「费用中心」再买一份。",
  /* 只说两件事：新周期到哪天、这一次是平台代为办的。**钱这件事一个字都不说**：这条路
     上没有订单也没有付款记录，`{{amount}}` 没有诚实的值可填；而反过来写「未产生费用」
     同样不成立——运营代客续期常常正是因为线下合同已经付过款，那笔钱只是不在系统里。
     两个方向都会说错话，所以这条文案对金额保持沉默，那也正是它与 `subscription.renewed`
     分成两条的原因。 */
  "subscription.renewed_by_operator":
    "平台已为你续期，新周期至 {{endAt}}。当前权益可在「我的订阅」查看。",
  /* 三件事，一件都不能少（少哪件客户就会去问客服）：为什么停 / 预计什么时候回来 / 回来
     要不要他做点什么。**不写「联系客服」**——那是人工暂停那条的话。
     「预计 {{resumeAt}} 恢复」与官网 / console 的维护提示同一句式（`预计 {time} 恢复`）：
     同一件事两处不许各写各的。只说窗口写的那个时间，不写「到点一定恢复」——窗口到时未结束
     不会自动结束（运营要回 opera 点「结束维护」），所以自动的是**恢复这件事**，不是那个点。
     「暂停的天数不计入有效期，恢复后服务期顺延」照 console 已有的那句抄（suspendedExtended），
     依据是 platform_ops 的 extends_term = true。
     最后一句「维护时间有变动会再通知你」是**能兑现的**：这条模板的去重锚带着预计恢复日期，
     日期一变收件箱唯一键就不再命中，同一条模板自然再发一条（见 subscription.service 的
     maintenancePauseNotice）。 */
  "subscription.suspended_maintenance":
    "产品正在升级维护，维护期间服务暂停，预计 {{resumeAt}} 恢复。维护结束后服务自动恢复，无需你操作；" +
    "暂停的天数不计入有效期，恢复后服务期顺延。维护时间有变动会再通知你。",
};

const TITLES_EN: Record<NotificationTemplateCode, string> = {
  "subscription.expiring_soon":
    "Subscription expiring soon: {{productName}} {{planName}}",
  "subscription.expired": "Subscription expired: {{productName}} {{planName}}",
  "subscription.renewed": "Subscription renewed: {{productName}} {{planName}}",
  "order.fulfilled": "Subscription activated: {{productName}} {{planName}}",
  "order.renewal_created":
    "Renewal order awaiting payment: {{productName}} {{planName}}",
  "refund.requested": "Refund request received: order {{orderNo}}",
  "refund.approved": "Refund approved: order {{orderNo}}",
  "refund.rejected": "Refund request declined: order {{orderNo}}",
  "refund.completed": "Refund completed: order {{orderNo}}",
  "announcement.published": "{{title}}",
  "tenant.invitation": "{{tenantName}} invited you to join",
  "order.payment_declared": "Payment details received: order {{orderNo}}",
  "order.cancelled": "Order cancelled: {{orderNo}}",
  "order.expired": "Order closed: {{orderNo}}",
  "tenant.converted": "{{tenantName}} is now an organization tenant",
  "subscription.cancelled_refunded":
    "Cancelled, refund in progress: {{productName}} {{planName}}",
  "subscription.cancelled_no_charge": "Cancelled: {{productName}} {{planName}}",
  "subscription.cancelled_no_refund":
    "Cancelled, no refund for this order: {{productName}} {{planName}}",
  "subscription.suspension_ended":
    "Subscription ended: {{productName}} {{planName}}",
  "subscription.overdue":
    "Subscription in grace period: {{productName}} {{planName}}",
  "subscription.suspended": "Subscription paused: {{productName}} {{planName}}",
  "subscription.resumed": "Subscription resumed: {{productName}} {{planName}}",
  "order.payment_rejected": "Payment details not confirmed: order {{orderNo}}",
  "order.restored": "Order reopened: {{orderNo}}",
  "refund.failed": "Refund could not be completed: order {{orderNo}}",
  "tenant.verification_approved":
    "Business verification approved: {{tenantName}}",
  "tenant.verification_rejected":
    "Business verification not approved: {{tenantName}}",
  "subscription.trial_expired": "Trial ended: {{productName}} {{planName}}",
  "addon.activated": "Add-on pack activated: {{packName}}",
  "addon.expiring_soon": "Add-on pack expiring soon: {{packName}}",
  "addon.exhausted": "Add-on pack quota used up: {{packName}}",
  "addon.expired": "Add-on pack expired: {{packName}}",
  "subscription.renewed_by_operator":
    "Subscription renewed for you: {{productName}} {{planName}}",
  "subscription.suspended_maintenance":
    "Paused for product maintenance: {{productName}} {{planName}}",
};

const BODIES_EN: Record<NotificationTemplateCode, string> = {
  "subscription.expiring_soon":
    "Expires on {{endAt}} ({{days}} days from now). Auto-renew is off, so access stops at expiry; renew or enable auto-renew under My subscriptions.",
  "subscription.expired":
    "Expired on {{endAt}}; access has stopped. You can renew anytime under My subscriptions.",
  "subscription.renewed": "New period runs until {{endAt}}; paid {{amount}}.",
  "order.fulfilled":
    "Order {{orderNo}} is active until {{endAt}}; paid {{amount}}.",
  "order.renewal_created":
    "Auto-renew created renewal order {{orderNo}} for {{amount}}. Please pay before {{payBy}}; unpaid orders close and access stops at expiry.",
  "refund.requested": "Refund amount {{amount}}. We will review it shortly.",
  "refund.approved":
    "The refund of {{amount}} will be returned via the original payment channel; you will be notified when it lands.",
  "refund.rejected":
    "Reason: {{reason}}. Contact support if you have questions.",
  "refund.completed":
    "The refund of {{amount}} has been returned via the original payment channel and the subscription is back to unsubscribed.",
  "announcement.published": "{{content}}",
  "tenant.invitation":
    "{{inviterName}} invited you to join {{tenantName}} as {{roleName}}. The invitation is valid until {{expiresAt}}.",
  "order.payment_declared":
    "Amount {{amount}}. We will check the payment against our records; the order activates once confirmed and stays pending until then.",
  "order.cancelled":
    "Order {{orderNo}} ({{productName}}) has been cancelled. Nothing was charged.",
  "order.expired":
    "The payment window has passed, so order {{orderNo}} ({{productName}}) closed automatically. Nothing was charged. You can place a new order whenever you need it.",
  "tenant.converted":
    "{{tenantName}} has been upgraded from a personal tenant to an organization tenant. You can now invite members and assign permissions by role. Existing subscriptions and usage records are unchanged.",
  "subscription.cancelled_refunded":
    "Access has stopped. Order {{orderNo}} is within the refund window, so a refund of {{amount}} has been filed for you; track it under Billing. Quota you already used is not part of the refund.",
  "subscription.cancelled_no_charge":
    "Access has stopped. Order {{orderNo}} was paid {{amount}}, so there is nothing to refund.",
  "subscription.cancelled_no_refund":
    "Access has stopped. Order {{orderNo}} is past the 24-hour refund window, so this order is not refunded.",
  "subscription.suspension_ended":
    "The pause exceeded the allowed limit and the subscription has ended. Service will not resume. To continue, place a new order.",
  "subscription.overdue":
    "The renewal order is unpaid and your service is still running. Please pay by {{payBy}}; after that the service stops.",
  "subscription.suspended":
    "Access is paused and cannot be used while paused. Contact support to have it resumed.",
  "subscription.resumed": "Access has resumed, valid until {{endAt}}.",
  "order.payment_rejected":
    "Reason: {{reason}}. Vouchers and discounts have been released; you can declare payment again or cancel the order, and the payment countdown has been reset.",
  "order.restored":
    "Order {{orderNo}} ({{productName}}) is open for payment again, {{amount}} due.",
  "refund.failed":
    "The {{amount}} refund could not be completed and the money has not been returned yet. Please contact support soon.",
  "tenant.verification_approved":
    "Approved on {{reviewedAt}}. Verification lives on the tenant and every workspace inherits it; the details are on the Business verification page.",
  "tenant.verification_rejected":
    "Reason: {{reason}}. You can update the details on the Business verification page and submit again.",
  "subscription.trial_expired":
    "The trial ended on {{endAt}} and access has stopped. Pick a plan under My subscriptions to continue.",
  "addon.activated":
    "Order {{orderNo}} is active. The quota has been added to your balance, is valid until {{endAt}}, and {{amount}} was paid. The balance is under add-on packs in Billing.",
  "addon.expiring_soon":
    "Order {{orderNo}} expires on {{endAt}} ({{days}} days from now). Add-on packs do not auto-renew and quota left unused at expiry is forfeited; you can buy another pack under Billing.",
  "addon.exhausted":
    "Order {{orderNo}} has used all of its quota. The pack is valid until {{endAt}}, but nothing is left to spend. To keep going, buy another pack under Billing.",
  "addon.expired":
    "Order {{orderNo}} expired on {{endAt}} and quota left unused is forfeited. You can buy another pack under Billing whenever you need it.",
  "subscription.renewed_by_operator":
    "We renewed this subscription for you and the new period runs until {{endAt}}. Your current entitlements are under My subscriptions.",
  "subscription.suspended_maintenance":
    "The product is under an upgrade, so access is paused for the maintenance window and is expected back on {{resumeAt}}. " +
    "Access resumes by itself once the maintenance finishes — nothing for you to do; the paused days do not count against your term, so the term moves out by that much on resume. " +
    "If the maintenance window changes, you will hear from us again.",
};

const FOOTER: Record<NotificationLocale, string> = {
  "zh-CN": "此邮件由系统自动发送；通知偏好可在控制台「通知设置」调整。",
  "en-US":
    "This email was sent automatically; notification preferences can be changed under Notifications in the console.",
};

const TABLES: Record<
  NotificationLocale,
  {
    titles: Record<NotificationTemplateCode, string>;
    bodies: Record<NotificationTemplateCode, string>;
  }
> = {
  "zh-CN": { titles: TITLES_ZH, bodies: BODIES_ZH },
  "en-US": { titles: TITLES_EN, bodies: BODIES_EN },
};

/**
 * 模板 → 偏好主题。**逐条显式映射，不按前缀猜**（owner 2026-09-08）。
 *
 * 旧实现按前缀分三档，于是 `order.fulfilled`（开通成功）与 `order.renewal_created`
 * （有单要付）落进同一个「账单」主题，退款四态也一起——客户想只收「退款完成」做不到，
 * 想关掉催款又会连开通通知一起关掉。主题要贴着**用户关心的那件事**切，而不是贴着
 * 模板键的前缀。
 *
 * 用 `Record` 而不是 if 链：加模板时忘了给主题**编译不过**，不会静默落进某个兜底档。
 */
const TOPIC_OF: Record<NotificationTemplateCode, NotificationTopic> = {
  "subscription.expiring_soon": "subscription_expiry",
  "subscription.expired": "subscription_expiry",
  "subscription.renewed": "subscription_expiry",
  "order.fulfilled": "provision_result",
  "order.renewal_created": "payment_due",
  "refund.requested": "refund_progress",
  "refund.approved": "refund_progress",
  "refund.rejected": "refund_progress",
  "refund.completed": "refund_progress",
  "announcement.published": "announcement",
  "tenant.invitation": "member_invitation",
  /* 三条订单生命周期事件同一个主题:它们回答的是同一个问题——「我那个订单最后
     怎么样了」。不塞进 payment_due(那是「有单要付」)或 provision_result
     (那是「开通了吗」):主题要贴着用户关心的那件事切,不贴模板键的前缀。 */
  "order.payment_declared": "order_status",
  "order.cancelled": "order_status",
  "order.expired": "order_status",
  "tenant.converted": "tenant_change",
  /* 退订归 subscription_expiry：这个主题回答的是「我的订阅还在不在」，而退订正是
     那个问题的一个答案。不归 order_status——客户此刻关心的是服务没了，不是单子；
     也不归 refund_progress——退款进度那条是 refund.requested，这条讲的是服务终止。 */
  "subscription.cancelled_refunded": "subscription_expiry",
  "subscription.cancelled_no_charge": "subscription_expiry",
  "subscription.cancelled_no_refund": "subscription_expiry",
  /* 欠费宽限归 payment_due 而不是 subscription_expiry：客户此刻要做的事是去付那张续费
     单，「订阅还在不在」这个问题它的答案是「还在」。暂停 / 恢复才是那个主题——服务在
     不在，是它们唯一回答的事。 */
  "subscription.overdue": "payment_due",
  "subscription.suspension_ended": "subscription_expiry",
  "subscription.suspended": "subscription_expiry",
  "subscription.resumed": "subscription_expiry",
  "order.payment_rejected": "order_status",
  "order.restored": "order_status",
  "refund.failed": "refund_progress",
  /* 批 5（2026-09-28）。两条认证结果 → 偏好中心早就留好的认证主题（此前有位无模板）。 */
  "tenant.verification_approved": "verification_result",
  "tenant.verification_rejected": "verification_result",
  /* 试用到期归 subscription_expiry：与 subscription.expired 回答的是同一个问题——
     「我的权益还在不在」。不另立「试用」主题：那会让客户为同一个问题勾两个开关。 */
  "subscription.trial_expired": "subscription_expiry",
  /* 加油包开通与 order.fulfilled 是同一类「买的东西到账了吗」⇒ 同一个主题。 */
  "addon.activated": "provision_result",
  /* **四条加油包不共用一个主题**，判据仍是「客户在问什么」：
       即将到期 / 已到期 → subscription_expiry：问的是「我买的还能不能用」；
       已用尽           → quota_alert：问的是「额度够不够」。
     合成一个主题的代价是不对称的：关掉「额度用完了」的人会连带关掉「你买的包下周
     到期」，而漏掉后者要花钱。 */
  "addon.expiring_soon": "subscription_expiry",
  "addon.expired": "subscription_expiry",
  "addon.exhausted": "quota_alert",
  /* 代客续期与 `subscription.renewed` 同一个主题：两条回答的是同一个问题——「我的订阅
     到什么时候」。谁按下那个按钮不是客户勾开关时想的事。 */
  "subscription.renewed_by_operator": "subscription_expiry",
  /* 维护暂停与 `subscription.suspended` 同一个主题：两条回答的是同一个问题——「我的服务
     现在在不在」。不另立「维护」主题，那会让客户为同一个问题勾两个开关。 */
  "subscription.suspended_maintenance": "subscription_expiry",
};

export function topicOf(code: NotificationTemplateCode): NotificationTopic {
  return TOPIC_OF[code];
}

/** 收件人语言 → 模板语言：en* → en-US，其余（含 null）→ zh-CN。 */
export function localeOf(
  language: string | null | undefined,
): NotificationLocale {
  return language?.toLowerCase().startsWith("en") ? "en-US" : "zh-CN";
}

/** 模板注册表（zh-CN 视图，供测试 / 列举）。 */
export const NOTIFICATION_TEMPLATES: Record<
  NotificationTemplateCode,
  TemplateDef
> = Object.fromEntries(
  (Object.keys(TITLES_ZH) as NotificationTemplateCode[]).map((code) => [
    code,
    { topic: topicOf(code), title: TITLES_ZH[code], body: BODIES_ZH[code] },
  ]),
) as Record<NotificationTemplateCode, TemplateDef>;

export type TemplateParams = Record<string, string | number>;

/**
 * 短信模板变量（P2-i）。阿里云通知类模板变量有长度上限（20 字），这里统一截断；金额去掉货币符号
 * （模板里写死「元」）。键名 = 报备模板里的 ${var}，见 deploy/secrets/platform-sms.env.example。
 */
export function smsParams(
  code: NotificationTemplateCode,
  params: TemplateParams,
): Record<string, string> {
  const s = (v: unknown, n = 20) => String(v ?? "").slice(0, n);
  const money = (v: unknown) => s(String(v ?? "").replace(/[^0-9.]/g, ""));
  const product = s(params.productName);
  const plan = s(params.planName);
  const order = s(params.orderNo);
  switch (code) {
    case "subscription.expiring_soon":
      return { product, plan, date: s(params.endAt), days: s(params.days) };
    case "subscription.expired":
      return { product, plan, date: s(params.endAt) };
    case "subscription.renewed":
      return {
        product,
        plan,
        date: s(params.endAt),
        amount: money(params.amount),
      };
    case "order.fulfilled":
      return {
        product,
        plan,
        order,
        date: s(params.endAt),
        amount: money(params.amount),
      };
    case "order.renewal_created":
      return {
        product,
        plan,
        order,
        amount: money(params.amount),
        date: s(params.payBy),
      };
    case "refund.rejected":
      return { order, reason: s(params.reason) };
    case "refund.requested":
    case "refund.approved":
    case "refund.completed":
      return { order, amount: money(params.amount) };
    case "announcement.published":
      return { title: s(params.title) };
    default:
      return {};
  }
}

/** 环境变量 `ALIYUN_SMS_TPL_<模板键大写下划线>` → 阿里云模板码；没配的模板不发短信。 */
export function smsTemplatesFromEnv(
  env: Record<string, string | undefined> = process.env,
): Partial<Record<NotificationTemplateCode, string>> {
  const out: Partial<Record<NotificationTemplateCode, string>> = {};
  for (const code of Object.keys(TITLES_ZH) as NotificationTemplateCode[]) {
    const key = `ALIYUN_SMS_TPL_${code.toUpperCase().replace(/[.\-]/g, "_")}`;
    const v = env[key]?.trim();
    if (v) out[code] = v;
  }
  return out;
}

/** `{{name}}` 插值；缺参留空串（不抛：通知不因一个参数缺失而丢）。 */
export function interpolate(template: string, params: TemplateParams): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => {
    const v = params[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface RenderedNotification {
  title: string;
  body: string;
  subject: string;
  html: string;
  text: string;
}

export function render(
  code: NotificationTemplateCode,
  params: TemplateParams,
  absoluteLink: string | null,
  locale: NotificationLocale = "zh-CN",
): RenderedNotification {
  const t = TABLES[locale];
  const title = interpolate(t.titles[code], params);
  const body = interpolate(t.bodies[code], params);
  const subject = `[Vxture] ${title}`;
  const linkHtml = absoluteLink
    ? `<p><a href="${escapeHtml(absoluteLink)}">${escapeHtml(absoluteLink)}</a></p>`
    : "";
  const footer = FOOTER[locale];
  const html = `<p>${escapeHtml(title)}</p><p>${escapeHtml(body)}</p>${linkHtml}<p style="color:#888;font-size:12px">${escapeHtml(footer)}</p>`;
  const text = `${title}\n\n${body}${absoluteLink ? `\n\n${absoluteLink}` : ""}\n\n${footer}`;
  return { title, body, subject, html, text };
}
