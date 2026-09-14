/**
 * runos.router.ts — Runos 能力目录的**只读**代理（admin「技能市场」的数据源）。
 * @package @vxture/bff-admin
 * @layer Application
 * @category Router
 *
 * ## 为什么 admin 也读 Runos
 *
 * admin 的「技能市场」（`/skills`）此前是个空桩：`skills.router.ts` 返回字面量 `[]`
 * 并注释「数据层待接入」，页面渲染一个诚实的空态和一排禁用按钮。而技能 / 能力的
 * 真实注册表一直在 Runos（`/capability/*`），opera 早已代理并管理它。
 *
 * owner 2026-08-30 裁定：**admin 得到 Runos 能力目录的只读视图；管理留在 opera
 * 「能力注册」**。依据仍是 product_100 §3 的"两段裁决"——opera 管技术供给、admin 管
 * 商业封装；能力的注册 / 晋升 / 退役 / 认证属前者，admin 只需要看得见目录（给运营
 * 回答"平台现在有哪些能力"），不需要改得动。所以本文件只有 `GET`，且**刻意不留
 * 写路由的骨架**——想加的时候先读 `runos-contract.ts` 头部那条纪律。
 *
 * ## 机制
 *
 * 与 `atlas.router.ts` 完全同构：数据源单一权威 = Runos 的 `/capability/*` HTTP 面
 * （`RUNOS_API_URL`，外部主机；`vxture-runos service/src/registry/registry.controller.ts`
 * 是权威契约，仓内不存副本）。认证 = operator-OBO（product_250 M-1）：把 operator
 * 会话 access token 换成 aud=runos 的短时管理令牌再转发，BFF 从不以自己的身份调
 * 上游。opera-bff 那份 `runos.router.ts` 是独立实现，不 import 这里任何东西，两个
 * `*-bff` 之间零交叉引用是明确纪律。
 *
 * 能力码 `product:capability.read`（2026-09-14 三平台拆分）。此前复用 opera 的
 * `capability:runos.read` / `.manage`——在 opera 授权会顺带打开 admin 的目录页，反之
 * 亦然。三个平台严格隔离：可以重复，不能耦合，所以 admin 有自己的码。
 *
 * ## 配置
 *
 * - `RUNOS_API_URL`：平台 schema 已有（opera-bff 在读），默认 `localhost:3120`。
 *   **生产必须显式配**——容器里没有这个服务，落回默认值等于 `/api/runos/*` 全部 502
 *   （同 `.env.admin-bff.example` 里 ATLAS_API_URL 那条注释记下的病）。

 *
 * ## 只读列表的查询参数
 *
 * 原样透传 Runos `list` 支持的两个：`?category=` 精确匹配；`?tag=` **可重复，且是
 * 全部命中（AND）**——透传时必须保留重复参数，用 append 而不是 set。别的参数一律
 * 不透传：Runos 的目录读没有分页与关键字检索（`registry.repository.ts` 就是一句
 * `findMany`），页面在前端过滤。
 */

