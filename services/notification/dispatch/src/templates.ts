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
  | "subscription.suspended_maintenance"
  /* 2026-09-29：**成员邀请的四个终态**。`tenancy.invitations` 的五态里
     pending 之外那四个此前一句话都不发——accepted / declined / revoked 各有活的写入方
     （identity/organization 的成员仓储，只写一行审计），expired 连写入方都没有（读时按
     expires_at 算出来），所以它要一趟巡检。

     为什么是四条而不是两条：declined 与 revoked 在 DDL 里就是两个状态，表上的注释写着
     理由——declined 是被邀请人自己拒绝，revoked 是邀请人撤回，合成一个会把「对方不来」
     记成「我撤回了」。通知这一侧连**收件人都不同**：accepted / declined / expired 写给
     邀请人（`created_by`），revoked 写给被邀请人。一条模板写不出两个收件人视角。

     四条都不带邀请行的 uuid：邀请由**租户名 + 角色名 + 邀请人当初填的那个账号**认领
     （`tenancy.invitations.target`）。reference_id 被客户收件箱的读路径原样投影给浏览器，
     所以去重锚也只用可视值 + 一段不可逆的短摘要（形状见 operator-mirror.ts）。 */
  | "tenant.invitation_accepted"
  | "tenant.invitation_declined"
  | "tenant.invitation_revoked"
  | "tenant.invitation_expired"
  /* ── 账号安全线（2026-09-29，owner 六条裁定）──────────────────────────────
     普查的结论是**每一件账号安全上的事都没有人告诉客户**：运营锁定 / 解锁 / 强制下线，
     客户自己改密码、改手机号、改邮箱、绑解绑三方、翻密码登录开关、下线自己的设备，
     以及在没见过的设备上登录。其中最要紧的一条是**凭据被重置令牌改掉**
     （auth-bff 的邮件链接那条路）——它今天既不落审计行也不发通知，而那正是账号被接管时
     真正会走的那条路。所以这一批**在写路径上直接发**，不靠扫审计行：两条改密路径
     （auth-bff 的重置令牌、website-bff 的改密）都没有审计行，按审计做判据的巡检会
     静默漏掉恰恰最要紧的两条。

     **十四条，不是十二条。** 三处按「事实不同就拆开」拆了（判据与 subscription.cancelled_*
     三条、加油包「用尽 / 过期」两条相同）：
       · 邮箱变更 = **两条**（owner 裁定 4：旧地址与新地址都发）。不是「一条模板发两次」：
         两个收件人视角不同，而**旧地址那条不许要求客户还进得去账号**——被接管之后登录与
         找回都已指向新邮箱，写「去「我的账号」改密码」就是让他去一个他已经进不去的地方。
         同一条判据在邀请四态那里已经用过：「一条模板写不出两个收件人视角」。
       · 密码登录开关 = **两条**（开 / 关）。关掉之后「只能用手机 / 邮箱 / 三方动态验证登录」
         是一句必须说出来的话，开启之后要说的是另一件事，一条里写「或者…或者」说不清。
       · 全端下线（运营）与自己下线一台设备 = **两条**。前者是平台的处置、带运营填的原因、
         客户什么也不用做只需重新登录；后者是客户自己刚点的，回执的意义在于「如果不是你点的，
         这是你唯一的线索」。

     **不做的三件**（做了就是死代码，各自缺前置，见 security-line 普查）：多因素认证的
     启用 / 解绑（三张表字段与列锁全建好，全仓零写入方）、按国家地区的异地登录
     （`session.login_attempts.country_code` 列在、唯一的 INSERT 从不写它）、靠
     `session.auth_sessions` 巡检补发「会话被结束」（耐久镜像是尽力而为、Redis 才是主）。

     **参数契约**（本批三个写入方共用，不许各自另起一套）：
       occurredAt  事情发生的时刻，**已格式化的字符串**，由 `securityEventStamp` 产出；
                   绝不传 Date——`interpolate` 会把它 String() 成一串英文 GMT。
       actorLabel  操作者，只有「谁做的会变」的那一条要（密码修改：本人 / 组织管理员）。
                   **放码不放词**，理由与 roleKey 完全相同，见 ACTOR_PARAM 那一段。
       providerName 第三方登录的**码**（google / feishu / dingtalk / wechat），同样渲染时成词。
       reason      运营填的原因，owner 裁定 3 把运营那三个弹窗的原因改成**必填并照搬给客户**。
                   形状照已在发的 `refund.rejected` / `order.payment_rejected`。
     **一个 uuid 都不写**：文案里没有，去重锚里也没有——`reference_id` 被客户收件箱的读
     路径原样投影给浏览器（console-bff 的 inbox.router → `InboxMessage.referenceId`），
     所以锚只用可视的用户号 + 事件名 + 时刻（见 `securityEventStamp`）。时刻**必须在锚里**：
     这些事会重复（客户一天可以改两次密码），少了它收件箱那个唯一键会把第二次压掉。

     **短信**：这十四条一条都没进 `smsParams` 的 switch（默认回 `{}`），所以不发短信。
     不是遗漏——短信模板要按模板码逐条去阿里云报备，没报备的模板发不出去。 */
  | "account.locked"
  | "account.unlocked"
  | "account.sessions_ended_by_operator"
  | "account.password_changed"
  | "account.password_reset"
  | "account.phone_changed"
  | "account.email_changed_old"
  | "account.email_changed_new"
  | "account.identity_linked"
  | "account.identity_unlinked"
  | "account.password_login_enabled"
  | "account.password_login_disabled"
  | "account.session_ended_by_self"
  | "account.new_device_signin";

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
  | "addon"
  /**
   * 2026-09-29 账号安全线新增。**它故意不指向任何一张表**：账号安全事件在库里没有一行
   * 属于自己的记录（两条改密路径连审计行都没有），reference_id 是算出来的
   * （`securityEventStamp`：可视用户号 + 事件名 + 时刻）。
   *
   * 不复用 `tenant`：那个值的既有含义是 `tenancy.tenants` 的行，而 `mirrorLink` 对它会
   * 产出 `/tenants/{tenant_no}`——安全事件的引用 id 不是 tenant_no，那会是一条点开 404
   * 的死链（与批 5 不肯把加油包并进 `order` 是同一条理由）。
   * 这个值落在 `mirrorLink` 与 `resolveCodes` 的兜底档里：不查库、不给链接。
   * 先例：`ops_signal`（platform-api 的热路径信号）同样是「库里没有行」的引用类型。
   */
  | "security";

