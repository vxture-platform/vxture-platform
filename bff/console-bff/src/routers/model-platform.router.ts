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
 * 2026-07-28(全量切换 `/tenancy/*`,TD-043 收尾,回应 atlas v0.1.14):atlas 先后交付
 * `vxture-atlas`#70(models+usage)和 #74(grants+quotas),补齐了本路由全部四个方法的
 * `/tenancy/*` 对应物——这是 atlas 落地 `#52`(把 `/capability/*` 锁死为纯
 * `mgmt:atlas`,拒收 `tool:atlas`)的前置条件,故这四个方法必须一次性全切完,不能留
 * 半只脚在旧命名空间(否则 #52 一上线就是这一半 401)。四个端点里三个响应形状发生了
 * 实质变化,不是纯换 URL:
 * - `models`:`/tenancy/models` 内部已做 grant 过滤,原先"查 models 再查 grants 取
 *   交集"的两次往返收敛成一次(已在 PR#174 切完)。
 * - `grants`:`/tenancy/grants` 不再投影 `reason`(运营内部理由,不该出现在租户面)和
 *   `tenantId`(scope 已经是 token 决定的,不需要调用方再报一次)。
 * - `quotas`:**不再是数组**,改成单个信封 `TenancyQuotaResponse`(`tier`/`bundled`/
 *   `limits`/`pools[]`/`status`)。atlas 读的是平台自己的 C2 entitlement,不是 atlas
 *   拆库遗留的恒空 stub(`tenant_subscription_quotas`,TD-005)——`status` 三分
 *   `covered`/`uncovered`/`unavailable`,把"没订阅套餐"和"平台连不上"区分开,旧 stub
 *   两种情况都只能返回 `[]`,前端无从区分。
 * - `usage-summaries` → `usage`:**不再是计费口径**,改成单个信封
 *   `TenancyUsageResponse`(`rows[]` 按 model/provider 聚合 request/token 计数),数据
 *   来自 atlas 自己的 `reqlog`("实际跑了什么"),不是平台的 `usage_events`(计费依据)。
 *   没有 `cycleMonth`/`totalCostAmount`/`currency`——这些字段在新模型里不存在,不是
 *   传漏了。
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
  TenancyQuotaResponse,
  TenancyUsageResponse,
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

  /** `/tenancy/grants` scopes to this workspace's own token — no caller-supplied filters accepted. */
  @Get("grants")
  async listGrants(
    @Req() req: Request & RequestContext,
  ): Promise<AiModelGrantRecord[]> {
    const tenantId = requireTenantId(req);
    const workspaceId = requireWorkspaceId(req);
    return this.request<AiModelGrantRecord[]>(
      workspaceId,
      tenantId,
      "/tenancy/grants",
    );
  }

  /** Single entitlement envelope, not a list — see the `status` field for coverage vs reachability. */
  @Get("quotas")
  async quotas(
    @Req() req: Request & RequestContext,
  ): Promise<TenancyQuotaResponse> {
    const tenantId = requireTenantId(req);
    const workspaceId = requireWorkspaceId(req);
    return this.request<TenancyQuotaResponse>(
      workspaceId,
      tenantId,
      "/tenancy/quotas",
    );
  }

  /** Atlas's own request-log usage, not a billing figure — see `TenancyUsageResponse`. */
  @Get("usage")
  async usage(
    @Req() req: Request & RequestContext,
    @Query("scope") scope?: string,
    @Query("days") days?: string,
  ): Promise<TenancyUsageResponse> {
    const tenantId = requireTenantId(req);
    const workspaceId = requireWorkspaceId(req);
    const params = new URLSearchParams();
    if (scope) params.set("scope", scope);
    if (days) params.set("days", days);
    const query = params.size ? `?${params.toString()}` : "";
    return this.request<TenancyUsageResponse>(
      workspaceId,
      tenantId,
      `/tenancy/usage${query}`,
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