import {
  BadGatewayException,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  Inject,
  Param,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { VxConfigService } from "@vxture/core-config";
import { OperatorExchangeService } from "../auth/operator-exchange.service";
import type { RequestContext } from "../types/console.types";
import { assertRunosContract, type RunosResource } from "./runos-contract";

/** 换票时的目标 audience（对齐 product_100 的产品码）。 */
const RUNOS_AUDIENCE = "runos";
/** admin 自己的目录读码（见文件头）。 */
const CATALOG_READ = "product:capability.read";

interface RunosErrorBody {
  code?: string;
  message?: string | string[];
  error?: string;
  statusCode?: number;
  details?: unknown;
}

// ─── 上游记录形状（逐字段照 runos prisma schema，2026-08-30 核过）────────────

export interface CapabilityRecord {
  capabilityId: string;
  /** `connector` / `executor` / `skill`（asset 上游仍拒绝）。 */
  primitiveType: string;
  providerId: string;
  ownerRef: string;
  title: string;
  /**
   * 面向最终用户的名字，**按 locale 分键**（`{"zh-CN": "…", "en": "…"}`）。库里默认
   * `{}`，不是 null。**是呈现不是身份**：`capabilityId` 才是行标识。
   */
  displayName?: Record<string, string>;
  /** `experimental` / `certified` / `official`。 */
  admissionTier: string;
  /** 15 选 1，v0.5.0 起必填。 */
  category?: string;
  /** 0..8 个，`^[a-z0-9][a-z0-9-]{1,31}$`。 */
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * 目录列表的一页（runos v0.26.0 起的游标信封，契约见 `runos-contract.ts`）。
 * 此前这条路由声明回 `CapabilityRecord[]`，而契约早已按信封校验——类型说一套、
 * 线上是另一套，admin 能力目录页按数组读，拿到信封就崩。
 */
export interface CapabilityPage {
  items: CapabilityRecord[];
  nextCursor: string | null;
  prevCursor: string | null;
  total: number;
}

export interface CapabilityVersionRecord {
  capabilityId: string;
  version: string;
  state: string;
  contract: Record<string, unknown>;
  contentDigest: string;
  createdAt: string;
}

export interface CapabilityAliasRecord {
  capabilityId: string;
  alias: string;
  version: string;
  updatedAt: string;
}

export interface EndpointInstanceRecord {
  id: string;
  capabilityId: string;
  version: string;
  environment: string;
  baseUrl: string;
  /** runos v0.8.0 起由 `status` 改名（B-3）。 */
  state: string;
  createdAt: string;
}

export interface CapabilityDetailRecord extends CapabilityRecord {
  versions: CapabilityVersionRecord[];
  aliases: CapabilityAliasRecord[];
  endpoints: EndpointInstanceRecord[];
}

@Controller("api/runos")
export class RunosRouter {
  private readonly runosApiUrl: string;

  constructor(
    @Inject(VxConfigService) configService: VxConfigService,
    @Inject(OperatorExchangeService)
    private readonly operatorExchange: OperatorExchangeService,
  ) {
    this.runosApiUrl = trimBase(configService.platform.RUNOS_API_URL);
  }

  /**
   * 以 OPERATOR 的身份代理一次读（product_250 M-1）：会话 access token 换成 aud=runos
   * 的短时管理令牌再转发。过渡期换票失败降级为不带 bearer 的上游调用——上游一旦
   * 开始校验，这里的 null 会以上游自己的 401 浮出来，而不是在本层被吞掉。
   */
  private async request<T>(
    req: Request & RequestContext,
    path: string,
    options: {
      /** 每条读都给：在出口校验必有字段。见 `runos-contract.ts`。 */
      contract: RunosResource;
    },
  ): Promise<T> {
    const bearer = req.operatorAccessToken
      ? await this.operatorExchange.getToken(
          req.operatorAccessToken,
          RUNOS_AUDIENCE,
        )
      : null;
    const payload = await runosRequest<T>(
      path,
      bearer ? { bearer } : {},
      this.runosApiUrl,
    );
    return assertRunosContract(payload, options.contract);
  }

  /**
   * 目录列表。`?category=` 精确匹配；`?tag=` **可重复，且是全部命中（AND）**——
   * 不是任一命中，透传时必须保留重复参数，用 append 而不是 set。
   */
  @Get("capabilities")
  listCapabilities(
    @Req() req: Request & RequestContext,
    @Query("category") category?: string,
    @Query("tag") tag?: string | string[],
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ): Promise<CapabilityPage> {
    assertCanRead(req);
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    for (const t of Array.isArray(tag) ? tag : tag ? [tag] : []) {
      if (t) params.append("tag", t);
    }
    /* 原样转交，不兜底：非法值由 runos 回 `REGISTRY_INVALID_LIMIT`。 */
    if (limit) params.set("limit", limit);
    if (cursor) params.set("cursor", cursor);
    return this.request<CapabilityPage>(
      req,
      `/capability/capabilities${params.size ? `?${params.toString()}` : ""}`,
      { contract: "capabilities" },
    );
  }

  @Get("capabilities/:capabilityId")
  getCapability(
    @Req() req: Request & RequestContext,
    @Param("capabilityId") capabilityId: string,
  ): Promise<CapabilityDetailRecord> {
    assertCanRead(req);
    return this.request<CapabilityDetailRecord>(
      req,
      `/capability/capabilities/${encodeURIComponent(capabilityId)}`,
      { contract: "capability-detail" },
    );
  }
}

function trimBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** 只读面：admin 自己的目录读码。 */
function assertCanRead(req: Request & RequestContext): void {
  if (!req.user) {
    throw new UnauthorizedException("No active session");
  }
  if (!req.capabilities?.includes(CATALOG_READ)) {
    throw new ForbiddenException(`Missing ${CATALOG_READ} capability`);
  }
}

/**
 * 只有 GET：本文件没有写路由，这里也不给 method / body 参数——留着等于给将来
 * 的写路由预铺骨架，而写路由归 opera（见文件头）。
 */
async function runosRequest<TResponse>(
  path: string,
  options: {
    /** Operator-OBO management token (product_250 M-1), forwarded verbatim. */
    bearer?: string;
  },
  baseUrl: string,
): Promise<TResponse> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      ...(options.bearer
        ? { headers: { authorization: `Bearer ${options.bearer}` } }
        : {}),
    });
  } catch {
    throw new BadGatewayException("Runos is unavailable");
  }

  const responseText = await response.text();

  if (!response.ok) {
    throw new HttpException(
      parseRunosError(responseText, response.status),
      response.status,
    );
  }

  if (!responseText.trim()) {
    return undefined as TResponse;
  }

  return JSON.parse(responseText) as TResponse;
}

function parseRunosError(responseText: string, status: number): RunosErrorBody {
  if (!responseText.trim()) {
    return {
      code: "RUNOS_REQUEST_FAILED",
      message: `Runos request failed with status ${status}`,
      statusCode: status,
    };
  }

  try {
    const parsed = JSON.parse(responseText) as RunosErrorBody;
    if (parsed.message !== undefined || parsed.code !== undefined) {
      return { ...parsed, statusCode: parsed.statusCode ?? status };
    }

    return {
      code: "RUNOS_REQUEST_FAILED",
      message: `Runos request failed with status ${status}`,
      statusCode: status,
      details: parsed,
    };
  } catch {
    return {
      code: "RUNOS_REQUEST_FAILED",
      message: responseText,
      statusCode: status,
    };
  }
}