/**
 * 偏好主题（与 @vxture/service-account NOTIFICATION_TOPICS 同一集合）。
 *
 * 这里只列**本包发得出模板**的那几个；那边的全集还含事件源已存在、模板待接的两个
 * （界面标「开发中」：invoice_progress / ticket_activity）。两边不一致会被
 * `topicOf` 的穷尽映射挡住——它对每个模板键显式给主题，加模板忘了给主题就编译不过。
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
  /* 2026-09-29 owner 看过页面后裁定：邀请**拆成两个主题**。`member_invitation` 只留强制
     那一条（`tenant.invitation`——站内那条消息就是邀请本身），四个终态挪到下面这一个。
     两件事性质不同：一个**是**邀请本身，关掉它等于让邀请派不出去；另一个是周知，客户嫌吵
     就该能关。合成一行时开关只有「主题 × 渠道」这一个粒度，客户于是被迫二选一。
     偏好中心那张清单必须同改（@vxture/service-account 的 NOTIFICATION_TOPICS）——漏了由
     那边「派发侧每个主题都在偏好清单里」那条用例当场红。 */
  | "invitation_activity"
  | "order_status"
  | "tenant_change"
  | "verification_result"
  | "quota_alert"
  /* 2026-09-29 账号安全线：**两个主题，不是一个**（owner 裁定 2，判据与邀请那一刀完全相同
     ——一行开关的粒度只有「主题 × 渠道」，两种性质不同的事同住一行时，为了保住必须送到的
     那一半，另一半就跟着关不掉）。
       `security_event`  —— 账号安全事件（十三条：运营处置、凭据与联系方式变更、三方绑解绑、
         密码登录开关、自己下线设备）。**站内恒锁**：账号被接管时客户必须至少有一条到达路径，
         这不是产品偏好。**邮件默认开**（owner 裁定 1）——被锁定、被全端下线的客户打不开站内
         收件箱，解释躺在一个他进不去的地方等于没送到。
       `login_activity`  —— 只装「没见过的设备登录」这一条（owner 裁定 6：只算设备不算 IP，
         不然用移动网络的客户几乎每次登录都收一条）。**三个渠道全部可开关、不进锁定集合**：
         拆两行的全部意义就在这里，客户嫌吵能整条关掉，而关掉它不会连带静音「你的密码被改了」。
     偏好中心那张清单（@vxture/service-account 的 NOTIFICATION_TOPICS）把旧的 `security`
     改成 `security_event` 并新增 `login_activity`；漏了由那边「派发侧每个主题都在偏好清单里」
     那条用例当场红。 */
  | "security_event"
  | "login_activity";

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
  "tenant.invitation_accepted": "{{inviteeName}} 已加入 {{tenantName}}",
  "tenant.invitation_declined":
    "{{inviteeName}} 拒绝了加入 {{tenantName}} 的邀请",
  "tenant.invitation_revoked": "{{tenantName}} 的邀请已撤回",
  "tenant.invitation_expired": "邀请已过期：{{tenantName}}",
  /* ── 账号安全线（2026-09-29）──
     标题只说**发生了什么**，时刻与下一步在正文里：标题也是邮件主题，把时刻塞进主题行会
     把它挤到看不见（收件箱列表与邮件客户端都截宽）。
     **一律不出现 IP 与 User-Agent**：那两串是给排查用的，念给客户听既读不懂又会被照抄
     进运营镜像的正文（见 operator-mirror.ts 那一段）。 */
  "account.locked": "账号已被锁定",
  "account.unlocked": "账号已解除锁定",
  "account.sessions_ended_by_operator": "账号已在所有设备退出登录",
  "account.password_changed": "登录密码已修改",
  "account.password_reset": "登录密码已通过邮件链接重置",
  "account.phone_changed": "账号手机号已更换",
  "account.email_changed_old": "账号邮箱已从这个地址换走",
  "account.email_changed_new": "账号邮箱已更换为这个地址",
  /* 第三方的名字进「」：它是插值，而「钉钉」与「Google」对空格的要求相反
     （中文与拉丁之间该有空格、两段中文之间不该有），一条模板做不到两头都对。
     「」是本仓既有的写法（「我的账号」「成员管理」），两种名字放进去都读得顺。 */
  "account.identity_linked": "已绑定「{{providerName}}」登录",
  "account.identity_unlinked": "已解绑「{{providerName}}」登录",
  "account.password_login_enabled": "账号密码登录已开启",
  "account.password_login_disabled": "账号密码登录已关闭",
  "account.session_ended_by_self": "已有一台设备退出登录",
  "account.new_device_signin": "新设备登录",
};

