/**
 * verification.router.ts - 租户实名认证路由
 * @package @vxture/bff-console
 * @layer Application
 * @category Router
 *
 * 组织企业认证(owner 2026-08-21 P0;spec 20-vxture-tenant-console-info §3.4):
 *   GET  /api/verification/tenant — 当前态 + 申请历史;
 *   POST /api/verification/tenant — 提交企业认证(轻量模式,spec §1.2 第 57 行:
 *        本期无需上传证件影像——统一社会信用代码 + 法定代表人姓名);
 *        pending 期间拒绝重复提交;verified 后再提交 = 变更重审(spec 245)。
 * 审核在 admin 既有台账(approve/reject 同步 tenants.verification_status)。
 * 个人 KYC(user_kycs)另立项:id_no 加密密钥体系与 admin 审核面未建,挂账。
 * 权限:提交限组织租户的 tenant.settings.manage 持有者(owner/manager)。
 */

import {
  Controller,
  BadRequestException,
  ConflictException,
  Get,
  Inject,
  Post,
  Req,
  Body,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import {
  GovernanceService,
  OrganizationService,
} from "@vxture/service-organization";
import type { TenantVerificationRecord } from "@vxture/service-organization";
import type { RequestContext } from "../types/console.types";

export interface ConsoleVerificationView {
  id: string;
  verificationType: string;
  businessLicenseNo: string | null;
  legalPersonName: string | null;
  status: "unverified" | "pending" | "verified" | "rejected";
  rejectReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface ConsoleTenantVerificationState {
  /** 当前有效状态(最新一条;无申请 = unverified) */
  status: "unverified" | "pending" | "verified" | "rejected";
  latest: ConsoleVerificationView | null;
  history: ConsoleVerificationView[];
}

/** 统一社会信用代码:18 位,数字+大写字母(排易混淆 IOZSV 之外从宽)。 */
const LICENSE_NO_RE = /^[0-9A-HJ-NP-RTUWXY]{18}$/;

function mapView(r: TenantVerificationRecord): ConsoleVerificationView {
  return {
    id: r.id,
    verificationType: r.verificationType,
    businessLicenseNo: r.businessLicenseNo,
    legalPersonName: r.legalPersonName,
    status: r.status,
    rejectReason: r.rejectReason,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

@Controller("api/verification")
export class VerificationRouter {
  constructor(
    @Inject(OrganizationService) private readonly org: OrganizationService,
    @Inject(GovernanceService) private readonly gov: GovernanceService,
  ) {}

  @Get("tenant")
  async getTenantVerification(
    @Req() req: Request & RequestContext,
  ): Promise<ConsoleTenantVerificationState> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    const history = await this.org.listTenantVerifications(req.tenant.id);
    const latest = history[0] ?? null;
    return {
      status: latest?.status ?? "unverified",
      latest: latest ? mapView(latest) : null,
      history: history.map(mapView),
    };
  }

  @Post("tenant")
  async submitTenantVerification(
    @Req() req: Request & RequestContext,
    @Body()
    body: { businessLicenseNo?: unknown; legalPersonName?: unknown },
  ): Promise<ConsoleVerificationView> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    if (!req.user) throw new UnauthorizedException("No active session");
    if (req.tenant.tenantType !== "organization") {
      throw new BadRequestException(
        "企业认证仅适用于组织租户;个人实名认证即将开放",
      );
    }
    const licenseNo =
      typeof body.businessLicenseNo === "string"
        ? body.businessLicenseNo.trim().toUpperCase()
        : "";
    if (!LICENSE_NO_RE.test(licenseNo)) {
      throw new BadRequestException("统一社会信用代码格式不正确(18 位)");
    }
    const legalPersonName =
      typeof body.legalPersonName === "string"
        ? body.legalPersonName.trim()
        : "";
    if (!legalPersonName || legalPersonName.length > 64) {
      throw new BadRequestException("法定代表人姓名必填(不超过 64 字)");
    }

    // 治理门:tenant.settings.manage(owner/manager)才可提交
    await this.gov.assertCan(
      req.user.id,
      { orgId: req.tenant.id },
      "tenant.settings.manage",
    );

    try {
      const record = await this.org.submitTenantVerification({
        tenantId: req.tenant.id,
        userId: req.user.id,
        businessLicenseNo: licenseNo,
        legalPersonName,
      });
      return mapView(record);
    } catch (err) {
      if (
        err instanceof Error &&
        err.message === "verification_already_pending"
      ) {
        throw new ConflictException("已有认证申请在审核中,请勿重复提交");
      }
      throw err;
    }
  }
}
