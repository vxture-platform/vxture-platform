/**
 * invitation-notifications.ts — 邀请四态客户通知的**判据与形状**（2026-09-29）。
 * @package @vxture/service-organization
 *
 * ── 为什么单独一个文件 ──
 * 这一批里真正需要被钉住的判断只有三条，而三条都容易在别处悄悄写歪：
 *
 *   ① 这一态该通知谁。规则是一句话：**通知没有造成这次转移的那一方**。
 *      受邀人接受 / 拒绝 → 通知邀请人；邀请人撤回 → 通知受邀人；到点无人接受，
 *      成因是受邀人的不作为、且能采取下一步（重发）的是邀请人 → 通知邀请人。
 *      写成 Record 而不是三目：加一态忘了配收件人**编译不过**，不会静默落进兜底。
 *
 *   ② 去重键不许带 uuid。收件箱唯一键是 (account_id, template_code,
 *      reference_type, reference_id)，而 reference_id 被读路由原样投影给浏览器。
 *      邀请行没有可视码，所以键是「租户可视码 + 邀请 id 的不透明摘要 + 终态」。
 *
 *   ③ 发不出去要有声。租户解析不出来（邀请行的 tenant_id 可为 NULL）或收件人在
 *      平台上没有账号（按邮箱邀请一个还没注册的人，最常见的一种），都不是「发了」。
 *      这两种情形回判别式而不是 null——调用方要把**哪一种**记进日志，
 *      「什么都没发生」与「发了」在日志里长得一样才是真正的盲区。
 */
import { createHash } from "node:crypto";
import {
  formatNotifyDate,
  type CustomerNotifyInput,
  type OrganizationNotificationTemplate,
} from "./customer-notifier";
import type { InvitationNotifyFacts } from "../types/organization.types";

/** 邀请的四个终态（pending 不在其中：那不是终态，生命周期通知只挂在这四个上）。 */
export type InvitationTerminalState =
  | "accepted"
  | "declined"
  | "revoked"
  | "expired";

/**
 * 去重键里那一段状态 = `tenancy.invitations.status` 的取值本身。
 *
 * 四个终态之外还有 `pending`：`tenant.invitation`（**邀请本身**那一封，写入方在
 * console-bff 的 iam.router）发出去的时刻，这条邀请的状态就是 pending。它与四条
 * 生命周期通知**共用这一个函数**算键——两半各拼一种形状的话，同一条邀请在收件箱里
 * 会长出两种锚，读侧就分不出它们指的是同一件事，而「分不出」不会报错。
 *
 * `invitationNotice` 仍然只接四个终态：那四条的模板与收件人是穷尽 Record 配出来的，
 * 而 `pending` 那一封的收件人（受邀人）与文案由 console-bff 那一处自己给。
 */
export type InvitationNoticeState = InvitationTerminalState | "pending";

const TEMPLATE_OF: Record<
  InvitationTerminalState,
  OrganizationNotificationTemplate
> = {
  accepted: "tenant.invitation_accepted",
  declined: "tenant.invitation_declined",
  revoked: "tenant.invitation_revoked",
  expired: "tenant.invitation_expired",
};

/** 收件人：谁没有造成这次转移，就通知谁（判据见文件头 ①）。 */
const RECIPIENT_OF: Record<InvitationTerminalState, "inviter" | "invitee"> = {
  accepted: "inviter",
  declined: "inviter",
  revoked: "invitee",
  expired: "inviter",
};

/**
 * 落点。
 *
 * 邀请人那三条去**成员管理**：模板正文里点名的就是这一页（「成员与角色可在成员管理
 * 查看」「可以在成员管理重新邀请」），而「邀请成员」按钮也长在那里。落点与正文点名的
 * 页面必须是同一个——文案是给客户的承诺，链接把人送到别处就是两半没对上。
 *
 * 受邀人那一条去收件箱：他不是本租户成员，成员管理那页对他是 403。
 *
 * 字面量而非 import：服务层不能依赖门户包。权威在
 * portals/console/src/config/routes.ts（`/members`、`/members/invitations`）——
 * 那边搬家时这里要跟着改。
 */
const INVITER_LINK = "/members";
const INVITEE_LINK = "/inbox";

/** 摘要位宽。8 位十六进制（32 bit）在「同一租户 × 同一终态」内足够，取 12 留余量。 */
const DIGEST_HEX = 12;

/**
 * 邀请 id → 不透明摘要。单向，短，且**不长得像 uuid**（没有 8-4-4-4-12 的连字号
 * 形状，守卫与用例都按那个形状扫）。同一条邀请每次算出同一个值，所以它当去重键成立。
 */
export function invitationDigest(invitationId: string): string {
  return createHash("sha256")
    .update(invitationId)
    .digest("hex")
    .slice(0, DIGEST_HEX);
}