/**
 * 账号安全线的「如果不是你」尾句，两种语言各一句，**十条模板共用同一句**。
 *
 * 抽成常量而不是逐条抄：这句话里许诺的两个动作必须**真的存在**，而它们都在
 * 「我的账号」的「账号安全」卡片上（`portals/console/.../profile/SecurityCard.tsx`：
 * 密码一行可改、「活跃会话」一行每条可「下线」）。逐条抄十遍，改一处就会有九处仍指向
 * 一个已经搬走的入口——而客户按着一句失效的指引去处置账号被接管，代价落在他身上。
 *
 * 「无法登录时请联系客服」是**必要的第二条腿**：账号已经被接管的人往往登不进去，
 * 而「联系客服」是本仓既有的逃生口（`subscription.suspended` / `refund.rejected` /
 * `refund.failed` 都用它）。不新造一个入口。
 *
 * **不写原因、不写猜测**：平台不知道那次操作是谁做的，写「可能是你在别处登录」是编话。
 */
const IF_NOT_YOU_ZH =
  "如果不是你本人操作，请立即在「我的账号」重新设置密码，并把其它设备下线；无法登录时请联系客服。";
const IF_NOT_YOU_EN =
  "If this was not you, set a new password under My account right away and sign your other devices out; contact support if you cannot sign in.";

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
    "{{inviterName}} 邀请你以「{{roleKey}}」身份加入 {{tenantName}}，{{expiresAt}} 前有效。",
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
  /* ── 成员邀请四态（2026-09-29）────────────────────────────────────────────
     三条写给**邀请人**、一条写给**被邀请人**，每条都自己说清三件事：谁、哪个租户、
     什么角色。参数名与已在发的 `tenant.invitation` 同一套（tenantName / roleKey /
     expiresAt），新增的只有 inviteeName —— 邀请人当初在输入框里填的那个账号
     （`tenancy.invitations.target`，用户号或邮箱），因为邀请人是按它认领这条邀请的。
     **一个 uuid 都不写**：邀请行的 id 不进文案，也不进去重锚。
     accepted / declined / expired 这三条给「下一步」时都指向「成员管理」——那一页上就有
     「邀请成员」按钮，不写一个不存在的入口。 */
  "tenant.invitation_accepted":
    "{{inviteeName}} 已接受邀请，以「{{roleKey}}」身份加入 {{tenantName}}。成员与角色可在「成员管理」查看。",
  /* 「没有加入」必须明说出来：只写「拒绝了邀请」会让邀请人去成员列表里自己数人。
   **不揣测原因**——库里只有一个 declined 状态，为什么拒绝没有任何数据支持。 */
  "tenant.invitation_declined":
    "{{inviteeName}} 拒绝了以「{{roleKey}}」身份加入 {{tenantName}} 的邀请，没有加入，这条邀请到此结束。需要的话可以在「成员管理」重新邀请。",
  /* 写给被邀请人。只说两件事：那条邀请被撤回了、它不再有效。**不指责也不解释**——
     撤回的理由平台不知道，写「对方可能…」是替邀请人编话；而对着被邀请人写「你没有及时
     接受」更是把撤回说成了他的问题。 */
  "tenant.invitation_revoked":
    "你收到的以「{{roleKey}}」身份加入 {{tenantName}} 的邀请已被撤回，该邀请不再有效。",
  /* 过期这条来自巡检（读时按 expires_at 算出来的状态，此前没有写入方）。不写「对方拒绝
     了」——没人接受与明确拒绝是两件事，库里也是两个状态。 */
  "tenant.invitation_expired":
    "{{inviteeName}} 未在 {{expiresAt}} 前接受以「{{roleKey}}」身份加入 {{tenantName}} 的邀请，这条邀请已过期。需要的话可以在「成员管理」重新邀请。",
  /* ── 账号安全线（2026-09-29）──
     每一条都说齐三件事：**发生了什么 / 什么时候 / 如果不是你该做什么**。
     第三件是这一批存在的理由——少了它，客户读完只剩恐慌，不知道下一步去哪。
     运营处置那三条的第三件不是「改密码」而是「联系客服」：那三条里客户没有可自助的动作，
     而被锁定的人根本进不去「我的账号」。 */
  "account.locked":
    "平台已于 {{occurredAt}} 锁定你的账号，锁定期间无法登录。原因：{{reason}}。如需解除锁定请联系客服。",
  "account.unlocked":
    "平台已于 {{occurredAt}} 解除你账号的锁定，现在可以正常登录。原因：{{reason}}。如有疑问请联系客服。",
  "account.sessions_ended_by_operator":
    "平台已于 {{occurredAt}} 结束你账号在所有设备上的登录，需要重新登录一次。原因：{{reason}}。如有疑问请联系客服。",
  "account.password_changed":
    "你的登录密码已于 {{occurredAt}} 由{{actorLabel}}修改，旧密码不再可用。" +
    IF_NOT_YOU_ZH,
  "account.password_reset":
    "你的登录密码已于 {{occurredAt}} 通过发往你邮箱的重置链接重新设置，旧密码不再可用。" +
    IF_NOT_YOU_ZH,
  "account.phone_changed":
    "你账号绑定的手机号已于 {{occurredAt}} 更换，之后的短信通知与手机号验证都发往新号码。" +
    IF_NOT_YOU_ZH,
  /* 写给**旧地址**。这条不许要求客户还进得去账号：邮箱被换掉之后登录与找回都已指向新地址，
     让他去「我的账号」改密码就是把他指向一个他已经进不去的地方。所以只留「联系客服」。
     也**不印出新地址**：这封信正发往一个可能已经不属于本人的信箱的对面那一半。 */
  "account.email_changed_old":
    "你账号绑定的邮箱已于 {{occurredAt}} 换成另一个地址。这个邮箱不再收到该账号的通知，也不能再用于登录和找回。如果不是你本人操作，请立即联系客服——此时账号的登录与找回都已指向新邮箱。",
  "account.email_changed_new":
    "你账号绑定的邮箱已于 {{occurredAt}} 更换为这个地址，之后的通知与邮箱登录都用它。" +
    IF_NOT_YOU_ZH,
  "account.identity_linked":
    "你的账号已于 {{occurredAt}} 绑定「{{providerName}}」，之后可以用它登录。" +
    IF_NOT_YOU_ZH,
  "account.identity_unlinked":
    "你的账号已于 {{occurredAt}} 解绑「{{providerName}}」，它不能再用于登录。" +
    IF_NOT_YOU_ZH,
  "account.password_login_enabled":
    "你的账号已于 {{occurredAt}} 开启账号密码登录，现在可以用密码登录。" +
    IF_NOT_YOU_ZH,
  /* 「只能用手机 / 邮箱 / 三方动态验证登录」与「我的账号」那一页的提示逐字同源
     （profilePage.security.accountLoginHint）——同一件事两处不许各写各的。 */
  "account.password_login_disabled":
    "你的账号已于 {{occurredAt}} 关闭账号密码登录，之后只能用手机 / 邮箱 / 三方动态验证登录。" +
    IF_NOT_YOU_ZH,
  "account.session_ended_by_self":
    "你于 {{occurredAt}} 把一台设备从账号中下线，该设备需要重新登录。" +
    IF_NOT_YOU_ZH,
  /* 只说「一台此前没有用过的设备」，**不印设备串也不印 IP**：User-Agent 是给排查看的，
     念给客户听既读不懂、又会连带出现在运营镜像的正文里。哪台设备客户在「我的账号」的
     「活跃会话」里看得到，那一页是给这件事准备的。 */
  "account.new_device_signin":
    "你的账号于 {{occurredAt}} 在一台此前没有用过的设备上登录。" +
    IF_NOT_YOU_ZH,
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
  "tenant.invitation_accepted": "{{inviteeName}} joined {{tenantName}}",
  "tenant.invitation_declined":
    "{{inviteeName}} declined the invitation to {{tenantName}}",
  "tenant.invitation_revoked": "Invitation to {{tenantName}} withdrawn",
  "tenant.invitation_expired": "Invitation expired: {{tenantName}}",
  "account.locked": "Your account has been locked",
  "account.unlocked": "Your account has been unlocked",
  "account.sessions_ended_by_operator": "You were signed out on every device",
  "account.password_changed": "Your sign-in password was changed",
  "account.password_reset":
    "Your sign-in password was reset with an emailed link",
  "account.phone_changed": "The phone number on your account changed",
  "account.email_changed_old":
    "Your account email was moved away from this address",
  "account.email_changed_new": "This address is now your account email",
  "account.identity_linked": "{{providerName}} sign-in connected",
  "account.identity_unlinked": "{{providerName}} sign-in disconnected",
  "account.password_login_enabled": "Password sign-in turned on",
  "account.password_login_disabled": "Password sign-in turned off",
  "account.session_ended_by_self": "A device was signed out of your account",
  "account.new_device_signin": "Sign-in from a new device",
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
    "{{inviterName}} invited you to join {{tenantName}} as {{roleKey}}. The invitation is valid until {{expiresAt}}.",
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
  "tenant.invitation_accepted":
    "{{inviteeName}} accepted the invitation and joined {{tenantName}} as {{roleKey}}. Members and their roles are under Members.",
  "tenant.invitation_declined":
    "{{inviteeName}} declined the invitation to join {{tenantName}} as {{roleKey}} and did not join, so this invitation is closed. You can send a new invitation under Members.",
  "tenant.invitation_revoked":
    "The invitation for you to join {{tenantName}} as {{roleKey}} has been withdrawn and can no longer be used.",
  "tenant.invitation_expired":
    "{{inviteeName}} did not accept the invitation to join {{tenantName}} as {{roleKey}} before {{expiresAt}}, so the invitation has expired. You can send a new invitation under Members.",
  "account.locked":
    "We locked your account on {{occurredAt}}; you cannot sign in while it is locked. Reason: {{reason}}. Contact support to have the lock removed.",
  "account.unlocked":
    "We removed the lock on your account on {{occurredAt}} and you can sign in again. Reason: {{reason}}. Contact support if you have questions.",
  "account.sessions_ended_by_operator":
    "We ended every session on your account on {{occurredAt}}, so you need to sign in once more. Reason: {{reason}}. Contact support if you have questions.",
  "account.password_changed":
    "Your sign-in password was changed on {{occurredAt}} by {{actorLabel}}, and the old password no longer works. " +
    IF_NOT_YOU_EN,
  "account.password_reset":
    "Your sign-in password was reset on {{occurredAt}} with the reset link sent to your mailbox, and the old password no longer works. " +
    IF_NOT_YOU_EN,
  "account.phone_changed":
    "The phone number on your account was changed on {{occurredAt}}; SMS notices and phone verification now go to the new number. " +
    IF_NOT_YOU_EN,
  "account.email_changed_old":
    "The email on your account was changed to a different address on {{occurredAt}}. This mailbox no longer receives notices for that account and can no longer be used to sign in or recover it. If this was not you, contact support right away — sign-in and recovery now point at the new address.",
  "account.email_changed_new":
    "The email on your account was changed to this address on {{occurredAt}}; notices and email sign-in now use it. " +
    IF_NOT_YOU_EN,
  "account.identity_linked":
    "{{providerName}} was connected to your account on {{occurredAt}} and can now be used to sign in. " +
    IF_NOT_YOU_EN,
  "account.identity_unlinked":
    "{{providerName}} was disconnected from your account on {{occurredAt}} and can no longer be used to sign in. " +
    IF_NOT_YOU_EN,
  "account.password_login_enabled":
    "Password sign-in was turned on for your account on {{occurredAt}}, so a password now works for signing in. " +
    IF_NOT_YOU_EN,
  "account.password_login_disabled":
    "Password sign-in was turned off for your account on {{occurredAt}}; from now on only phone, email or social one-time codes work. " +
    IF_NOT_YOU_EN,
  "account.session_ended_by_self":
    "On {{occurredAt}} one device was signed out of your account and has to sign in again. " +
    IF_NOT_YOU_EN,
  "account.new_device_signin":
    "Your account signed in on {{occurredAt}} from a device it has not been used on before. " +
    IF_NOT_YOU_EN,
};

