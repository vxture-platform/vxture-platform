/**
 * verification.router.ts - 租户实名认证路由
 * @package @vxture/bff-console
 * @layer Application
 * @category Router
 *
 * 组织企业认证(owner 2026-08-21 P0;spec 20-vxture-tenant-console-info §3.4):
 *   GET  /api/verification/tenant — 当前态 + 能力等级 + 申请历史;
 *   POST /api/verification/tenant — 提交企业认证;
 *        pending 期间拒绝重复提交;verified 后再提交 = 变更重审(spec 245)。
 * 审核在 admin 既有台账(approve/reject 同步 tenants.verification_status)。
 *
 * 三种方式(owner 2026-09-06),方式轴与主体轴正交,能力差异见 lib/verification-level:
 *   lite      简易企业实名认证 —— 企业名称 + 统一社会信用代码 + 法定代表人姓名;
 *                                 可订阅、**不可开票**;本期唯一开放。
 *   face      法人扫脸实名认证 —— 开发中,提交一律 400,页面上占位禁用。
 *   documents 提交资料实名认证 —— 开发中,同上。
 * 未开放的方式在这里也挡一道:页面禁用只是提示,后端不认才是门。
 *
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
import type { Pool } from "pg";
import {
  GovernanceService,
  OrganizationService,
} from "@vxture/service-organization";
import type {
  TenantVerificationMethod,
  TenantVerificationRecord,
} from "@vxture/service-organization";
import type { RequestContext } from "../types/console.types";
import { auditCustomerAction } from "../audit/audit-log";
import { RequireCapability, SelfScope } from "../auth/capability";
import {
  canIssueInvoice,
  verificationLevelOf,
  type TenantVerificationLevel,
} from "../lib/verification-level";

// Inline the DI token (repo-wide pattern): SubscriptionModule provides the pool.
const COMMERCE_PG_POOL = "COMMERCE_PG_POOL";

/** 本期开放提交的方式。另两种在库里合法(将来用),但现在不收。 */
const AVAILABLE_METHODS: ReadonlySet<TenantVerificationMethod> = new Set([
  "lite",
]);
const KNOWN_METHODS: ReadonlySet<string> = new Set([
  "lite",
  "face",
  "documents",
]);

export interface ConsoleVerificationView {
  id: string;
  verificationType: string;
  /** 认证方式:lite / face / documents。 */
  verificationMethod: TenantVerificationMethod;
  companyName: string | null;
  businessLicenseNo: string | null;
  legalPersonName: string | null;
  status: "unverified" | "pending" | "verified" | "rejected" | "superseded";
  rejectReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface ConsoleTenantVerificationState {
  /** 当前有效状态(最新一条;无申请 = unverified) */
  status: "unverified" | "pending" | "verified" | "rejected" | "superseded";
  /** 能力等级:none / lite(可订阅不可开票)/ full。由已通过的最新一条派生。 */
  level: TenantVerificationLevel;
  /** 当前等级能否申请开票——页面据此提示局限性,不各自推。 */
  canIssueInvoice: boolean;
  /** 本期可提交的方式;其余在页面上占位禁用。 */
  availableMethods: TenantVerificationMethod[];
  latest: ConsoleVerificationView | null;
  history: ConsoleVerificationView[];
}

/** 统一社会信用代码:18 位,数字+大写字母(排易混淆 IOZSV 之外从宽)。 */
const LICENSE_NO_RE = /^[0-9A-HJ-NP-RTUWXY]{18}$/;

function mapView(r: TenantVerificationRecord): ConsoleVerificationView {
  return {
    id: r.id,
    verificationType: r.verificationType,
    verificationMethod: r.verificationMethod,
    companyName: r.companyName,
    businessLicenseNo: r.businessLicenseNo,
    legalPersonName: r.legalPersonName,
    status: r.status,
    rejectReason: r.rejectReason,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

@SelfScope()
@Controller("api/verification")
export class VerificationRouter {
  constructor(
    @Inject(OrganizationService) private readonly org: OrganizationService,
    @Inject(GovernanceService) private readonly gov: GovernanceService,
    /** 仅供租户审计写钩子。 */
    @Inject(COMMERCE_PG_POOL) private readonly pool: Pool,
  ) {}

  @Get("tenant")
  async getTenantVerification(
    @Req() req: Request & RequestContext,
  ): Promise<ConsoleTenantVerificationState> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    const history = await this.org.listTenantVerifications(req.tenant.id);
    const latest = history[0] ?? null;
    const level = verificationLevelOf(latest);
    return {
      status: latest?.status ?? "unverified",
      level,
      canIssueInvoice: canIssueInvoice(level),
      availableMethods: [...AVAILABLE_METHODS],
      latest: latest ? mapView(latest) : null,
      history: history.map(mapView),
    };
  }

  @RequireCapability("tenant.settings.manage")
  @Post("tenant")
  async submitTenantVerification(
    @Req() req: Request & RequestContext,
    @Body()
    body: {
      method?: unknown;
      companyName?: unknown;
      businessLicenseNo?: unknown;
      legalPersonName?: unknown;
    },
  ): Promise<ConsoleVerificationView> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    if (!req.user) throw new UnauthorizedException("No active session");
    if (req.tenant.tenantType !== "organization") {
      throw new BadRequestException(
        "企业认证仅适用于组织租户;个人实名认证即将开放",
      );
    }

    // 方式:缺省 lite(老客户端不带这个字段);未知值与未开放的方式都挡在这里
    const rawMethod =
      typeof body.method === "string" && body.method ? body.method : "lite";
    if (!KNOWN_METHODS.has(rawMethod)) {
      throw new BadRequestException("认证方式不存在");
    }
    const method = rawMethod as TenantVerificationMethod;
    if (!AVAILABLE_METHODS.has(method)) {
      throw new BadRequestException(
        "该认证方式尚未开放,请选择简易企业实名认证",
      );
    }

    const companyName =
      typeof body.companyName === "string" ? body.companyName.trim() : "";
    if (!companyName || companyName.length > 128) {
      throw new BadRequestException("企业名称必填(不超过 128 字)");
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
        method,
        companyName,
        businessLicenseNo: licenseNo,
        legalPersonName,
      });
      auditCustomerAction(this.pool, req, {
        action: "tenant.verification.submit",
        resourceType: "tenant_verification",
        resourceId: licenseNo,
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
