/**
 * invitation-mail.ts — 成员邀请邮件(console 批 2)。
 * @package @vxture/bff-console
 *
 * 不走 NotificationDispatcher:分发器按**收件用户**的偏好投递、落站内信与
 * notification_logs,而受邀人此刻多半还不是用户(连站内信箱都没有)。这里只是
 * 一封带一次性链接的事务邮件,语言按邀请人的界面语言(同一团队,默认同一语言)。
 * owner 规则:只写机制,不写承诺(有效期、点链接后会发生什么)。
 */
import { escapeHtml } from "@vxture/service-notification";

export type InvitationMailLocale = "zh-CN" | "en-US";

export interface InvitationMailInput {
  locale: InvitationMailLocale;
  tenantName: string;
  inviterName: string;
  roleCode: string;
  link: string;
  expiresAt: Date;
}

export interface RenderedInvitationMail {
  subject: string;
  html: string;
  text: string;
}

const ROLE_LABELS: Record<InvitationMailLocale, Record<string, string>> = {
  "zh-CN": {
    owner: "拥有者",
    manager: "管理员",
    member: "成员",
    readonly: "只读成员",
    guest: "访客",
  },
  "en-US": {
    owner: "Owner",
    manager: "Manager",
    member: "Member",
    readonly: "Read-only member",
    guest: "Guest",
  },
};

const COPY: Record<
  InvitationMailLocale,
  {
    subject: (tenant: string) => string;
    title: (inviter: string, tenant: string) => string;
    role: (role: string) => string;
    action: string;
    expiry: (date: string) => string;
    mismatch: string;
    ignore: string;
  }
> = {
  "zh-CN": {
    subject: (tenant) => `[Vxture] ${tenant} 邀请你加入`,
    title: (inviter, tenant) => `${inviter} 邀请你加入「${tenant}」。`,
    role: (role) => `你将以「${role}」身份加入。`,
    action: "打开下面的链接接受邀请;接受后即可在控制台切换到该租户。",
    expiry: (date) => `链接有效期至 ${date};过期后需请邀请人重新发送。`,
    mismatch:
      "请用收到这封邮件的邮箱对应的账号登录后再接受——链接只对该邮箱有效。",
    ignore: "如果你不认识邀请人,忽略这封邮件即可,不会有任何变化。",
  },
  "en-US": {
    subject: (tenant) => `[Vxture] You are invited to join ${tenant}`,
    title: (inviter, tenant) => `${inviter} invited you to join "${tenant}".`,
    role: (role) => `You will join as ${role}.`,
    action:
      "Open the link below to accept; afterwards you can switch to this tenant in the console.",
    expiry: (date) =>
      `The link is valid until ${date}; after that, ask the inviter to resend it.`,
    mismatch:
      "Sign in with the account that owns this mailbox before accepting — the link only works for this email address.",
    ignore:
      "If you do not know the inviter, simply ignore this email; nothing will change.",
  },
};

/** 邀请人语言 → 邮件语言:en* → en-US,其余(含 null)→ zh-CN。 */
export function invitationMailLocale(
  language: string | null | undefined,
): InvitationMailLocale {
  return language?.toLowerCase().startsWith("en") ? "en-US" : "zh-CN";
}

function formatExpiry(date: Date, locale: InvitationMailLocale): string {
  return date.toLocaleString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
}

export function renderInvitationMail(
  input: InvitationMailInput,
): RenderedInvitationMail {
  const c = COPY[input.locale];
  const roleLabel = ROLE_LABELS[input.locale][input.roleCode] ?? input.roleCode;
  const lines = [
    c.title(input.inviterName, input.tenantName),
    c.role(roleLabel),
    c.action,
    c.expiry(formatExpiry(input.expiresAt, input.locale)),
    c.mismatch,
    c.ignore,
  ];
  const html =
    lines
      .slice(0, 3)
      .map((l) => `<p>${escapeHtml(l)}</p>`)
      .join("") +
    `<p><a href="${escapeHtml(input.link)}">${escapeHtml(input.link)}</a></p>` +
    lines
      .slice(3)
      .map((l) => `<p style="color:#888;font-size:12px">${escapeHtml(l)}</p>`)
      .join("");
  const text = `${lines.slice(0, 3).join("\n")}\n\n${input.link}\n\n${lines.slice(3).join("\n")}`;
  return { subject: c.subject(input.tenantName), html, text };
}