/**
 * 角色码 → 角色名，两种语言各一份。
 *
 * **发侧传码、渲染时才成词。** `access.roles.role_code` 的五个值（owner / manager /
 * member / readonly / guest）由调用方原样放进 `roleKey` 参数，翻成词是这一层的事——只有
 * 派送器知道收件人读哪种语言（`localeOf(account.users.language)`）。发侧翻译的话，一封
 * 中文正文里就会印出英文码：已上线的 `tenant.invitation` 正是如此，中文读作
 * 「以「member」身份加入」（2026-09-29 修）。
 *
 * 名字与 console 的 `role.*` 词条逐字相同（portals/console/messages/*.json 是权威那一份；
 * 「owner 叫『所有者』不叫『主管理员』」是 owner 2026-09-06 的裁定，见 RoleTag.tsx 头注）。
 * 这里抄一份而不是 import：服务层不依赖门户包，也不依赖 `@vxture/core-utils`（本包没装，
 * 加依赖会动 package.json）。那边改名时这里要跟着改——两处各五行，漏了的症状是同一个角色
 * 在页面与通知里两个名字。
 */
const ROLE_NAMES: Record<
  NotificationLocale,
  Readonly<Record<string, string>>
> = {
  "zh-CN": {
    owner: "所有者",
    manager: "管理员",
    member: "成员",
    readonly: "只读成员",
    guest: "访客",
  },
  "en-US": {
    owner: "Owner",
    manager: "Manager",
    member: "Member",
    readonly: "Read-only",
    guest: "Guest",
  },
};