/**
 * 去重引用 id。
 *
 * 形状 `{tenant_no}:{digest}:{state}`，过期那一档另缀一个到期日（见下）。位宽算式：
 *   tenant_no 10 位（§11 v4 主体码：类别位 + 随机 8 + Luhn）
 *   + 1 个分隔符 + 摘要 12 位 + 1 个分隔符 + 状态段最长 8 位
 *   （accepted / declined 各 8；pending / revoked / expired 各 7）
 *   = 最长 32 字符；`pending` 那一封是 31。过期那一档再 + 1 + 10 位日期 = 42，
 *   那就是最坏情况。
 *   而 support.inbox_messages.reference_id 是 varchar(128)（notification_logs
 *   那张同宽），最坏 42 余 86 —— dispatcher **不截**这一列，所以位宽要在这里算得
 *   出来，不能靠「看着挺短」。
 *
 * 三段各有必要：租户码让同一个人在两个租户里的同名事件分得开；摘要区分同租户下的
 * 不同邀请；状态段让同一条邀请的五封各发一次（模板码本来就不同，这一段是把
 * 「这一封说的是哪个状态」也写进键）。
 *
 * ── 为什么只有过期那一档带日期 ──
 * 接受 / 拒绝 / 撤回在一条邀请的一生里各只发生一次。过期**不是**：重发会把过期的行
 * 救回 pending 并顺延有效期（rotateInvitationToken），于是同一行可以再过期一次，
 * 而那是一件新的事、该再通知一次。键里不带日期的话，第二次过期会被收件箱的唯一键
 * 静默吃掉——少发一条，而少发不报错。
 * 日期用 `formatNotifyDate`（东八区日历日）而不是 UTC 切片，与加油包「即将到期」
 * 同一手法：两边不同口径会出现「展示的日期变了而键没变」。
 */
export function invitationReferenceId(
  tenantNo: string,
  invitationId: string,
  state: InvitationNoticeState,
  expiresAt?: Date,
): string {
  const base = `${tenantNo}:${invitationDigest(invitationId)}:${state}`;
  return state === "expired" ? `${base}:${formatNotifyDate(expiresAt)}` : base;
}

/** 发不出去的两种原因（判别式，不是 null——调用方要记哪一种）。 */
export type InvitationNoticeGap = "no_tenant" | "no_recipient_account";

export type InvitationNoticeOutcome =
  | { ok: true; input: CustomerNotifyInput }
  | { ok: false; gap: InvitationNoticeGap };

/**
 * 一个终态 + 一行事实 → 一条通知，或者一条「为什么发不出去」。
 *
 * 参数给得比任何一条模板需要的都宽（tenantName / inviterName / inviteeName /
 * roleKey / expiresAt）：插值遇未知键**静默替换成空串**，所以少给一个参数不报错，
 * 只是让客户读到一句带洞的话。多给一个没有代价。
 *
 * `roleKey` 装的是**角色码原文**（access.roles.role_code：owner / manager /
 * member / readonly / guest），不是已经译好的词。译成人话在派送器的模板层做——
 * 只有派送器知道收件人读哪种语言；在这里译等于把中文钉死在发侧，收件人是 en-US
 * 时就错，而错出来的是一句混着两种语言的话，不是一个报错。
 *
 * 参数名是两侧的约定，任何一侧都不许单方面改：`tenant.invitation` 那一封
 * （console-bff 的 iam.router）用的也是这一个名字。
 */
export function invitationNotice(
  state: InvitationTerminalState,
  facts: InvitationNotifyFacts,
): InvitationNoticeOutcome {
  if (!facts.tenantId || !facts.tenantNo)
    return { ok: false, gap: "no_tenant" };
  const toInviter = RECIPIENT_OF[state] === "inviter";
  const recipient = toInviter ? facts.inviterUserId : facts.inviteeUserId;
  if (!recipient) return { ok: false, gap: "no_recipient_account" };
  return {
    ok: true,
    input: {
      tenantId: facts.tenantId,
      templateCode: TEMPLATE_OF[state],
      reference: {
        type: "invitation",
        id: invitationReferenceId(
          facts.tenantNo,
          facts.invitationId,
          state,
          facts.expiresAt,
        ),
      },
      params: {
        tenantName: facts.tenantName ?? "—",
        inviterName: facts.inviterName ?? "—",
        /* 受邀人可能还没有账号（按邮箱邀请）：回落到邀请人当初填的收件目标，
           那正是他在邀请台账里看到的那一行。 */
        inviteeName: facts.inviteeName ?? facts.target,
        roleKey: facts.roleCode ?? "member",
        expiresAt: formatNotifyDate(facts.expiresAt),
      },
      exactRecipients: [recipient],
      link: toInviter ? INVITER_LINK : INVITEE_LINK,
    },
  };
}
