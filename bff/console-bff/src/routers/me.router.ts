import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { AVATAR_MAX_BYTES, sniffImageType } from "@vxture/service-account";
import { PhoneCodeService } from "@vxture/service-sms";
import { SubscriptionService } from "@vxture/service-subscription";
import { SessionAggregator } from "../aggregators/session.aggregator";
import {
  ChangePasswordDto,
  ConfirmEmailChangeDto,
  ConfirmPhoneChangeDto,
  SendNewEmailOtpDto,
  SetAccountLoginEnabledDto,
  SetInitialPasswordDto,
  UpdateOrganizationDto,
  UpdateProfileDto,
  UpdateUsernameDto,
  VerifyCurrentEmailDto,
  VerifyCurrentPhoneDto,
  VerifyPhoneIdentityDto,
} from "../dto/profile.dto";
import { EmailChangeService } from "../services/email-change.service";
import { PhoneChangeService } from "../services/phone-change.service";
import type { RequestContext } from "../types/console.types";

interface AppEntry {
  id: string;
  icon: string;
  tone: string;
  target: string;
  openVela?: boolean;
}

const APP_CATALOG: AppEntry[] = [
  {
    id: "workspace",
    icon: "ph-squares-four",
    tone: "var(--vx-color-brand-600)",
    target: "/",
  },
  {
    id: "members",
    icon: "ph-users",
    tone: "var(--vx-color-info-600)",
    target: "/members",
  },
  {
    id: "billing",
    icon: "ph-receipt",
    tone: "var(--vx-color-success-600)",
    target: "/billing",
  },
  {
    id: "assistant",
    icon: "ph-sparkle",
    tone: "var(--vx-color-ai)",
    target: "/",
    openVela: true,
  },
];

@Controller("api/me")
export class MeRouter {
  constructor(
    @Inject(SessionAggregator)
    private readonly sessionAggregator: SessionAggregator,
    @Inject(SubscriptionService)
    private readonly subscriptionService: SubscriptionService,
    @Inject(PhoneChangeService)
    private readonly phoneChangeService: PhoneChangeService,
    @Inject(EmailChangeService)
    private readonly emailChangeService: EmailChangeService,
    @Inject(PhoneCodeService)
    private readonly phoneCodeService: PhoneCodeService,
  ) {}

  @Get()
  async getCurrentUser(@Req() req: Request & RequestContext) {
    if (!req.user) {
      throw new UnauthorizedException("No active session");
    }

    return this.sessionAggregator.getCurrentUser(req.user.id, req.tenant?.id);
  }

  @Get("apps")
  async getMyApps(@Req() req: Request & RequestContext): Promise<AppEntry[]> {
    if (!req.user) throw new UnauthorizedException("No active session");
    if (!req.tenant) return APP_CATALOG.filter((a) => a.id !== "assistant");

    try {
      const sub = await this.subscriptionService.getActiveSubscription(
        req.tenant.id,
      );
      if (!sub) return APP_CATALOG.filter((a) => a.id !== "assistant");
    } catch {
      return APP_CATALOG.filter((a) => a.id !== "assistant");
    }

    return APP_CATALOG;
  }

  @Get("profile")
  async getCurrentUserProfile(@Req() req: Request & RequestContext) {
    if (!req.user) {
      throw new UnauthorizedException("No active session");
    }

    const profile = await this.sessionAggregator.getCurrentUserProfile(
      req.user.id,
    );
    if (!profile) {
      throw new NotFoundException("Account profile not found");
    }

    return profile;
  }

  @Get("identities")
  async getIdentities(@Req() req: Request & RequestContext) {
    if (!req.user) throw new UnauthorizedException("No active session");
    return this.sessionAggregator.getUserIdentities(req.user.id);
  }