/**
 * 目录外的码、或者调用方压根没给：回落成一句**实话**。
 *
 * 另两种做法都是把「我不知道」说成别的东西：原样印出码（客户读到 `member` 这种内部值，
 * 正是本次要修的缺陷）、印空串（`interpolate` 对缺参就是这么干的，正文于是变成
 * 「以「」身份加入」，一句带洞的话）。也**不猜「成员」**——猜错的代价是告诉客户一个他
 * 没被授予的权限档。
 */
const ROLE_FALLBACK: Record<NotificationLocale, string> = {
  "zh-CN": "未指定角色",
  "en-US": "an unspecified role",
};

/**
 * 操作者码 → 该语言的说法（2026-09-29 账号安全线）。
 *
 * 与角色码**同一条理由、同一条路径**：发侧传码、渲染时成词。发侧不知道收件人读哪种语言，
 * 在那边先翻好就会在一封中文正文里印出英文——`tenant.invitation` 上线过的正是这个缺陷。
 * 参数名 `actorLabel` 由本批三个写入方的共同契约钉住（不叫 actorKey），但**值一律是码**；
 * 名字读起来像词而值是码这件事，只能靠这段注释和用例守住，所以两处都写了。
 *
 * 今天真有写入方的只有前两个：`self`（客户自己在「我的账号」改密码 / 首次设密）与
 * `tenant_admin`（组织管理员代设成员密码）。`operator` 留着是**跨包的安全网**：三个写入方
 * 分在三个包里，谁传了一个这张表没有的码，客户读到的就是回落那句「未能确认的操作者」——
 * 一句实话，但不是我们想让他读到的实话。多一行翻译比多一次误报便宜。
 */
