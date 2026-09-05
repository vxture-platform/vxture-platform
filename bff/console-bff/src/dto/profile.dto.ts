export class UpdateProfileDto {
  displayName?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  /** 性别:male / female;空串 = 清除;缺省 = 不改。 */
  gender?: "male" | "female" | "" | null;
  email?: string | null;
  phone?: string | null;
  timezone?: string | null;
  language?: string | null;
}

export class UpdateUsernameDto {
  username = "";
}

export class UpdateOrganizationDto {
  /**
   * 租户名称(批 5c 新增)。个人与组织租户都可改;**组织租户改名即作废原企业认证**
   * (规格 §3.4),响应里的 verificationSuperseded 告诉前端要不要提示重新认证。
   */
  name?: string | null;
  /** 简称(走查 2026-09-05):日常展示名,自由改,不碰认证。 */
  displayName?: string | null;
  description?: string | null;
  industry?: string | null;
  scale?: string | null;
  website?: string | null;
  contactName?: string | null;
  contactRole?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  /** 关联成员:给了就从该成员的账号资料取姓名 / 邮箱 / 电话;null 解除关联。 */
  contactUserId?: string | null;
  /** 性别:male / female / null。关联成员时由成员派生,此处传入被忽略。 */
  contactGender?: "male" | "female" | null;
  countryCode?: string | null;
  address?: string | null;
  address2?: string | null;
  postalCode?: string | null;
  isBillingRecipient?: boolean;
  timezone?: string | null;
  language?: string | null;
  currency?: string | null;
}

export class ChangePasswordDto {
  currentPassword = "";
  nextPassword = "";
}

export class SetInitialPasswordDto {
  nextPassword = "";
}

export class VerifyPhoneIdentityDto {
  method: "phone" | "email" = "phone";
  code = "";
  emailVerifyToken?: string;
}

export class ConfirmPhoneChangeDto {
  identityToken = "";
  newPhone = "";
  newPhoneCode = "";
}

export class VerifyCurrentPhoneDto {
  code = "";
}

export class VerifyCurrentEmailDto {
  emailVerifyToken = "";
  code = "";
}

export class SendNewEmailOtpDto {
  email = "";
}

export class ConfirmEmailChangeDto {
  emailVerifyToken = "";
  newEmail = "";
  code = "";
}

export class SetAccountLoginEnabledDto {
  enabled = false;
}

/** 个人租户转组织租户(批 5c-2):组织名称 + 知悉勾选。 */
export class ConvertTenantDto {
  name = "";
  acknowledged = false;
}

/** 删除账号:用户必须勾过「已知悉确认项与连带动作」才能提交(050-account §7)。 */
export class RequestAccountDeletionDto {
  acknowledged = false;
}

/** 注销租户:勾过知悉 + 输入租户名称确认(走查 2026-09-05)。 */
export class RequestTenantClosureDto {
  acknowledged = false;
  confirmName = "";
}