  @Delete("identities/:provider")
  async unbindIdentity(
    @Req() req: Request & RequestContext,
    @Param("provider") provider: string,
  ) {
    if (!req.user) throw new UnauthorizedException("No active session");
    const allowed = ["feishu", "dingtalk", "wechat", "google"];
    if (!allowed.includes(provider)) {
      throw new BadRequestException("Unknown provider");
    }
    await this.sessionAggregator.removeUserIdentity(req.user.id, provider);
    return { ok: true };
  }

  @Get("last-login")
  async getLastLogin(@Req() req: Request & RequestContext) {
    if (!req.user) throw new UnauthorizedException("No active session");
    return this.sessionAggregator.getUserLastLogin(req.user.id);
  }

  @Get("login-history")
  async getLoginHistory(@Req() req: Request & RequestContext) {
    if (!req.user) throw new UnauthorizedException("No active session");
    return this.sessionAggregator.getUserLoginHistory(req.user.id, 20);
  }

  @Get("sessions")
  async getSessions(@Req() req: Request & RequestContext) {
    if (!req.user) throw new UnauthorizedException("No active session");
    return this.sessionAggregator.getUserSessions(req.user.id);
  }

  @Get("workspaces")
  async getMyWorkspaces(@Req() req: Request & RequestContext) {
    if (!req.user) throw new UnauthorizedException("No active session");
    return this.sessionAggregator.getMyWorkspaces(req.user.id, req.tenant?.id);
  }

  @Delete("sessions/:sid")
  async revokeSession(
    @Req() req: Request & RequestContext,
    @Param("sid") sid: string,
  ) {
    if (!req.user) throw new UnauthorizedException("No active session");
    const revoked = await this.sessionAggregator.revokeUserSession(
      req.user.id,
      sid,
    );
    return { revoked };
  }

  @Get("organization")
  async getCurrentOrganizationProfile(@Req() req: Request & RequestContext) {
    if (!req.user) {
      throw new UnauthorizedException("No active session");
    }
    if (!req.tenant) {
      throw new UnauthorizedException("Tenant context is required");
    }

    const profile = await this.sessionAggregator.getCurrentOrganizationProfile(
      req.user.id,
      req.tenant.id,
    );
    if (!profile) {
      throw new NotFoundException("Organization profile not found");
    }

    return profile;
  }

  @Put("organization")
  async updateOrganization(
    @Req() req: Request & RequestContext,
    @Body() body: UpdateOrganizationDto,
  ) {
    if (!req.user) throw new UnauthorizedException("No active session");
    if (!req.tenant) throw new UnauthorizedException("Tenant context required");
    const profile =
      await this.sessionAggregator.updateCurrentOrganizationProfile(
        req.user.id,
        req.tenant.id,
        body,
      );
    if (!profile) throw new NotFoundException("Organization profile not found");
    return profile;
  }