const ACTOR_NAMES: Record<
  NotificationLocale,
  Readonly<Record<string, string>>
> = {
  "zh-CN": {
    self: "你本人",
    tenant_admin: "你所在组织的管理员",
    operator: "平台",
  },
  "en-US": {
    self: "you",
    tenant_admin: "an administrator of your organization",
    operator: "our team",
  },
};

/**
 * 第三方登录码 → 该语言的名字。码取自 console 的 `ThirdPartyProvider`
 * （google / feishu / dingtalk / wechat），名字与 console 的
 * `profilePage.connectedAccounts.providers.*.name` 逐字相同——同一家在页面与通知里
 * 两个名字，客户会以为是两回事。
 *
 * 这里抄一份而不是 import：服务层不依赖门户包（与 ROLE_NAMES 同一条理由与同一处代价
 * ——那边改名时这里要跟着改）。
 */
const PROVIDER_NAMES: Record<
  NotificationLocale,
  Readonly<Record<string, string>>
> = {
  "zh-CN": {
    google: "Google",
    feishu: "飞书",
    dingtalk: "钉钉",
    wechat: "微信",
  },
  "en-US": {
    google: "Google",
    feishu: "Feishu",
    dingtalk: "DingTalk",
    wechat: "WeChat",
  },
};

const ACTOR_FALLBACK: Record<NotificationLocale, string> = {
  "zh-CN": "未能确认的操作者",
  "en-US": "an actor we could not identify",
};

const PROVIDER_FALLBACK: Record<NotificationLocale, string> = {
  "zh-CN": "未知的第三方登录",
  "en-US": "an unidentified sign-in method",
};

/** 模板里唯一的角色参数名。发侧只认这一个名字，且放**码**不放词。 */
export const ROLE_PARAM = "roleKey";
/** 模板里唯一的操作者参数名。同样放**码**不放词（见 ACTOR_NAMES）。 */
export const ACTOR_PARAM = "actorLabel";
/** 模板里唯一的第三方登录参数名。同样放**码**不放词（见 PROVIDER_NAMES）。 */
export const PROVIDER_PARAM = "providerName";

/**
 * 码 → 该语言的词；码不认识、或者压根没给，回落成一句**实话**。
 *
 * 三张表一个查法。另两种做法都是把「我不知道」说成别的东西：原样印出码（客户读到
 * `member` / `dingtalk` 这种内部值），或者印空串（`interpolate` 对缺参就是这么干的，
 * 正文于是变成「以「」身份加入」，一句带洞的话）。也不猜一个最可能的值——猜错的代价是
 * 告诉客户一件没发生的事。
 */
function wordOf(
  table: Record<NotificationLocale, Readonly<Record<string, string>>>,
  fallback: Record<NotificationLocale, string>,
  code: unknown,
  locale: NotificationLocale,
): string {
  const key = code === undefined || code === null ? "" : String(code).trim();
  return table[locale][key] ?? fallback[locale];
}

/**
 * 角色码 → 该语言的角色名；码不认识或没给就回落（见 ROLE_FALLBACK）。
 *
 * 导出给运营镜像用（`operator-mirror.ts` 的标题也要角色名，那一面固定中文）。
 * **不从包的 barrel 导出**：发侧能拿到它，就会有人在发侧先翻好再传进来，而发侧不知道
 * 收件人读哪种语言——那正是这次要修的缺陷的形状。同理 `actorNameOf` / `providerNameOf`。
 */
export function roleNameOf(code: unknown, locale: NotificationLocale): string {
  return wordOf(ROLE_NAMES, ROLE_FALLBACK, code, locale);
}

/** 操作者码 → 该语言的说法。导出给运营镜像用，理由同 roleNameOf。 */
export function actorNameOf(code: unknown, locale: NotificationLocale): string {
  return wordOf(ACTOR_NAMES, ACTOR_FALLBACK, code, locale);
}

