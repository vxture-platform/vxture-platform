export {
  NotificationDispatcher,
  type MailSender,
  type NotificationDispatcherOptions,
  type NotifyInput,
  type NotifyLogger,
  type NotifyResult,
  type PreferenceGate,
  type SmsSender,
} from "./dispatcher";
export {
  MIRROR_ORDER_SQL,
  MIRROR_REFUND_SQL,
  MIRROR_TENANT_SQL,
  OPERATOR_MIRROR,
  OPERATOR_MIRROR_INFO_TTL_MS,
  OPERATOR_MIRROR_PLANES,
  OPERATOR_MIRROR_REFERENCE_TYPE,
  OperatorMirror,
  composeOperatorNotice,
  mirrorDedupeKey,
  mirrorLink,
  type MirrorReference,
  type OperatorMirrorEntry,
  type OperatorMirrorFacts,
  type OperatorMirrorInput,
  type OperatorMirrorPort,
  type OperatorMirrorSeverity,
  type SystemNoticeWriter,
} from "./operator-mirror";
/*
 * 账号安全线（2026-09-29）导出三样，**只有三样**：模板码全集、引用类型，与那个同时产出
 * 展示时刻与去重锚的 `securityEventStamp`。
 *
 * 故意**不导出** `formatOccurredAt` / `actorNameOf` / `providerNameOf`（与 `roleNameOf`
 * 同一条理由）：发侧拿得到它们，就会有人在发侧先格式化、先翻好再传进来——而发侧既不知道
 * 收件人读哪种语言，也没法保证展示时刻与锚里的 ISO 时刻出自同一个 Date。留一条路进去，
 * 那条路就是对的那条。
 */
/*
 * 工单线（2026-09-29）同样只导出三样：模板码全集、引用类型，与那个产出去重锚的
 * `ticketEventReference`。理由与上面那一段一字不差——发侧只有这一条路拼得出锚，而锚少了
 * 时刻，客户收件箱的唯一键会把第二条回复起的每一条都静默压掉。
 */
export {
  NOTIFICATION_TEMPLATES,
  SECURITY_REFERENCE_TYPE,
  SECURITY_TEMPLATE_CODES,
  TICKET_REFERENCE_TYPE,
  TICKET_TEMPLATE_CODES,
  escapeHtml,
  interpolate,
  localeOf,
  render,
  securityEventStamp,
  smsParams,
  smsTemplatesFromEnv,
  ticketEventReference,
  topicOf,
  type NotificationLocale,
  type NotificationReferenceType,
  type NotificationTemplateCode,
  type NotificationTopic,
  type RenderedNotification,
  type SecurityTemplateCode,
  type TemplateDef,
  type TemplateParams,
  type TicketTemplateCode,
} from "./templates";
export {
  DEDUPE_SQL,
  OPS_ALERT_RETRY_BACKOFF_MS,
  OPS_ALERT_SILENCE_MS,
  OperatorAlertDispatcher,
  renderAlert,
  suppressionOf,
  type OperatorAlertCode,
  type OperatorAlertInput,
  type OperatorAlertOptions,
  type OperatorAlertReferenceType,
  type OperatorAlertResult,
} from "./operator-alerts";
export {
  broadcastAnnouncements,
  findAnnouncementTenants,
  findPendingAnnouncements,
  type BroadcastSummary,
  type PendingAnnouncement,
} from "./announcements";
