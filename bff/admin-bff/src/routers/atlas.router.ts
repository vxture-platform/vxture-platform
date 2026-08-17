import {
  BadGatewayException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { VxConfigService } from "@vxture/core-config";
import { OperatorExchangeService } from "../auth/operator-exchange.service";

/**
 * Path prefix for atlas's capability-plane surface (provider/model/grant
 * registry, price rules, policies, quotas, usage summaries). Renamed from
 * `/model-platform/admin/*` to `/capability/*` on atlas's side (TD-013);
 * see `vxture-atlas/docs/20-specs/10-http-surface.md` for the authoritative
 * current-state table. `ATLAS_API_URL` already points at the external
 * atlas host — the old `services/model/platform` in-repo backing service is
 * retired (product_250 M-4 line, 2026-07-28).
 *
 * 2026-07-29(命名收尾):本文件此前叫 `model-platform.router.ts`,沿用已退役
 * 服务的旧称;改回真实身份——路由前缀 `/api/model-platform/*` → `/api/atlas/*`,
 * 类型/函数名同步(`ATLAS_AUDIENCE` 常量此前只有 console-bff 一侧改过,两边现已
 * 一致)。
 *
 * 2026-08-11(技术面迁 opera):provider / model 的生命周期管理(创建/编辑/启停/
 * 删除)迁去 opera-bff 自己的 atlas.router.ts——"两段裁决"里 opera 管技术供给、
 * admin 管商业封装(product_100_matrix.md),provider/model 生命周期属前者。这里
 * 只留 GET providers / GET models 只读代理,给本文件仍在管的商业层(grants /
 * price-rules / policies / quotas)当模型下拉的数据源——它们创建价格规则、策略
 * 时要引用具体的 provider/model。opera-bff 那份是独立实现,不 import 这里任何
 * 东西,两个 *-bff 之间零交叉引用是明确纪律。
 */

import type {
  AiModelGrantRecord,
  AiModelRecord,
  ModelPolicyRecord,
  ModelPriceRuleRecord,
  ModelProviderRecord,
  RequestContext,
  TenantQuotaRecord,
  TenantUsageSummaryRecord,
} from "../types/console.types";

type JsonObject = Record<string, unknown>;

interface AtlasErrorBody {
  code?: string;
  message?: string | string[];
  error?: string;
  statusCode?: number;
  details?: unknown;
}

/** Exchange audience for atlas's management API (product_100 code). */
const ATLAS_AUDIENCE = "atlas";

@Controller("api/atlas")
export class AtlasRouter {
  private readonly atlasApiUrl: string;

  constructor(
    @Inject(VxConfigService) configService: VxConfigService,
    @Inject(OperatorExchangeService)
    private readonly operatorExchange: OperatorExchangeService,
  ) {
    this.atlasApiUrl = configService.platform.ATLAS_API_URL.trim().replace(
      /\/+$/,
      "",
    );
  }

  /**
   * Proxy an admin call to atlas, propagating the OPERATOR's identity
   * (product_250 M-1): the session's access token is exchanged for a
   * short-lived aud=atlas management token and forwarded as the bearer. The
   * BFF never calls the provider with its own identity. During the transition
   * (provider not yet verifying) a failed exchange degrades to an
   * unauthenticated upstream call instead of blocking the page.
   */
  private async request<T>(
    req: Request & RequestContext,
    path: string,
    options?: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: JsonObject },
  ): Promise<T> {
    const bearer = req.operatorAccessToken
      ? await this.operatorExchange.getToken(
          req.operatorAccessToken,
          ATLAS_AUDIENCE,
        )
      : null;
    return atlasRequest<T>(
      path,
      { ...options, ...(bearer ? { bearer } : {}) },
      this.atlasApiUrl,
    );
  }

  @Get("providers")
  listProviders(
    @Req() req: Request & RequestContext,
    @Query("includeInactive") includeInactive?: string,
  ): Promise<ModelProviderRecord[]> {
    assertCanManageModels(req);
    return this.request<ModelProviderRecord[]>(
      req,
      `/capability/providers?includeInactive=${includeInactive === "false" ? "false" : "true"}`,
    );
  }

  @Get("models")
  listModels(
    @Req() req: Request & RequestContext,
    @Query("includeInactive") includeInactive?: string,
  ): Promise<AiModelRecord[]> {
    assertCanManageModels(req);
    return this.request<AiModelRecord[]>(
      req,
      `/capability/models?includeInactive=${includeInactive === "false" ? "false" : "true"}`,
    );
  }

  @Get("grants")
  listGrants(
    @Req() req: Request & RequestContext,
    @Query("tenantId") tenantId?: string,
    @Query("modelId") modelId?: string,
    @Query("applicationId") applicationId?: string,
    @Query("applicationType") applicationType?: string,
  ): Promise<AiModelGrantRecord[]> {
    assertCanManageModels(req);

    const params = new URLSearchParams();
    if (tenantId) params.set("tenantId", tenantId);
    if (modelId) params.set("modelId", modelId);
    if (applicationId) params.set("applicationId", applicationId);
    if (applicationType) params.set("applicationType", applicationType);

    return this.request<AiModelGrantRecord[]>(
      req,
      `/capability/grants${params.size ? `?${params.toString()}` : ""}`,
    );
  }

  @Post("grants")
  createGrant(
    @Req() req: Request & RequestContext,
    @Body() body: JsonObject,
  ): Promise<AiModelGrantRecord> {
    assertCanManageModels(req);
    return this.request<AiModelGrantRecord>(req, "/capability/grants", {
      method: "POST",
      body,
    });
  }

  @Put("grants/:grantId")
  updateGrant(
    @Req() req: Request & RequestContext,
    @Param("grantId") grantId: string,
    @Body() body: JsonObject,
  ): Promise<AiModelGrantRecord> {
    assertCanManageModels(req);
    return this.request<AiModelGrantRecord>(
      req,
      `/capability/grants/${encodeURIComponent(grantId)}`,
      {
        method: "PUT",
        body,
      },
    );
  }

  @Post("grants/:grantId/activate")
  activateGrant(
    @Req() req: Request & RequestContext,
    @Param("grantId") grantId: string,
  ): Promise<AiModelGrantRecord> {
    assertCanManageModels(req);
    return this.request<AiModelGrantRecord>(
      req,
      `/capability/grants/${encodeURIComponent(grantId)}/activate`,
      {
        method: "POST",
      },
    );
  }

  @Delete("grants/:grantId")
  deactivateGrant(
    @Req() req: Request & RequestContext,
    @Param("grantId") grantId: string,
  ): Promise<AiModelGrantRecord> {
    assertCanManageModels(req);
    return this.request<AiModelGrantRecord>(
      req,
      `/capability/grants/${encodeURIComponent(grantId)}`,
      {
        method: "DELETE",
      },
    );
  }

  @Get("price-rules")
  listPriceRules(
    @Req() req: Request & RequestContext,
    @Query("modelId") modelId?: string,
    @Query("includeInactive") includeInactive?: string,
  ): Promise<ModelPriceRuleRecord[]> {
    assertCanManageModels(req);
    const params = new URLSearchParams();
    if (modelId) params.set("modelId", modelId);
    if (includeInactive !== undefined) {
      params.set("includeInactive", includeInactive);
    }
    return this.request<ModelPriceRuleRecord[]>(
      req,
      `/capability/price-rules${params.size ? `?${params.toString()}` : ""}`,
    );
  }

  @Post("price-rules")
  createPriceRule(
    @Req() req: Request & RequestContext,
    @Body() body: JsonObject,
  ): Promise<ModelPriceRuleRecord> {
    assertCanManageModels(req);
    return this.request<ModelPriceRuleRecord>(req, "/capability/price-rules", {
      method: "POST",
      body,
    });
  }

  @Put("price-rules/:priceRuleId")
  updatePriceRule(
    @Req() req: Request & RequestContext,
    @Param("priceRuleId") priceRuleId: string,
    @Body() body: JsonObject,
  ): Promise<ModelPriceRuleRecord> {
    assertCanManageModels(req);
    return this.request<ModelPriceRuleRecord>(
      req,
      `/capability/price-rules/${encodeURIComponent(priceRuleId)}`,
      {
        method: "PUT",
        body,
      },
    );
  }

  @Post("price-rules/:priceRuleId/activate")
  activatePriceRule(
    @Req() req: Request & RequestContext,
    @Param("priceRuleId") priceRuleId: string,
  ): Promise<ModelPriceRuleRecord> {
    assertCanManageModels(req);
    return this.request<ModelPriceRuleRecord>(
      req,
      `/capability/price-rules/${encodeURIComponent(priceRuleId)}/activate`,
      {
        method: "POST",
      },
    );
  }

  @Post("price-rules/:priceRuleId/deactivate")
  deactivatePriceRule(
    @Req() req: Request & RequestContext,
    @Param("priceRuleId") priceRuleId: string,
  ): Promise<ModelPriceRuleRecord> {
    assertCanManageModels(req);
    return this.request<ModelPriceRuleRecord>(
      req,
      `/capability/price-rules/${encodeURIComponent(priceRuleId)}/deactivate`,
      {
        method: "POST",
      },
    );
  }

  @Get("policies")
  listPolicies(
    @Req() req: Request & RequestContext,
    @Query("tenantId") tenantId?: string,
    @Query("modelId") modelId?: string,
    @Query("includeInactive") includeInactive?: string,
  ): Promise<ModelPolicyRecord[]> {
    assertCanManageModels(req);
    const params = new URLSearchParams();
    if (tenantId) params.set("tenantId", tenantId);
    if (modelId) params.set("modelId", modelId);
    if (includeInactive !== undefined) {
      params.set("includeInactive", includeInactive);
    }
    return this.request<ModelPolicyRecord[]>(
      req,
      `/capability/policies${params.size ? `?${params.toString()}` : ""}`,
    );
  }

  @Post("policies")
  createPolicy(
    @Req() req: Request & RequestContext,
    @Body() body: JsonObject,
  ): Promise<ModelPolicyRecord> {
    assertCanManageModels(req);
    return this.request<ModelPolicyRecord>(req, "/capability/policies", {
      method: "POST",
      body,
    });
  }

  @Put("policies/:policyId")
  updatePolicy(
    @Req() req: Request & RequestContext,
    @Param("policyId") policyId: string,
    @Body() body: JsonObject,
  ): Promise<ModelPolicyRecord> {
    assertCanManageModels(req);
    return this.request<ModelPolicyRecord>(
      req,
      `/capability/policies/${encodeURIComponent(policyId)}`,
      {
        method: "PUT",
        body,
      },
    );
  }

  @Post("policies/:policyId/activate")
  activatePolicy(
    @Req() req: Request & RequestContext,
    @Param("policyId") policyId: string,
  ): Promise<ModelPolicyRecord> {
    assertCanManageModels(req);
    return this.request<ModelPolicyRecord>(
      req,
      `/capability/policies/${encodeURIComponent(policyId)}/activate`,
      {
        method: "POST",
      },
    );
  }

  @Post("policies/:policyId/deactivate")
  deactivatePolicy(
    @Req() req: Request & RequestContext,
    @Param("policyId") policyId: string,
  ): Promise<ModelPolicyRecord> {
    assertCanManageModels(req);
    return this.request<ModelPolicyRecord>(
      req,
      `/capability/policies/${encodeURIComponent(policyId)}/deactivate`,
      {
        method: "POST",
      },
    );
  }

  @Get("quotas")
  listTenantQuotas(
    @Req() req: Request & RequestContext,
    @Query("tenantId") tenantId?: string,
    @Query("includeExpired") includeExpired?: string,
  ): Promise<TenantQuotaRecord[]> {
    assertCanManageModels(req);
    const params = new URLSearchParams();
    if (tenantId) params.set("tenantId", tenantId);
    if (includeExpired !== undefined) {
      params.set("includeExpired", includeExpired);
    }
    return this.request<TenantQuotaRecord[]>(
      req,
      `/capability/quotas${params.size ? `?${params.toString()}` : ""}`,
    );
  }

  @Get("usage-summaries")
  listUsageSummaries(
    @Req() req: Request & RequestContext,
    @Query("tenantId") tenantId?: string,
    @Query("applicationId") applicationId?: string,
    @Query("applicationType") applicationType?: string,
    @Query("cycleMonth") cycleMonth?: string,
    @Query("statType") statType?: string,
  ): Promise<TenantUsageSummaryRecord[]> {
    assertCanManageModels(req);
    const params = new URLSearchParams();
    if (tenantId) params.set("tenantId", tenantId);
    if (applicationId) params.set("applicationId", applicationId);
    if (applicationType) params.set("applicationType", applicationType);
    if (cycleMonth) params.set("cycleMonth", cycleMonth);
    if (statType) params.set("statType", statType);
    return this.request<TenantUsageSummaryRecord[]>(
      req,
      `/capability/usage-summaries${params.size ? `?${params.toString()}` : ""}`,
    );
  }
}