  @Put("organization/logo")
  async uploadOrgLogo(@Req() req: Request & RequestContext) {
    if (!req.user) throw new UnauthorizedException("No active session");
    if (!req.tenant) throw new UnauthorizedException("Tenant context required");
    const body: unknown = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new BadRequestException("empty_body");
    }
    if (body.length > AVATAR_MAX_BYTES) {
      throw new BadRequestException("too_large");
    }
    const contentType = sniffImageType(body);
    if (!contentType) {
      throw new BadRequestException("unsupported_image");
    }
    return this.sessionAggregator.setCurrentOrgLogo(
      req.user.id,
      req.tenant.id,
      body,
      contentType,
    );
  }

  @Get("organization/logo")
  async getOrgLogo(@Req() req: Request & RequestContext, @Res() res: Response) {
    if (!req.user) throw new UnauthorizedException("No active session");
    if (!req.tenant) throw new UnauthorizedException("Tenant context required");
    const logo = await this.sessionAggregator.getCurrentOrgLogo(
      req.user.id,
      req.tenant.id,
    );
    if (!logo) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", logo.contentType);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.setHeader("ETag", `"${logo.hash}"`);
    res.end(logo.data);
  }

  @Delete("organization/logo")
  async removeOrgLogo(@Req() req: Request & RequestContext) {
    if (!req.user) throw new UnauthorizedException("No active session");
    if (!req.tenant) throw new UnauthorizedException("Tenant context required");
    await this.sessionAggregator.deleteCurrentOrgLogo(
      req.user.id,
      req.tenant.id,
    );
    return { status: "ok" as const };
  }

  @Put("profile")
  async updateCurrentUserProfile(
    @Req() req: Request & RequestContext,
    @Body() body: UpdateProfileDto,
  ) {
    if (!req.user) {
      throw new UnauthorizedException("No active session");
    }

    const profile = await this.sessionAggregator.updateCurrentUserProfile(
      req.user.id,
      body,
    );
    if (!profile) {
      throw new NotFoundException("Account profile not found");
    }

    return profile;
  }

  @Put("username")
  async updateCurrentUsername(
    @Req() req: Request & RequestContext,
    @Body() body: UpdateUsernameDto,
  ) {
    if (!req.user) {
      throw new UnauthorizedException("No active session");
    }
    const username = (body.username ?? "").trim();
    if (!username) {
      throw new BadRequestException("username is required");
    }
    const profile = await this.sessionAggregator.changeCurrentUserUsername(
      req.user.id,
      username,
    );
    if (!profile) {
      throw new NotFoundException("Account profile not found");
    }
    return profile;
  }

  @Put("avatar")
  async uploadAvatar(@Req() req: Request & RequestContext) {
    if (!req.user) {
      throw new UnauthorizedException("No active session");
    }
    const body: unknown = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new BadRequestException("empty_body");
    }
    if (body.length > AVATAR_MAX_BYTES) {
      throw new BadRequestException("too_large");
    }
    const contentType = sniffImageType(body);
    if (!contentType) {
      // Not a supported raster image (rejects SVG/text → stored-XSS guard).
      throw new BadRequestException("unsupported_image");
    }
    return this.sessionAggregator.setCurrentUserAvatar(
      req.user.id,
      body,
      contentType,
    );
  }

  @Delete("avatar")
  async removeAvatar(@Req() req: Request & RequestContext) {
    if (!req.user) {
      throw new UnauthorizedException("No active session");
    }
    await this.sessionAggregator.deleteCurrentUserAvatar(req.user.id);
    return { status: "ok" as const };
  }

  @Put("password")
  async updatePassword(
    @Req() req: Request & RequestContext,
    @Body() body: ChangePasswordDto,
  ) {
    if (!req.user) {
      throw new UnauthorizedException("No active session");
    }

    await this.sessionAggregator.changeCurrentUserPassword(
      req.user.id,
      body.currentPassword,
      body.nextPassword,
    );

    return { status: "ok" as const };
  }

  /**
   * Self-service initial password setup — for a user with no existing
   * credential (registered via phone/social login), so there's no old
   * password to verify. Rejects (400) if a password is already set.
   */
  @Post("password/initial")
  async setInitialPassword(
    @Req() req: Request & RequestContext,
    @Body() body: SetInitialPasswordDto,
  ) {
    if (!req.user) {
      throw new UnauthorizedException("No active session");
    }
    if ((body.nextPassword ?? "").length < 8) {
      throw new BadRequestException("weak_password");
    }

    await this.sessionAggregator.setCurrentUserInitialPassword(
      req.user.id,
      body.nextPassword,
    );

    return { status: "ok" as const };
  }

  // ── Phone change — all-or-nothing two-step flow ──────────────────────────────

  @Post("phone/send-old-otp")
  async sendOldPhoneOtp(@Req() req: Request & RequestContext) {
    if (!req.user) throw new UnauthorizedException("No active session");
    const profile = await this.sessionAggregator.getCurrentUserProfile(
      req.user.id,
    );
    if (!profile?.phone) throw new BadRequestException("no_phone");
    await this.phoneCodeService.sendCode(profile.phone);
    return { status: "ok" as const };
  }

  @Post("phone/send-email-otp")
  async sendEmailOtp(@Req() req: Request & RequestContext) {
    if (!req.user) throw new UnauthorizedException("No active session");
    const profile = await this.sessionAggregator.getCurrentUserProfile(
      req.user.id,
    );
    if (!profile?.email) throw new BadRequestException("no_email");
    const emailVerifyToken = await this.phoneChangeService.sendEmailOtp(
      req.user.id,
      profile.email,
    );
    return {
      emailVerifyToken,
      maskedEmail: maskEmail(profile.email),
    };
  }

  @Post("phone/send-new-otp")
  async sendNewPhoneOtp(
    @Req() req: Request & RequestContext,
    @Body() body: { phone: string },
  ) {
    if (!req.user) throw new UnauthorizedException("No active session");
    const phone = body.phone?.trim();
    if (!phone) throw new BadRequestException("phone_required");
    await this.phoneCodeService.sendCode(phone);
    return { status: "ok" as const };
  }

  /** Step 1 gate: verify identity (old phone OTP or email OTP) → identity token. */
  @Post("phone/verify-identity")
  async verifyPhoneIdentity(
    @Req() req: Request & RequestContext,
    @Body() body: VerifyPhoneIdentityDto,
  ) {
    if (!req.user) throw new UnauthorizedException("No active session");
    const profile = await this.sessionAggregator.getCurrentUserProfile(
      req.user.id,
    );
    if (!profile) throw new UnauthorizedException("No active session");

    let verified = false;

    if (body.method === "phone") {
      if (!profile.phone) throw new BadRequestException("no_phone");
      verified = await this.phoneCodeService.verifyCode(
        profile.phone,
        body.code,
      );
    } else if (body.method === "email") {
      if (!body.emailVerifyToken)
        throw new BadRequestException("email_token_required");
      verified = this.phoneChangeService.verifyEmailOtp(
        body.emailVerifyToken,
        body.code,
        req.user.id,
      );
    } else {
      throw new BadRequestException("invalid_method");
    }

    if (!verified) throw new BadRequestException("invalid_code");

    const identityToken = this.phoneChangeService.issueIdentityToken(
      req.user.id,
      profile.phone ?? "",
    );
    return { identityToken };
  }

  /** Step 2 gate: verify new phone OTP + identity token → atomically update phone. */
  @Put("phone")
  async changePhone(
    @Req() req: Request & RequestContext,
    @Body() body: ConfirmPhoneChangeDto,
  ) {
    if (!req.user) throw new UnauthorizedException("No active session");

    const identityInfo = this.phoneChangeService.validateIdentityToken(
      body.identityToken,
      req.user.id,
    );
    if (!identityInfo)
      throw new BadRequestException("identity_token_invalid_or_expired");

    const newPhone = body.newPhone?.trim();
    if (!newPhone) throw new BadRequestException("new_phone_required");

    const newPhoneOk = await this.phoneCodeService.verifyCode(
      newPhone,
      body.newPhoneCode,
    );
    if (!newPhoneOk) throw new BadRequestException("new_phone_code_invalid");

    const profile = await this.sessionAggregator.changeCurrentUserPhone(
      req.user.id,
      newPhone,
    );
    if (!profile) throw new NotFoundException("user_not_found");

    return profile;
  }

  /** Verify the CURRENT phone by OTP → mark phone_verified. */
  @Post("phone/verify-current")
  async verifyCurrentPhone(
    @Req() req: Request & RequestContext,
    @Body() body: VerifyCurrentPhoneDto,
  ) {
    if (!req.user) throw new UnauthorizedException("No active session");
    const profile = await this.sessionAggregator.getCurrentUserProfile(
      req.user.id,
    );
    if (!profile?.phone) throw new BadRequestException("no_phone");
    const ok = await this.phoneCodeService.verifyCode(profile.phone, body.code);
    if (!ok) throw new BadRequestException("invalid_code");
    const updated = await this.sessionAggregator.markCurrentUserPhoneVerified(
      req.user.id,
    );
    if (!updated) throw new NotFoundException("user_not_found");
    return updated;
  }

  // ── Email verify-current + change — mirrors the phone flow ───────────────────

  /** Send an OTP to the CURRENT email to verify ownership. */
  @Post("email/send-current-otp")
  async sendCurrentEmailOtp(@Req() req: Request & RequestContext) {
    if (!req.user) throw new UnauthorizedException("No active session");
    const profile = await this.sessionAggregator.getCurrentUserProfile(
      req.user.id,
    );
    if (!profile?.email) throw new BadRequestException("no_email");
    if (profile.emailVerified)
      throw new BadRequestException("already_verified");
    const emailVerifyToken = await this.emailChangeService.sendCode(
      req.user.id,
      profile.email,
      "verify-current",
    );
    return { emailVerifyToken, maskedEmail: maskEmail(profile.email) };
  }

  /** Confirm the current-email OTP → mark email_verified. */
  @Post("email/verify-current")
  async verifyCurrentEmail(
    @Req() req: Request & RequestContext,
    @Body() body: VerifyCurrentEmailDto,
  ) {
    if (!req.user) throw new UnauthorizedException("No active session");
    const ok = this.emailChangeService.verifyCode(
      body.emailVerifyToken,
      body.code,
      req.user.id,
      "verify-current",
    );
    if (!ok) throw new BadRequestException("invalid_code");
    const updated = await this.sessionAggregator.markCurrentUserEmailVerified(
      req.user.id,
    );
    if (!updated) throw new NotFoundException("user_not_found");
    return updated;
  }

  /** Send an OTP to a NEW email address (change flow). */
  @Post("email/send-new-otp")
  async sendNewEmailOtp(
    @Req() req: Request & RequestContext,
    @Body() body: SendNewEmailOtpDto,
  ) {
    if (!req.user) throw new UnauthorizedException("No active session");
    const email = body.email?.trim().toLowerCase();
    if (!email || !email.includes("@") || email.length > 128) {
      throw new BadRequestException("invalid_email");
    }
    const emailVerifyToken = await this.emailChangeService.sendCode(
      req.user.id,
      email,
      "change",
    );
    return { emailVerifyToken };
  }

  /** Confirm the new-email OTP → atomically replace email + mark verified. */
  @Put("email")
  async changeEmail(
    @Req() req: Request & RequestContext,
    @Body() body: ConfirmEmailChangeDto,
  ) {
    if (!req.user) throw new UnauthorizedException("No active session");
    const verified = this.emailChangeService.verifyCode(
      body.emailVerifyToken,
      body.code,
      req.user.id,
      "change",
    );
    // The token binds the new email; trust it over the request body.
    if (!verified) throw new BadRequestException("invalid_code");
    const profile = await this.sessionAggregator.changeCurrentUserEmail(
      req.user.id,
      verified.email,
    );
    if (!profile) throw new NotFoundException("user_not_found");
    return profile;
  }

  // ── Account (username+password) login enable/disable ─────────────────────────

  @Post("account-login")
  async setAccountLogin(
    @Req() req: Request & RequestContext,
    @Body() body: SetAccountLoginEnabledDto,
  ) {
    if (!req.user) throw new UnauthorizedException("No active session");
    const profile = await this.sessionAggregator.setAccountLoginEnabled(
      req.user.id,
      body.enabled,
    );
    if (!profile) throw new NotFoundException("user_not_found");
    return profile;
  }
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const maskedLocal =
    local.length <= 2
      ? local[0] + "***"
      : local.slice(0, 2) + "***" + local.slice(-1);
  const domainParts = domain.split(".");
  const maskedDomain =
    domainParts.length >= 2
      ? domainParts[0]!.slice(0, 2) + "***." + domainParts.slice(1).join(".")
      : domain;
  return `${maskedLocal}@${maskedDomain}`;
}
