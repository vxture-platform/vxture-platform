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
import { assertAtlasContract, type AtlasResource } from "./atlas-contract";

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
 *
 * 2026-08-23(上游路径改名 product_251 X-4,vxture-atlas#206):atlas 把三个含糊的
 * 资源名改成了说清「授的是什么、路由的是什么」的名字。本文件用到的那个是
 * `grants` → `tenant-model-grants`(租户 × 模型轴);另两个 `endpoints` →
 * `model-routes`、`product-grants` → `product-endpoint-grants` 归 opera-bff,
 * 同日一起改的。
 *
 * 旧名仍在服务,但带 `Deprecation: true` + `Sunset: 2026-09-16` 响应头,并计入
 * `capability_legacy_path_requests_total{path,operator}`——**那个计数器就是删除旧名
 * 的闸门**(`capability-route-names.ts`:日期是地板,归零才是触发条件)。继续打旧名
 * 有两个后果:到期日那天这几条路由变 404,且在此之前**让计数器永远归不了零**,
 * 等于我们自己把上游的清理挡住。
 *
 * **本层对外路径一行不动**(`/api/atlas/grants`),页面不受影响——把上游改名吸收在
 * 适配层正是它存在的理由。审计也不受影响:atlas 的 `canonicalCapabilitySegment()`
 * 本来就把旧名折回新名再落库,所以改之前落的行记的已经是 `tenant-model-grants`。
 *
 * 2026-08-23(同批,契约复核):这一侧的 atlas 契约漂得比 opera 还远,三类都修了。
 *
 * 1. **出站方法 PUT → PATCH。** grants / price-rules / policies 三条更新路由在 atlas 上
 *    只注册了 `@Patch`,发 PUT **实测 404**(直连 atlas 逐方法探:PATCH 401=路由在、
 *    PUT 404=没有)。也就是说 admin 上「编辑一条授权 / 价格规则 / 策略」此前全线是 404。
 *    **对外仍是 `@Put`**——门户那侧的语义没变,把上游的方法差异吸收在适配层,同上一条。
 *
 * 2. **`isActive` → `state`,两处形状整体换代。** 六个记录全都还声明着 `isActive`,而
 *    atlas 早已改发 `state`(product_251 M-B3);`ModelPolicyRecord` 与
 *    `TenantQuotaRecord` 更是整个形状都是上游不再返回的旧版。类型只是注解、
 *    `atlasRequest<T>()` 只做断言不做校验,所以这些漂移**一个都不报错**——页面读到
 *    `undefined`,把「生效中」渲染成「停用」、把计数渲染成 0。
 *
 * 3. **写入侧的静默忽略。** create body 收的是 `state` 不是 `isActive`;update body
 *    **根本没有状态字段**(启停只走具名 activate/deactivate,理由是审计要能按
 *    `?action=deactivate` 检索得到)。此前两处都在发 `isActive`,被上游静默丢掉。
 *
 * 新增 `atlas-contract.ts`:列表读出口断言必有字段,缺了直接 502 并点名。它防的正是
 * 第 2 类——**让契约漂移在入口响一声,而不是在界面上安静地错着**。
 */

import type {
  AiModelGrantRecord,
  AiModelRecord,
  ModelPolicyRecord,
  ModelPriceRuleRecord,
  ModelProviderRecord,
  RequestContext,
  TenantQuotaRecord,
  UsageSummaryPage,
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
    options?: {
      method?: "GET" | "POST" | "PATCH" | "DELETE";
      body?: JsonObject;
      /** 只在**列表读**上给：带上它就在出口校验必有字段。见 `atlas-contract.ts`。 */
      contract?: AtlasResource;
    },
  ): Promise<T> {
    const bearer = req.operatorAccessToken
      ? await this.operatorExchange.getToken(
          req.operatorAccessToken,
          ATLAS_AUDIENCE,
        )
      : null;
    const payload = await atlasRequest<T>(
      path,
      { ...options, ...(bearer ? { bearer } : {}) },
      this.atlasApiUrl,
    );
    return options?.contract
      ? assertAtlasContract(payload, options.contract)
      : payload;
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
      { contract: "providers" },
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
      { contract: "models" },
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
      `/capability/tenant-model-grants${params.size ? `?${params.toString()}` : ""}`,
      { contract: "tenant-model-grants" },
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
      "/capability/tenant-model-grants",
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
      `/capability/tenant-model-grants/${encodeURIComponent(grantId)}`,
      {
        method: "PATCH",
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
      `/capability/tenant-model-grants/${encodeURIComponent(grantId)}/activate`,
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
      `/capability/tenant-model-grants/${encodeURIComponent(grantId)}`,
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
      { contract: "price-rules" },
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
        method: "PATCH",
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
      { contract: "policies" },
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
        method: "PATCH",
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
      { contract: "quotas" },
    );
  }

  @Get("usage-summaries")
  listUsageSummaries(
    @Req() req: Request & RequestContext,
    @Query("tenantId") tenantId?: string,
    @Query("applicationId") applicationId?: string,
    @Query("applicationType") applicationType?: string,
    @Query("cycleMonth") cycleMonth?: string,
    @Query("groupBy") groupBy?: string,
  ): Promise<UsageSummaryPage> {
    assertCanManageModels(req);
    const params = new URLSearchParams();
    if (tenantId) params.set("tenantId", tenantId);
    if (applicationId) params.set("applicationId", applicationId);
    if (applicationType) params.set("applicationType", applicationType);
    if (cycleMonth) params.set("cycleMonth", cycleMonth);
    /* `statType` 曾在这里透传给上游——**atlas 的白名单里没有这个参数**，而 atlas 的
       `rejectUnknownFilters` 是拒绝不是忽略，所以页面一旦真送它就是一个 400。
       换成 `groupBy`，那是这个端点真正支持的轴选择。 */
    if (groupBy) params.set("groupBy", groupBy);
    return this.request<UsageSummaryPage>(
      req,
      `/capability/usage-summaries${params.size ? `?${params.toString()}` : ""}`,
      { contract: "usage-summaries" },
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
    /**
     * **改是 PATCH，不是 PUT。** atlas 的三条更新路由（`tenant-model-grants` /
     * `price-rules` / `policies`）只注册了 `@Patch`，PUT **实测 404**
     * （2026-08-23 直连 atlas 逐方法探过：PATCH 401=路由在、PUT 404=没有）。
     * 此前这里发 PUT，于是 admin 上「编辑一条授权 / 价格规则 / 策略」全线是 404。
     */
    method?: "GET" | "POST" | "PATCH" | "DELETE";
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