/** 第三方登录码 → 该语言的名字。导出给运营镜像用，理由同 roleNameOf。 */
export function providerNameOf(
  code: unknown,
  locale: NotificationLocale,
): string {
  return wordOf(PROVIDER_NAMES, PROVIDER_FALLBACK, code, locale);
}

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
  /* 邀请四态 → `invitation_activity`，**与 `tenant.invitation` 不同主题**（owner
     2026-09-29 看过页面后裁定，推翻了本批最初「同一个主题」的落点）。
     判据是**性质不同**，不是「客户问的是不是同一件事」：`tenant.invitation` 就**是**邀请
     本身（所以它 mandatory + inboxOnly，站内那条消息即邀请，关掉它邀请派不出去），四条终态
     是周知（客户嫌吵就该能关）。挂在一个主题下时，站内那一档为了保住邀请本身必须锁死，四条
     周知的站内档就跟着关不掉——一行开关逼客户在「收得到邀请」与「别吵我」之间二选一。
     拆开之后：member_invitation 只剩强制那一条、站内恒锁；invitation_activity 三个渠道全部
     可开关（**不进锁定集合**，见 @vxture/service-account 的 LOCKED）。 */
  "tenant.invitation_accepted": "invitation_activity",
  "tenant.invitation_declined": "invitation_activity",
  "tenant.invitation_revoked": "invitation_activity",
  "tenant.invitation_expired": "invitation_activity",
  /* ── 账号安全线（2026-09-29，owner 裁定 2）：**十三 + 一**。────────────────────
     十三条归 `security_event`：它们回答的是同一个问题——「我的账号本身出了什么事」。
     只有「没见过的设备登录」归 `login_activity`，因为它回答的是另一个问题——「谁在登录」，
     而那个问题的答案会**经常变**（换台电脑、换个浏览器就是一条），是客户可能嫌吵的唯一
     一条。合成一个主题的代价与邀请那一刀完全相同、而且更贵：`security_event` 的站内档
     必须锁死（账号被接管时唯一的到达路径），于是「新设备登录」的站内档也跟着关不掉，
     客户被迫在「收得到密码被改了」与「别每次换浏览器都吵我」之间二选一。 */
  "account.locked": "security_event",
  "account.unlocked": "security_event",
  "account.sessions_ended_by_operator": "security_event",
  "account.password_changed": "security_event",
  "account.password_reset": "security_event",
  "account.phone_changed": "security_event",
  "account.email_changed_old": "security_event",
  "account.email_changed_new": "security_event",
  "account.identity_linked": "security_event",
  "account.identity_unlinked": "security_event",
  "account.password_login_enabled": "security_event",
  "account.password_login_disabled": "security_event",
  "account.session_ended_by_self": "security_event",
  "account.new_device_signin": "login_activity",
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
 * 账号安全事件的引用类型。**不指向任何一张表**，见 NotificationReferenceType 那一段。
 */
export const SECURITY_REFERENCE_TYPE: Extract<
  NotificationReferenceType,
  "security"
> = "security";

/**
 * 账号安全线的模板码全集，**从主题映射算出来，不手抄第二份**。
 *
 * 手抄一份的代价是它会和联合漂：加了码忘了加进名单，按名单做的守卫就静默少看一条。
 * 类型那一半用模板字面量从权威联合里筛（`account.` 前缀），运行时这一半按主题筛——
 * 两条**互相独立**的推导，用例断言它们相等（那是一条真判据，不是拿被测的那份证明它自己）。
 */
export const SECURITY_TEMPLATE_CODES: readonly NotificationTemplateCode[] = (
  Object.keys(TITLES_ZH) as NotificationTemplateCode[]
).filter(
  (code) =>
    TOPIC_OF[code] === "security_event" || TOPIC_OF[code] === "login_activity",
);

/** 账号安全线的模板码（`account.*`）。 */
export type SecurityTemplateCode = Extract<
  NotificationTemplateCode,
  `account.${string}`
>;

/** 中国标准时间与 UTC 的固定时差。中国不用夏令时，所以这是个常数而不是一张规则表。 */
const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 可视用户号的形状（`account.users.user_no`，主体码 v4 是 10 位数字）。 */
const VISIBLE_USER_NO = /^\d{6,20}$/;

/**
 * `occurredAt` 参数的唯一格式：`2026-09-29 20:14:32 (UTC+8)`。
 *
 * **三件事都是有意的**：
 *   · **带秒**。平台的日期时间纪律写着「显示时间必须带秒」，理由点名了通知：
 *     「排查订单、审计、通知时，同一分钟内的先后顺序恰恰最要紧」。安全事件更是如此——
 *     「20:14 改了密码、20:14 换了邮箱」摆在一起看不出谁先谁后。
 *   · **带时区**。不写时区的时刻对不在这个时区的客户是个谜；写死 UTC+8 而不按收件人时区
 *     渲染，是因为这一个字符串要同时进两种语言的正文与一封邮件，而 `render` 拿得到 locale
 *     拿不到时区偏好。
 *   · **不走共用的 `formatDay` / `formatDateTime`**。那两个是**界面**渲染件，输出是 locale
 *     形状（`2026/09/08 15:04:05`）；这里要的是形状固定、与语言无关的**数据串**，理由与
 *     `formatNotifyDate`（@vxture/service-subscription）完全相同。也不用 `Intl`：这一条
 *     只需要一个固定偏移的算术，引 `Intl` 反而要多解释它为什么不按 locale 变。
 *
 * **不从包的 barrel 导出**：发侧拿不到它，就只能走 `securityEventStamp`，而那个函数保证
 * 展示串与去重锚里的时刻**出自同一个 Date**。两处各自格式化的话，重试时会得到两个时刻。
 */
