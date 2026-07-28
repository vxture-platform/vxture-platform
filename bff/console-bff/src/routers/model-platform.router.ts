/**
 * model-platform.router.ts - 租户模型平台只读路由
 * @package @vxture/bff-console
 * @layer Application
 * @category Router
 * @author AI-Generated
 * @date 2026-06-06
 *
 * Console BFF 只暴露当前租户可见的模型、授权、配额和用量状态。
 * 平台级模型、Provider、价格、策略写操作必须走 Admin BFF。
 *
 * 代理路径前缀 2026-07-28 从 `/model-platform/admin/*` 改为 `/capability/*`
 * ——atlas 侧改名(TD-013),权威表见 `vxture-atlas/docs/20-specs/10-http-surface.md`。
 * `MODEL_PLATFORM_URL` 已指向外部 atlas 主机,本仓 `services/model/platform`
 * 同步退役(product_250 M-4 线)。
 *
 * 2026-07-28(TD-043 platform→atlas 半程):atlas 的 `S2sAuthGuard` 严格要求签名
 * S2S token,无共享密钥兜底,故每次代理都经 `S2sExchangeService` 先换票
 * (`token-exchange.service.ts` 新增的平台级调用方分支,`act.sub="console"`)。
 * 换票失败直接 502,不降级为裸调——裸调必然被 atlas 401,502 是更清晰的信号。
 *
 * 2026-07-28(语义修正):换票的 `workspace_id` claim 必须是真实 workspace id
 * (`req.tenant.workspace`),不是 tenant/org id(`req.tenant.id`)——两者是
 * `tenancy.tenants`→`tenancy.workspaces` 一对多关系里不同层级的 id,
 * `TenantContext.id` 从来就是 org 级(见 `session.aggregator.ts` 的
 * `toTenantContext(orgId, …)`)。同时把 org id 也带上(`org_id` claim),
 * 供 atlas 未来的 `scope=tenant` 汇总查询使用。查询字符串里现有的
 * `tenantId=` 参数是 atlas `/capability/*` 端点自己的既有契约,维持不变,
 * 与本次修正的 S2S token claim 是两回事。
 *
 * 2026-07-28(部分切换 `/tenancy/*`,TD-043 收尾一半):atlas 建了 `vxture-atlas`#70
 * 的"tenant self-service plane"(`/tenancy/models`+`/tenancy/usage`,scope 从 token
 * claim 解析、调用方声明不了),但只覆盖了本路由四个方法里的一个半——
 * `/tenancy/models` 内部已做 grant 过滤,直接替代原先"查 models 再查 grants 取交集"
 * 的两次往返;`/tenancy/usage` 语义和形状都对不上(atlas 自己的 reqlog、非计费口径、
 * 无 cycleMonth/cost/currency),不是 `usage-summaries` 的直接替代,需要另一轮设计,
 * 暂不动。**`listGrants`(授权明细:priority/expiresAt/applicationType)和
 * `listQuotas`(订阅周期配额:maxUsers/periodTokens/allowedModelIds)atlas 完全没建
 * 对应端点**——已在 `vxture-atlas#66` 追问是有意不建(该数据本该是平台自己的)还是
 * 遗漏,两个方法暂留在 `/capability/*`,等回复。
 */

