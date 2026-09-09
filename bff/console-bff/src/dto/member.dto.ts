export class UpsertMemberDto {
  email!: string;
  roleId?: string | null;
  roleCode?: string | null;
}

export class UpdateMemberDto {
  roleId?: string | null;
  /** New governance role code (manager/member/readonly/guest;owner 只能经转让)。 */
  roleCode?: string | null;
}

export class ResetMemberPasswordDto {
  nextPassword!: string;
}

/**
 * 接受邀请。两条通道**二选一**:
 *
 *   `token`        邮件链接里的一次性 token。
 *   `invitationId` 站内消息里的「同意」——按用户号邀请时不发链接,凭的是登录身份。
 *
 * 两者都不给 → 400。两者都给 → 以 token 为准(它是显式凭证);不设成 400 是因为
 * 这个组合不会由任何前端产生,为它多一条错误码只是给自己加分支。
 */
export class AcceptInvitationDto {
  token?: string;
  invitationId?: string;
}
