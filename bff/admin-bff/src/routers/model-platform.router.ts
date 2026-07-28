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

interface ModelPlatformErrorBody {
  code?: string;
  message?: string | string[];
  error?: string;
  statusCode?: number;
  details?: unknown;
}

/** Exchange audience for the model platform's management API (product_100 code). */
const MODEL_PLATFORM_AUDIENCE = "atlas";

@Controller("api/model-platform")
export class ModelPlatformRouter {
  private readonly modelPlatformUrl: string;

  constructor(
    @Inject(VxConfigService) configService: VxConfigService,
    @Inject(OperatorExchangeService)
    private readonly operatorExchange: OperatorExchangeService,
  ) {
    this.modelPlatformUrl =
      configService.platform.MODEL_PLATFORM_URL.trim().replace(/\/+$/, "");
  }

  /**
   * Proxy an admin call to the model platform, propagating the OPERATOR's
   * identity (product_250 M-1): the session's access token is exchanged for a
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
          MODEL_PLATFORM_AUDIENCE,
        )
      : null;
    return modelPlatformRequest<T>(
      path,
      { ...options, ...(bearer ? { bearer } : {}) },
      this.modelPlatformUrl,
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
      `/model-platform/admin/providers?includeInactive=${includeInactive === "false" ? "false" : "true"}`,
    );
  }

  @Post("providers")
  createProvider(
    @Req() req: Request & RequestContext,
    @Body() body: JsonObject,
  ): Promise<ModelProviderRecord> {
    assertCanManageModels(req);
    return this.request<ModelProviderRecord>(
      req,
      "/model-platform/admin/providers",
      {
        method: "POST",
        body,
      },
    );
  }

  @Put("providers/:providerId")
  updateProvider(
    @Req() req: Request & RequestContext,
    @Param("providerId") providerId: string,
    @Body() body: JsonObject,
  ): Promise<ModelProviderRecord> {
    assertCanManageModels(req);
    return this.request<ModelProviderRecord>(
      req,
      `/model-platform/admin/providers/${encodeURIComponent(providerId)}`,
      {
        method: "PUT",
        body,
      },
    );
  }

  @Post("providers/:providerId/activate")
  activateProvider(
    @Req() req: Request & RequestContext,
    @Param("providerId") providerId: string,
  ): Promise<ModelProviderRecord> {
    assertCanManageModels(req);
    return this.request<ModelProviderRecord>(
      req,
      `/model-platform/admin/providers/${encodeURIComponent(providerId)}/activate`,
      {
        method: "POST",
      },
    );
  }

  @Post("providers/:providerId/deactivate")
  deactivateProvider(
    @Req() req: Request & RequestContext,
    @Param("providerId") providerId: string,
  ): Promise<ModelProviderRecord> {
    assertCanManageModels(req);
    return this.request<ModelProviderRecord>(
      req,
      `/model-platform/admin/providers/${encodeURIComponent(providerId)}/deactivate`,
      {
        method: "POST",
      },
    );
  }

  @Delete("providers/:providerId")
  deleteProvider(
    @Req() req: Request & RequestContext,
    @Param("providerId") providerId: string,
  ): Promise<ModelProviderRecord> {
    assertCanManageModels(req);
    return this.request<ModelProviderRecord>(
      req,
      `/model-platform/admin/providers/${encodeURIComponent(providerId)}`,
      {
        method: "DELETE",
      },
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
      `/model-platform/admin/models?includeInactive=${includeInactive === "false" ? "false" : "true"}`,
    );
  }

  @Post("models")
  createModel(
    @Req() req: Request & RequestContext,
    @Body() body: JsonObject,
  ): Promise<AiModelRecord> {
    assertCanManageModels(req);
    return this.request<AiModelRecord>(req, "/model-platform/admin/models", {
      method: "POST",
      body,
    });
  }

  @Put("models/:modelId")
  updateModel(
    @Req() req: Request & RequestContext,
    @Param("modelId") modelId: string,
    @Body() body: JsonObject,
  ): Promise<AiModelRecord> {
    assertCanManageModels(req);
    return this.request<AiModelRecord>(
      req,
      `/model-platform/admin/models/${encodeURIComponent(modelId)}`,
      {
        method: "PUT",
        body,
      },
    );
  }

  @Post("models/:modelId/activate")
  activateModel(
    @Req() req: Request & RequestContext,
    @Param("modelId") modelId: string,
  ): Promise<AiModelRecord> {
    assertCanManageModels(req);
    return this.request<AiModelRecord>(
      req,
      `/model-platform/admin/models/${encodeURIComponent(modelId)}/activate`,
      {
        method: "POST",
      },
    );
  }

  @Post("models/:modelId/deactivate")
  deactivateModel(
    @Req() req: Request & RequestContext,
    @Param("modelId") modelId: string,
  ): Promise<AiModelRecord> {
    assertCanManageModels(req);
    return this.request<AiModelRecord>(
      req,
      `/model-platform/admin/models/${encodeURIComponent(modelId)}/deactivate`,
      {
        method: "POST",
      },
    );
  }

  @Delete("models/:modelId")
  deleteModel(
    @Req() req: Request & RequestContext,
    @Param("modelId") modelId: string,
  ): Promise<AiModelRecord> {
    assertCanManageModels(req);
    return this.request<AiModelRecord>(
      req,
      `/model-platform/admin/models/${encodeURIComponent(modelId)}`,
      {
        method: "DELETE",
      },
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
      `/model-platform/admin/grants${params.size ? `?${params.toString()}` : ""}`,
    );
  }

  @Post("grants")
  createGrant(
    @Req() req: Request & RequestContext,
    @Body() body: JsonObject,
  ): Promise<AiModelGrantRecord> {
    assertCanManageModels(req);
    return this.request<AiModelGrantRecord>(
      req,
      "/model-platform/admin/grants",
      {
        method: "POST",
        body,
      },
    );
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
      `/model-platform/admin/grants/${encodeURIComponent(grantId)}`,
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
      `/model-platform/admin/grants/${encodeURIComponent(grantId)}/activate`,
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
      `/model-platform/admin/grants/${encodeURIComponent(grantId)}`,
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
      `/model-platform/admin/price-rules${params.size ? `?${params.toString()}` : ""}`,
    );
  }

  @Post("price-rules")
  createPriceRule(
    @Req() req: Request & RequestContext,
    @Body() body: JsonObject,
  ): Promise<ModelPriceRuleRecord> {
    assertCanManageModels(req);
    return this.request<ModelPriceRuleRecord>(
      req,
      "/model-platform/admin/price-rules",
      {
        method: "POST",
        body,
      },
    );
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
      `/model-platform/admin/price-rules/${encodeURIComponent(priceRuleId)}`,
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
      `/model-platform/admin/price-rules/${encodeURIComponent(priceRuleId)}/activate`,
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
      `/model-platform/admin/price-rules/${encodeURIComponent(priceRuleId)}/deactivate`,
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
      `/model-platform/admin/policies${params.size ? `?${params.toString()}` : ""}`,
    );
  }

  @Post("policies")
  createPolicy(
    @Req() req: Request & RequestContext,
    @Body() body: JsonObject,
  ): Promise<ModelPolicyRecord> {
    assertCanManageModels(req);
    return this.request<ModelPolicyRecord>(
      req,
      "/model-platform/admin/policies",
      {
        method: "POST",
        body,
      },
    );
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
      `/model-platform/admin/policies/${encodeURIComponent(policyId)}`,
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
      `/model-platform/admin/policies/${encodeURIComponent(policyId)}/activate`,
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
      `/model-platform/admin/policies/${encodeURIComponent(policyId)}/deactivate`,
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
      `/model-platform/admin/quotas${params.size ? `?${params.toString()}` : ""}`,
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
      `/model-platform/admin/usage-summaries${params.size ? `?${params.toString()}` : ""}`,
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

async function modelPlatformRequest<TResponse>(
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