import {
  BadGatewayException,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  Inject,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { VxConfigService } from "@vxture/core-config";
import { S2sExchangeService } from "../auth/s2s-exchange.service";

import type {
  AiModelGrantRecord,
  AiModelRecord,
  RequestContext,
  TenantQuotaRecord,
  TenantUsageSummaryRecord,
} from "../types/console.types";

/** Exchange audience for atlas's capability plane (product_100 code). */
const ATLAS_AUDIENCE = "atlas";

interface ModelPlatformErrorBody {
  code?: string;
  message?: string | string[];
  error?: string;
  statusCode?: number;
  details?: unknown;
}

// ── Router ───────────────────────────────────────────────────────────────────

@Controller("api/model-platform")
export class ModelPlatformRouter {
  private readonly modelPlatformUrl: string;

  constructor(
    @Inject(VxConfigService) configService: VxConfigService,
    @Inject(S2sExchangeService)
    private readonly s2sExchange: S2sExchangeService,
  ) {
    this.modelPlatformUrl =
      configService.platform.MODEL_PLATFORM_URL.trim().replace(/\/+$/, "");
  }

  /** Exchange this request's resolved workspace (+ org) for an aud=atlas S2S bearer, then proxy. */
  private async request<T>(
    workspaceId: string,
    orgId: string,
    path: string,
  ): Promise<T> {
    const bearer = await this.s2sExchange.getToken(
      workspaceId,
      ATLAS_AUDIENCE,
      orgId,
    );
    if (!bearer) {
      throw new BadGatewayException("Unable to authenticate to Model Platform");
    }
    return modelPlatformRequest<T>(path, this.modelPlatformUrl, bearer);
  }

  /** `/tenancy/models` already filters to this workspace's active grants — no separate grants join needed. */
  @Get("models")
  async listModels(
    @Req() req: Request & RequestContext,
  ): Promise<AiModelRecord[]> {
    const tenantId = requireTenantId(req);
    const workspaceId = requireWorkspaceId(req);
    return this.request<AiModelRecord[]>(
      workspaceId,
      tenantId,
      "/tenancy/models",
    );
  }

  @Get("grants")
  async listGrants(
    @Req() req: Request & RequestContext,
    @Query("modelId") modelId?: string,
    @Query("applicationId") applicationId?: string,
    @Query("applicationType") applicationType?: string,
  ): Promise<AiModelGrantRecord[]> {
    const tenantId = requireTenantId(req);
    const workspaceId = requireWorkspaceId(req);
    const params = new URLSearchParams({ tenantId });
    if (modelId) params.set("modelId", modelId);
    if (applicationId) params.set("applicationId", applicationId);
    if (applicationType) params.set("applicationType", applicationType);

    return this.request<AiModelGrantRecord[]>(
      workspaceId,
      tenantId,
      `/capability/grants?${params.toString()}`,
    );
  }

  @Get("quotas")
  async listQuotas(
    @Req() req: Request & RequestContext,
    @Query("includeExpired") includeExpired?: string,
  ): Promise<TenantQuotaRecord[]> {
    const tenantId = requireTenantId(req);
    const workspaceId = requireWorkspaceId(req);
    const params = new URLSearchParams({ tenantId });
    if (includeExpired !== undefined) {
      params.set("includeExpired", includeExpired);
    }

    return this.request<TenantQuotaRecord[]>(
      workspaceId,
      tenantId,
      `/capability/quotas?${params.toString()}`,
    );
  }

  @Get("usage-summaries")
  async listUsageSummaries(
    @Req() req: Request & RequestContext,
    @Query("applicationId") applicationId?: string,
    @Query("applicationType") applicationType?: string,
    @Query("cycleMonth") cycleMonth?: string,
    @Query("statType") statType?: string,
  ): Promise<TenantUsageSummaryRecord[]> {
    const tenantId = requireTenantId(req);
    const workspaceId = requireWorkspaceId(req);
    const params = new URLSearchParams({ tenantId });
    if (applicationId) params.set("applicationId", applicationId);
    if (applicationType) params.set("applicationType", applicationType);
    if (cycleMonth) params.set("cycleMonth", cycleMonth);
    if (statType) params.set("statType", statType);

    return this.request<TenantUsageSummaryRecord[]>(
      workspaceId,
      tenantId,
      `/capability/usage-summaries?${params.toString()}`,
    );
  }
}

// ── 守卫与代理 ───────────────────────────────────────────────────────────────

function requireTenantId(req: Request & RequestContext): string {
  if (!req.user) {
    throw new UnauthorizedException("No active session");
  }

  const tenantId = req.tenant?.id;
  if (!tenantId) {
    throw new ForbiddenException("Tenant context is required");
  }

  return tenantId;
}

/** The resolved workspace id (not the tenant/org id) — see the S2S claim note above. */
function requireWorkspaceId(req: Request & RequestContext): string {
  if (!req.user) {
    throw new UnauthorizedException("No active session");
  }

  const workspaceId = req.tenant?.workspace;
  if (!workspaceId) {
    throw new ForbiddenException("Tenant context is required");
  }

  return workspaceId;
}

async function modelPlatformRequest<TResponse>(
  path: string,
  baseUrl: string,
  bearer: string,
): Promise<TResponse> {
  let response: Response;

  try {
    response = await fetch(`${baseUrl}${path}`, {
      headers: { authorization: `Bearer ${bearer}` },
    });
  } catch {
    throw new BadGatewayException("Model Platform is unavailable");
  }

  const responseText = await response.text();

  if (!response.ok) {
    throw new HttpException(
      parseModelPlatformError(responseText, response.status),
      response.status,
    );
  }

  if (!responseText.trim()) {
    return undefined as TResponse;
  }

  return JSON.parse(responseText) as TResponse;
}

function parseModelPlatformError(
  responseText: string,
  status: number,
): ModelPlatformErrorBody {
  if (!responseText.trim()) {
    return {
      code: "MODEL_PLATFORM_REQUEST_FAILED",
      message: `Model Platform request failed with status ${status}`,
      statusCode: status,
    };
  }

  try {
    const parsed = JSON.parse(responseText) as ModelPlatformErrorBody;
    if (parsed.message !== undefined || parsed.code !== undefined) {
      return { ...parsed, statusCode: parsed.statusCode ?? status };
    }

    return {
      code: "MODEL_PLATFORM_REQUEST_FAILED",
      message: `Model Platform request failed with status ${status}`,
      statusCode: status,
      details: parsed,
    };
  } catch {
    return {
      code: "MODEL_PLATFORM_REQUEST_FAILED",
      message: responseText,
      statusCode: status,
    };
  }
}