export function formatOccurredAt(at: Date): string {
  const shifted = new Date(at.getTime() + CHINA_OFFSET_MS).toISOString();
  return `${shifted.slice(0, 10)} ${shifted.slice(11, 19)} (UTC+8)`;
}

/**
 * 一次调用，拿到账号安全事件要的两样东西：展示用的 `occurredAt` 与去重锚 `reference`。
 *
 * **为什么住在这个包**：本批的写入方分在 auth-bff（重置令牌、三方绑解绑、新设备登录）、
 * website-bff（改密）与 admin-bff（锁定 / 解锁 / 全端下线）三处。锚的形状写在文档里让三处
 * 各自拼，就是三份会漂的副本——而漂的症状不是报错：锚少了时刻，收件箱那个唯一键
 * `(account_id, template_code, reference_type, reference_id)` 会把客户第二次改密码静默压掉。
 *
 * 锚 = `sec:{可视用户号}:{事件名}:{ISO 时刻}`。
 *   · **事件名从模板码算**（去掉 `account.` 前缀），不另收一个参数：少一个要对齐的名字。
 *   · **时刻必须在里面**。这些事会重复，去重键的粒度就是「哪一次」。
 *   · **一个 uuid 都没有**。`reference_id` 被客户收件箱的读路径原样投影给浏览器
 *     （console-bff 的 inbox.router → `InboxMessage.referenceId`）。所以这里对用户号**验形状**：
 *     不是可视号就退成 `unknown`，宁可让锚少一个可读的把手，也不让一个 uuid 过客户端那条线
 *     ——而锚仍然唯一，因为时刻在里面。
 *   · 长度：最长模板码 `account.sessions_ended_by_operator`（34）⇒ 事件名 26，
 *     锚 = 4 + 10 + 1 + 26 + 1 + 24 = 66，远在 `reference_id` 的 varchar(128) 之内；
 *     运营镜像那一层还要再套一层 `{模板}:{引用类型}:{锚}` = 34+1+8+1+66 = 110，也在 128 内。
 *     这两个数由用例按真实的码表重算，不手抄（上一批手抄的那个算漏了一档）。
 *
 * **看不见什么**：调用方实际传进来的是不是当时那个 Date、user_no 是不是这个账号的，
 * 本函数一概不知道；它只保证「格式对、两处同源、不含 uuid」。
 */
export function securityEventStamp(
  code: SecurityTemplateCode,
  userNo: string,
  at: Date,
): {
  occurredAt: string;
  reference: { type: NotificationReferenceType; id: string };
} {
  const trimmed = String(userNo ?? "").trim();
  const who = VISIBLE_USER_NO.test(trimmed) ? trimmed : "unknown";
  const event = code.slice("account.".length);
  return {
    occurredAt: formatOccurredAt(at),
    reference: {
      type: SECURITY_REFERENCE_TYPE,
      id: `sec:${who}:${event}:${at.toISOString()}`,
    },
  };
}

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

/**
 * 渲染前把参数里的**码**换成该语言的**词**：角色、操作者、第三方登录三个。
 *
 * 放在这条路径上而不是逐条模板特例化：`render` 是唯一拿到 locale 的地方，而这三类值已经
 * 出现在十几条模板里，还会更多。**无条件写回**这三个键（而不是「有才换」）：调用方整个
 * 忘了传时，回落的是一句实话，不是一个空洞。不用这些参数的模板原样不受影响——
 * `interpolate` 只认模板里出现过的占位符。
 */
function localizeParams(
  params: TemplateParams,
  locale: NotificationLocale,
): TemplateParams {
  return {
    ...params,
    [ROLE_PARAM]: roleNameOf(params[ROLE_PARAM], locale),
    [ACTOR_PARAM]: actorNameOf(params[ACTOR_PARAM], locale),
    [PROVIDER_PARAM]: providerNameOf(params[PROVIDER_PARAM], locale),
  };
}

export function render(
  code: NotificationTemplateCode,
  params: TemplateParams,
  absoluteLink: string | null,
  locale: NotificationLocale = "zh-CN",
): RenderedNotification {
  const t = TABLES[locale];
  const p = localizeParams(params, locale);
  const title = interpolate(t.titles[code], p);
  const body = interpolate(t.bodies[code], p);
  const subject = `[Vxture] ${title}`;
  const linkHtml = absoluteLink
    ? `<p><a href="${escapeHtml(absoluteLink)}">${escapeHtml(absoluteLink)}</a></p>`
    : "";
  const footer = FOOTER[locale];
  const html = `<p>${escapeHtml(title)}</p><p>${escapeHtml(body)}</p>${linkHtml}<p style="color:#888;font-size:12px">${escapeHtml(footer)}</p>`;
  const text = `${title}\n\n${body}${absoluteLink ? `\n\n${absoluteLink}` : ""}\n\n${footer}`;
  return { title, body, subject, html, text };
}
