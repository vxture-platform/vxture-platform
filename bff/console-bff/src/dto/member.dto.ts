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

export class AcceptInvitationDto {
  token!: string;
}
