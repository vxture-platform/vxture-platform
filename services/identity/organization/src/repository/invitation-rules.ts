/**
 * invitation-rules.ts — 邀请状态判定的纯函数(pg 与 mock 两份仓储共用)。
 * @package @vxture/service-organization
 *
 * 两条规则都是「读侧派生」:库里 pending 行不会被清扫成 expired,过期由 expires_at
 * 算出来;接受时的拒绝矩阵也在这里——两份仓储的取档必须一致,所以只写一次。
 */
import type {
  AcceptInvitationRejection,
  InvitationListItem,
} from "../types/organization.types";

/** 行状态 + 到期时刻 → 对外状态(pending 且已过期 → expired)。 */
export function deriveInvitationStatus(
  status: string,
  expiresAt: Date,
  now = Date.now(),
): InvitationListItem["status"] {
  if (status === "pending" && expiresAt.getTime() <= now) return "expired";
  if (
    status === "pending" ||
    status === "accepted" ||
    status === "expired" ||
    status === "revoked"
  ) {
    return status;
  }
  return "expired";
}

/**
 * 接受邀请的拒绝矩阵;null = 可以接受。
 *
 * 顺序有讲究:先看行状态(撤销 / 已接受 / 过期),再看人——一个已撤销的邀请,
 * 即使邮箱对得上也该说「已撤销」而不是「邮箱不符」。邮箱邀请只能由该邮箱对应的
 * 账号接受(大小写不敏感):链接被转发给别人不该等于把租户交出去。
 */
export function rejectAcceptance(
  invitation: {
    status: string;
    expiresAt: Date;
    targetType: string;
    target: string;
  },
  userEmail: string | null,
  now = Date.now(),
): AcceptInvitationRejection | null {
  if (invitation.status === "revoked") return "revoked";
  if (invitation.status === "accepted") return "already_accepted";
  if (
    invitation.status !== "pending" ||
    invitation.expiresAt.getTime() <= now
  ) {
    return "expired";
  }
  if (
    invitation.targetType === "email" &&
    (!userEmail ||
      userEmail.trim().toLowerCase() !== invitation.target.trim().toLowerCase())
  ) {
    return "email_mismatch";
  }
  return null;
}
