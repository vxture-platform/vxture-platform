import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Logger,
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
import { COMMERCE_PG_POOL } from "@vxture/service-subscription";
import type { NotificationDispatcher } from "@vxture/service-notification";
import { CUSTOMER_NOTIFIER } from "../services/customer-notifications.wiring";
import { SessionAggregator } from "../aggregators/session.aggregator";
import { auditCustomerAction } from "../audit/audit-log";
import { TenantClosureAggregator } from "../aggregators/tenant-closure.aggregator";
import {
  ConvertTenantDto,
  RequestTenantClosureDto,
  UpdateOrganizationDto,
} from "../dto/tenant.dto";
import {
  listHeldProductTiles,
  type ProductAppTile,
} from "../lib/product-app-tiles";
import type { RequestContext } from "../types/console.types";
import { RequireCapability, SelfScope } from "../auth/capability";

@SelfScope()
@Controller("api/me")
export class MeRouter {
  private readonly logger = new Logger(MeRouter.name);

  constructor(
    @Inject(SessionAggregator)
    private readonly sessionAggregator: SessionAggregator,
    @Inject(TenantClosureAggregator)
    private readonly tenantClosure: TenantClosureAggregator,
    @Inject(COMMERCE_PG_POOL)
    private readonly pool: Pool,
    @Inject(CUSTOMER_NOTIFIER)
    private readonly notifier: NotificationDispatcher,
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
    const converted =
      await this.sessionAggregator.convertCurrentTenantToOrganization(
        req.user.id,
        req.tenant?.id,
        body?.name ?? "",
      );

    /* owner 2026-09-09:「组织从个人到组织租户，应该有消息」。
       此前这件不可回退的事一句话都不发——做完就只是页面变了个样。

       发在转换**成功之后**:上面抛异常就不该发「已升级」。
       best-effort:业务写已提交,通知失败只记日志、不回滚——与订单那条同一纪律。

       收件人不指定:此刻租户里只有 owner 一个人(个人租户转来的),
       分发器默认就发给 owner,正是该收到的那个人。 */
    try {
      await this.notifier.notify({
        tenantId: converted.tenantId,
        templateCode: "tenant.converted",
        reference: { type: "tenant", id: converted.tenantId },
        params: { tenantName: converted.name },
        link: "/tenant",
      });
    } catch (err) {
      this.logger.warn(
        `tenant.converted notice for ${converted.tenantId} failed: ${String(err)}`,
      );
    }
    return converted;
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
}
