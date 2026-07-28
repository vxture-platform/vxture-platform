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

import type {
  AiModelGrantRecord,
  AiModelRecord,
  RequestContext,
  TenantQuotaRecord,
  TenantUsageSummaryRecord,
} from "../types/console.types";

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

  constructor(@Inject(VxConfigService) configService: VxConfigService) {
    this.modelPlatformUrl =
      configService.platform.MODEL_PLATFORM_URL.trim().replace(/\/+$/, "");
  }

  @Get("models")
  async listModels(
    @Req() req: Request & RequestContext,
  ): Promise<AiModelRecord[]> {
    const tenantId = requireTenantId(req);
    const [models, grants] = await Promise.all([
      modelPlatformRequest<AiModelRecord[]>(
        "/capability/models?includeInactive=false",
        this.modelPlatformUrl,
      ),
      modelPlatformRequest<AiModelGrantRecord[]>(
        `/capability/grants?tenantId=${encodeURIComponent(tenantId)}`,
        this.modelPlatformUrl,
      ),
    ]);

    const grantedModelIds = new Set(
      grants.filter((grant) => grant.isActive).map((grant) => grant.modelId),
    );

    return models.filter((model) => grantedModelIds.has(model.id));
  }

  @Get("grants")
  listGrants(
    @Req() req: Request & RequestContext,
    @Query("modelId") modelId?: string,
    @Query("applicationId") applicationId?: string,
    @Query("applicationType") applicationType?: string,
  ): Promise<AiModelGrantRecord[]> {
    const tenantId = requireTenantId(req);
    const params = new URLSearchParams({ tenantId });
    if (modelId) params.set("modelId", modelId);
    if (applicationId) params.set("applicationId", applicationId);
    if (applicationType) params.set("applicationType", applicationType);

    return modelPlatformRequest<AiModelGrantRecord[]>(
      `/capability/grants?${params.toString()}`,
      this.modelPlatformUrl,
    );
  }

  @Get("quotas")
  listQuotas(
    @Req() req: Request & RequestContext,
    @Query("includeExpired") includeExpired?: string,
  ): Promise<TenantQuotaRecord[]> {
    const tenantId = requireTenantId(req);
    const params = new URLSearchParams({ tenantId });
    if (includeExpired !== undefined) {
      params.set("includeExpired", includeExpired);
    }

    return modelPlatformRequest<TenantQuotaRecord[]>(
      `/capability/quotas?${params.toString()}`,
      this.modelPlatformUrl,
    );
  }

  @Get("usage-summaries")
  listUsageSummaries(
    @Req() req: Request & RequestContext,
    @Query("applicationId") applicationId?: string,
    @Query("applicationType") applicationType?: string,
    @Query("cycleMonth") cycleMonth?: string,
    @Query("statType") statType?: string,
  ): Promise<TenantUsageSummaryRecord[]> {
    const tenantId = requireTenantId(req);
    const params = new URLSearchParams({ tenantId });
    if (applicationId) params.set("applicationId", applicationId);
    if (applicationType) params.set("applicationType", applicationType);
    if (cycleMonth) params.set("cycleMonth", cycleMonth);
    if (statType) params.set("statType", statType);

    return modelPlatformRequest<TenantUsageSummaryRecord[]>(
      `/capability/usage-summaries?${params.toString()}`,
      this.modelPlatformUrl,
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

async function modelPlatformRequest<TResponse>(
  path: string,
  baseUrl: string,
): Promise<TResponse> {
  let response: Response;

  try {
    response = await fetch(`${baseUrl}${path}`);
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
