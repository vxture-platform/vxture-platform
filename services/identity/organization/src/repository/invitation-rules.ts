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

/**
 * 行状态 + 到期时刻 → 对外状态(pending 且已过期 → expired)。
 *
 * 每个终态都要在上面这张白名单里点名。漏掉一个的后果不是报错,而是它悄悄
 * 落到兜底的 `expired`——`declined`(对方拒绝)会在邀请台账里显示成「已过期」,
 * 把「对方不来」讲成「没人理」。 */
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
    status === "revoked" ||
    status === "declined"
  ) {
    return status;
  }
  return "expired";
}

/**
 * 接受邀请的拒绝矩阵;null = 可以接受。
 *
 * 顺序有讲究:先看行状态(撤销 / 已接受 / 过期),再看人——一个已撤销的邀请,
 * 即使邮箱对得上也该说「已撤销」而不是「邮箱不符」。
 *
 * ── 每一种 targetType 都必须有身份校验 ──
 * 邀请链接会被转发。**收件人校验是这条链上唯一挡住「链接给谁谁就能进」的东西**,
 * 所以这里用穷举而不是「email 就查、其余放行」:2026-09-09 加 user_no 通道时发现
 * 原来的写法是 `if (targetType === "email") 校验`——那意味着**任何新增的
 * targetType 默认不校验**,加一种通道就开一个洞,而且不报错。
 *
 * 认不出的 targetType 一律拒绝(`unknown_target`),不放行:库里 target_type
 * 没有 CHECK 约束,脏数据或将来某个没接完的通道都可能落到这里。
 */
export function rejectAcceptance(
  invitation: {
    status: string;
    expiresAt: Date;
    targetType: string;
    target: string;
  },
  identity: { email: string | null; userNo: string | null },
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
  /* 穷举各通道的身份校验。新增通道时**必须**在这里加一分支——
     default 是拒绝,所以漏了会立刻在测试里显影,而不是静默放行。 */
  switch (invitation.targetType) {
    case "email":
      /* 邮箱邀请只能由该邮箱对应的账号接受(大小写不敏感):
         链接被转发给别人不该等于把租户交出去。 */
      return !identity.email ||
        identity.email.trim().toLowerCase() !==
          invitation.target.trim().toLowerCase()
        ? "email_mismatch"
        : null;
    case "user_no":
      /* 按平台用户号邀请(owner 2026-09-09):目标是已有账号,只有那个号本人能接受。
         user_no 是可视码、纯数字串,大小写与空白无关,但仍 trim——库里存的是
         写入时的原样,前端可能带空格。 */
      return !identity.userNo ||
        identity.userNo.trim() !== invitation.target.trim()
        ? "user_mismatch"
        : null;
    default:
      return "unknown_target";
  }
}
