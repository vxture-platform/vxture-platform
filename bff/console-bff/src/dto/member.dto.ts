/**
 * 新增 / 邀请成员的入参。
 *
 * `email` 与 `userNo` **二选一**:邮箱通道发链接(对方可以还没有账号),
 * 用户号通道站内直邀(目标必须是平台已有账号)。所以 `email` 不是必填——
 * 此前它写成 `email!: string`,而用户号通道根本不传它,类型在说谎。
 *
 * `roleCode` 与 `workspaceId` 在**邀请**时都必填(owner 2026-09-10),
 * 缺了由 aggregator 报 400;类型上仍可选,因为「加成员」那条路径不问工作空间。
 */
export class UpsertMemberDto {
  email?: string;
  userNo?: string;
  roleId?: string | null;
  roleCode?: string | null;
  /** 邀请进哪个工作空间(邀请必填;加成员不用)。 */
  workspaceId?: string | null;
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

/**
 * 建 / 改工作空间。三项都可选,但**语义不同**:
 *
 *   `name`        不给 = 不改名(建的时候必给,路由上挡)。
 *   `description` 不给 = 不改;显式给 null = 清空。
 *   `icon`        同上。
 *
 * 「不给」与「给 null」必须分得开,所以不能把它们合成一个 `string | null`。
 */
export class UpsertWorkspaceDto {
  name?: string;
  description?: string | null;
  icon?: string | null;
}
