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
import type { Pool } from "pg";
import {
  AVATAR_MAX_BYTES,
  NotificationPreferencesService,
  sniffImageType,
} from "@vxture/service-account";
import { PhoneCodeService } from "@vxture/service-sms";
import { COMMERCE_PG_POOL } from "@vxture/service-subscription";
import { SessionAggregator } from "../aggregators/session.aggregator";
import { AccountDeletionAggregator } from "../aggregators/account-deletion.aggregator";
import { auditCustomerAction } from "../audit/audit-log";
import { TenantClosureAggregator } from "../aggregators/tenant-closure.aggregator";
import {
  ChangePasswordDto,
  ConfirmEmailChangeDto,
  ConfirmPhoneChangeDto,
  ConvertTenantDto,
  RequestTenantClosureDto,
  RequestAccountDeletionDto,
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
import {
  listHeldProductTiles,
  type ProductAppTile,
} from "../lib/product-app-tiles";
import { EmailChangeService } from "../services/email-change.service";
import { PhoneChangeService } from "../services/phone-change.service";
import type { RequestContext } from "../types/console.types";
import { RequireCapability, SelfScope } from "../auth/capability";

@SelfScope()
@Controller("api/me")
export class MeRouter {
  constructor(
    @Inject(SessionAggregator)
    private readonly sessionAggregator: SessionAggregator,
    @Inject(AccountDeletionAggregator)
    private readonly accountDeletion: AccountDeletionAggregator,
    @Inject(TenantClosureAggregator)
    private readonly tenantClosure: TenantClosureAggregator,
    @Inject(COMMERCE_PG_POOL)
    private readonly pool: Pool,
    @Inject(PhoneChangeService)
    private readonly phoneChangeService: PhoneChangeService,
    @Inject(EmailChangeService)
    private readonly emailChangeService: EmailChangeService,
    @Inject(PhoneCodeService)
    private readonly phoneCodeService: PhoneCodeService,
    @Inject(NotificationPreferencesService)
    private readonly notificationPreferences: NotificationPreferencesService,
  ) {}

  /**
   * 通知偏好(owner 2026-08-21 裁定决策 1 选项 A)。此前这页把状态存在
   * localStorage 里、控件全 disabled——用户以为设了,换个设备就没了,
   * 是个会骗人的界面。
   *
   * 服务端返回补齐后的**完整矩阵**,前端不再自带默认值:两份默认值早晚漂移,
   * 而漂移的症状恰好是「换台设备开关不一样」,与它要修的 bug 同形。
   */
  @Get("notification-preferences")
  async getNotificationPreferences(@Req() req: Request & RequestContext) {
    if (!req.user) throw new UnauthorizedException("No active session");
    return this.notificationPreferences.get(req.user.id);
  }

  /**
   * 覆盖写。body 不过 DTO 校验而是交给服务层 normalize:主题与渠道是
   * 服务端定义的白名单,未知键一律丢弃——用 DTO 声明一遍等于把同一份白名单
   * 抄成两份。返回规整后的实际存量,让「安全类站内信被强制打开」在界面上可见。
   */
  @Put("notification-preferences")
  async putNotificationPreferences(
    @Req() req: Request & RequestContext,
    @Body() body: unknown,
  ) {
    if (!req.user) throw new UnauthorizedException("No active session");
    return this.notificationPreferences.replace(req.user.id, body);
  }

  @Get()
  async getCurrentUser(@Req() req: Request & RequestContext) {
    if (!req.user) {
      throw new UnauthorizedException("No active session");
    }

    return this.sessionAggregator.getCurrentUser(req.user.id, req.tenant?.id);
  }

  /**
   * 应用中心磁贴 = 当前租户默认工作空间**实际持有**的产品（2026-08-30）。
   * 此前是四块写死的目录：三块是控制台自己的板块（已挪回门户导航配置——
   * 它们是导航不是数据），一块「助手」按 getActiveSubscription 门控，而传的
   * 是 tenant id 不是 workspace id，那扇门从来没开过。推导见
   * lib/product-app-tiles.ts；无租户上下文返回空而不抛——应用中心是壳层的
   * 一个视图，不该因为还没选租户就 401。
   */
  @Get("apps")
  async getMyApps(
    @Req() req: Request & RequestContext,
  ): Promise<ProductAppTile[]> {
    if (!req.user) throw new UnauthorizedException("No active session");
    if (!req.tenant) return [];
    return listHeldProductTiles(this.pool, req.tenant.id);
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
    // 近 30 天(窗口在仓储层),最多 50 条;页面默认只露 3 条,其余「更多」展开。
    return this.sessionAggregator.getUserLoginHistory(req.user.id, 50);
  }

  @Get("sessions")
  async getSessions(@Req() req: Request & RequestContext) {
    if (!req.user) throw new UnauthorizedException("No active session");
    return this.sessionAggregator.getUserSessions(req.user.id);
  }

  // ── 删除账号(批 5b,050-account §7)。三条都是 @SelfScope(类级):保留期内
  //    auth.middleware 只放行这几条与会话恢复读,其余 403 ACCOUNT_DELETING。

  /** 资格快照:阻断 / 确认 / 连带动作 + 当前状态与保留期。 */
  @Get("deletion")
  async getAccountDeletion(@Req() req: Request & RequestContext) {
    if (!req.user) throw new UnauthorizedException("No active session");
    return this.accountDeletion.getState(req.user.id);
  }

  /** 申请删除:再判一次资格,连带动作做完后账号进 30 天保留期。 */
  @Post("deletion")
  async requestAccountDeletion(
    @Req() req: Request & RequestContext,
    @Body() body: RequestAccountDeletionDto,
  ) {
    if (!req.user) throw new UnauthorizedException("No active session");
    if (body?.acknowledged !== true) {
      throw new BadRequestException("acknowledgement_required");
    }
    return this.accountDeletion.request(req.user.id, req.ip);
  }

  /** 保留期内撤销删除并重新启用。 */
  @Post("deletion/cancel")
  async cancelAccountDeletion(@Req() req: Request & RequestContext) {
    if (!req.user) throw new UnauthorizedException("No active session");
    return this.accountDeletion.cancel(req.user.id);
  }

  @Get("workspaces")
  async getMyWorkspaces(@Req() req: Request & RequestContext) {
    if (!req.user) throw new UnauthorizedException("No active session");
    return this.sessionAggregator.getMyWorkspaces(req.user.id, req.tenant?.id);
  }

  /**
   * 账号信息页「设为默认」(owner 2026-09-05):每次登录后默认进入的租户。
   * 自持数据(本人的成员关系),不需要租户能力;目标非本人所在租户 404。
   */
  @Put("tenants/:tenantId/default")
  async setDefaultTenant(
    @Req() req: Request & RequestContext,
    @Param("tenantId") tenantId: string,
  ) {
    if (!req.user) throw new UnauthorizedException("No active session");
    await this.sessionAggregator.setDefaultTenant(req.user.id, tenantId);
    return { status: "ok" as const };
  }

  /**
   * 本人所在任一租户的标识(账号信息页所在租户列表画头像用;当前租户的另有
   * `organization/logo`)。不是成员一律 404,不区分「没这个租户」与「不是成员」。
   */
  @Get("tenants/:tenantId/logo")
  async getTenantLogo(
    @Req() req: Request & RequestContext,
    @Param("tenantId") tenantId: string,
    @Res() res: Response,
  ) {
    if (!req.user) throw new UnauthorizedException("No active session");
    const logo = await this.sessionAggregator.getTenantLogoForMember(
      req.user.id,
      tenantId,
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

  @RequireCapability("tenant.settings.manage")
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

  /**
   * 个人租户转为组织租户(批 5c-2)。owner 且个人类型才放行(仓储层再判一次);
   * 不可回退。主体码 v4 之后不换号,钱 / 订阅 / 成员 / 工作空间原样跟着租户。
   */
  @RequireCapability("tenant.settings.manage")
  @Post("organization/convert")
  async convertTenant(
    @Req() req: Request & RequestContext,
    @Body() body: ConvertTenantDto,
  ) {
    if (!req.user) throw new UnauthorizedException("No active session");
    if (body?.acknowledged !== true) {
      throw new BadRequestException("acknowledgement_required");
    }
    return this.sessionAggregator.convertCurrentTenantToOrganization(
      req.user.id,
      req.tenant?.id,
      body?.name ?? "",
    );
  }

  /** 注销资格:阻断 / 确认 / 连带动作(走查 2026-09-05;照账号删除的三档)。 */
  @RequireCapability("tenant.delete")
  @Get("organization/closure")
  async getTenantClosure(@Req() req: Request & RequestContext) {
    if (!req.user) throw new UnauthorizedException("No active session");
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    return this.tenantClosure.getState(req.user.id, req.tenant.id);
  }

  /**
   * 注销租户:再判一次资格,输入的名称须与租户名一致;可取消的订单先取消,然后
   * 软删 + 撤邀请。会话下一次解析自动回落到个人租户。
   */
  @RequireCapability("tenant.delete")
  @Post("organization/closure")
  async requestTenantClosure(
    @Req() req: Request & RequestContext,
    @Body() body: RequestTenantClosureDto,
  ) {
    if (!req.user) throw new UnauthorizedException("No active session");
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    if (body?.acknowledged !== true) {
      throw new BadRequestException("acknowledgement_required");
    }
    const result = await this.tenantClosure.request(
      req.user.id,
      req.tenant.id,
      body?.confirmName ?? "",
      req.ip,
    );
    auditCustomerAction(this.pool, req, {
      action: "tenant.close",
      resourceType: "tenant",
      resourceId: req.tenant.id,
      result: "success",
    });
    return result;
  }

  @RequireCapability("tenant.settings.manage")
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

  @RequireCapability("tenant.settings.manage")
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