function assertCanManageModels(req: Request & RequestContext): void {
  if (!req.user) {
    throw new UnauthorizedException("No active session");
  }

  if (!req.capabilities?.includes("platform.model.manage")) {
    throw new ForbiddenException("Missing platform.model.manage capability");
  }
}

async function atlasRequest<TResponse>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: JsonObject;
    /** Operator-OBO management token (product_250 M-1), forwarded verbatim. */
    bearer?: string;
  } = {},
  baseUrl: string = "http://localhost:3100",
): Promise<TResponse> {
  let response: Response;

  const headers: Record<string, string> = {
    ...(options.body ? { "content-type": "application/json" } : {}),
    ...(options.bearer ? { authorization: `Bearer ${options.bearer}` } : {}),
  };
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw new BadGatewayException("Atlas is unavailable");
  }

  const responseText = await response.text();

  if (!response.ok) {
    throw new HttpException(
      parseAtlasError(responseText, response.status),
      response.status,
    );
  }

  if (!responseText.trim()) {
    return undefined as TResponse;
  }

  return JSON.parse(responseText) as TResponse;
}

function parseAtlasError(responseText: string, status: number): AtlasErrorBody {
  if (!responseText.trim()) {
    return {
      code: "ATLAS_REQUEST_FAILED",
      message: `Atlas request failed with status ${status}`,
      statusCode: status,
    };
  }

  try {
    const parsed = JSON.parse(responseText) as AtlasErrorBody;
    if (parsed.message !== undefined || parsed.code !== undefined) {
      return { ...parsed, statusCode: parsed.statusCode ?? status };
    }

    return {
      code: "ATLAS_REQUEST_FAILED",
      message: `Atlas request failed with status ${status}`,
      statusCode: status,
      details: parsed,
    };
  } catch {
    return {
      code: "ATLAS_REQUEST_FAILED",
      message: responseText,
      statusCode: status,
    };
  }
}
