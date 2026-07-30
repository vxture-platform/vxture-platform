export class UpdateProfileDto {
  displayName?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  email?: string | null;
  phone?: string | null;
  timezone?: string | null;
  language?: string | null;
}

export class UpdateUsernameDto {
  username = "";
}

export class UpdateOrganizationDto {
  description?: string | null;
  industry?: string | null;
  scale?: string | null;
  website?: string | null;
  contactName?: string | null;
  contactRole?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  countryCode?: string | null;
  address?: string | null;
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
