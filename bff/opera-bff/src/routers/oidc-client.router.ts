/**
 * oidc-client.router.ts — 产品 OIDC 客户端注册（appoidc.oidc_clients CRUD）。
 * @package @vxture/bff-opera
 * @layer Application
 * @category Router
 *
 * "产品发布管理"第二阶段（2026-08-12）：`appoidc.oidc_clients` 此前**完全靠手工
 * seed**——全仓没有任何 API/UI 能给一个产品发 client_id/secret。这是
 * `product_200_integration.md` §7 新产品接入 checklist 六步里 C1（身份）唯一
 * 还没自动化的一环。
 *
 * realm 恒定 'customer'：workforce realm 留给平台自己的门户（admin/opera/
 * console/website），不对产品开放——这条不是我猜的，活库现有 product_id 非空
 * 的客户端（atlas/runos/arda/karda）全部是 realm='customer'。
 *
 * client_secret 只在 create / rotate 两个动作里明文返回一次，别的地方（包括
 * list/get）永远不下发、不落这一层的日志——同 atlas API Key 页、Runos 密钥
 * 托管那条"控制台零持有明文"的原则（product_250 M-3）。哈希用 bcryptjs，和
 * `PgOidcClientRepository.authenticateClient` 验证时用的同一个库，参数
 * （cost=10）与 `.env.local` 现有种子密钥哈希的格式对齐。
 *
 * 数据源：直连 `appoidc.oidc_clients`（opera-bff 自己的 pg pool），不是代理——
 * 同 product-catalog.router.ts 的直连模式。product_id 外键要求产品已经在
 * 「产品目录」（阶段一）登记过，两个页面天然串联。
 *
 * 能力码：复用 `platform:product.manage`——OIDC 客户端是产品登记的下一步，不
 * 单独开一套能力码。
 */

import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { hash, genSalt } from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { Request } from "express";
import type { Pool } from "pg";
import {
  conflict,
  invalidRequest,
  notEntitled,
  notFound,
  unauthenticated,
} from "../errors/api-error";
import { OPERA_BFF_RW_POOL } from "../tokens";
import type { RequestContext } from "../types/request-context";

const PRODUCT_MANAGE = "platform:product.manage";
const BCRYPT_COST = 10;

const RELEASE_CHANNELS = ["stable", "beta", "canary"] as const;
type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];
/**
 * product_251 B-3：「算不算数」统一叫 `state`，最小词表 `active` / `inactive`。
 *
 * 原来是 `status` + `disabled`——`disabled` 不是对最小词表的扩展，是同一个概念
 * 的第三种拼法。这里连库里的值一起换（`22_appoidc.sql` 的 CHECK 与 seed 同步
 * 改），不做接口层翻译：留一层 `inactive ⇄ disabled` 的映射，等于让每个读库的
 * 人都要记住两套词。
 */
type ClientState = "active" | "inactive";

const DEFAULT_SCOPES = ["openid", "profile", "email", "phone"];

export interface OidcClientRecord {
  id: string;
  clientId: string;
  realm: "customer";
  productId: string | null;
  productCode: string | null;
  releaseChannel: ReleaseChannel;
  name: string | null;
  displayName: string | null;
  redirectUris: string[];
  allowedScopes: string[];
  pkceRequired: boolean;
  state: ClientState;
  createdAt: string;
  updatedAt: string;
}

interface ClientRow {
  id: string;
  client_id: string;
  product_id: string | null;
  product_code: string | null;
  release_channel: ReleaseChannel;
  name: string | null;
  display_name: string | null;
  redirect_uris: string[];
  allowed_scopes: string[];
  pkce_required: boolean;
  status: ClientState;
  created_at: string;
  updated_at: string;
}

const SELECT_COLUMNS = `
  c.id, c.client_id, c.product_id, p.product_code, c.release_channel, c.name,
  c.display_name, c.redirect_uris, c.allowed_scopes, c.pkce_required, c.status,
  c.created_at, c.updated_at
`;
const FROM_JOIN = `appoidc.oidc_clients c LEFT JOIN product.products p ON p.id = c.product_id`;

function toRecord(row: ClientRow): OidcClientRecord {
  return {
    id: row.id,
    clientId: row.client_id,
    realm: "customer",
    productId: row.product_id,
    productCode: row.product_code,
    releaseChannel: row.release_channel,
    name: row.name,
    displayName: row.display_name,
    redirectUris: row.redirect_uris,
    allowedScopes: row.allowed_scopes,
    pkceRequired: row.pkce_required,
    state: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** URL-safe random secret, same shape as the platform's existing seed secrets (.env.local). */
function generateSecret(): string {
  return randomBytes(32).toString("base64url");
}

interface CreateClientBody {
  productId?: string;
  clientId?: string;
  releaseChannel?: ReleaseChannel;
  name?: string;
  displayName?: string | null;
  redirectUris?: string[];
  allowedScopes?: string[];
  pkceRequired?: boolean;
}

@Controller("api/oidc-clients")
export class OidcClientRouter {
  constructor(@Inject(OPERA_BFF_RW_POOL) private readonly pool: Pool) {}

  @Get()
  async list(
    @Req() req: Request & RequestContext,
    @Query("productId") productId?: string,
  ): Promise<OidcClientRecord[]> {
    assertCanManage(req);
    const clauses = ["c.realm = 'customer'"];
    const params: unknown[] = [];
    if (productId) {
      params.push(productId);
      clauses.push(`c.product_id = $${params.length}`);
    }
    const result = await this.pool.query<ClientRow>(
      `SELECT ${SELECT_COLUMNS} FROM ${FROM_JOIN}
        WHERE ${clauses.join(" AND ")}
        ORDER BY c.client_id ASC`,
      params,
    );
    return result.rows.map(toRecord);
  }

  @Post()
  async create(
    @Req() req: Request & RequestContext,
    @Body() body: CreateClientBody,
  ): Promise<OidcClientRecord & { clientSecret: string }> {
    assertCanManage(req);
    validateCreate(body);

    const secret = generateSecret();
    const salt = await genSalt(BCRYPT_COST);
    const secretHash = await hash(secret, salt);

    let row: ClientRow;
    try {
      const result = await this.pool.query<ClientRow>(
        `INSERT INTO appoidc.oidc_clients (
           client_id, client_secret_hash, realm, product_id, release_channel,
           name, display_name, redirect_uris, allowed_scopes, pkce_required
         ) VALUES ($1, $2, 'customer', $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, client_id, product_id, release_channel, name,
                   display_name, redirect_uris, allowed_scopes, pkce_required,
                   status, created_at, updated_at`,
        [
          body.clientId!.trim(),
          secretHash,
          body.productId,
          body.releaseChannel ?? "stable",
          body.name?.trim() || body.clientId!.trim(),
          body.displayName?.trim() || null,
          body.redirectUris,
          body.allowedScopes ?? DEFAULT_SCOPES,
          body.pkceRequired ?? true,
        ],
      );
      row = { ...result.rows[0]!, product_code: null };
    } catch (error) {
      if (isUniqueViolation(error)) {
        /* 唯一约束撞了——是"这个值被别人占了"，不是"这个值写得不对"。409 让
           控制台可以直接提示改名，而不是让人去逐字检查格式。 */
        throw conflict(
          "OIDC_CLIENT_ID_TAKEN",
          `client_id "${body.clientId}" already exists`,
        );
      }
      throw error;
    }

    const productCode = await this.resolveProductCode(row.product_id);
    return {
      ...toRecord({ ...row, product_code: productCode }),
      clientSecret: secret,
    };
  }

  @Post(":clientId/rotate-secret")
  async rotateSecret(
    @Req() req: Request & RequestContext,
    @Param("clientId") clientId: string,
  ): Promise<{ clientId: string; clientSecret: string }> {
    assertCanManage(req);
    const secret = generateSecret();
    const salt = await genSalt(BCRYPT_COST);
    const secretHash = await hash(secret, salt);
    const result = await this.pool.query(
      `UPDATE appoidc.oidc_clients
          SET client_secret_hash = $1, updated_at = now()
        WHERE client_id = $2 AND realm = 'customer'
        RETURNING client_id`,
      [secretHash, clientId],
    );
    if (!result.rows[0]) {
      throw notFound("OIDC_CLIENT_NOT_FOUND", "Client not found");
    }
    return { clientId, clientSecret: secret };
  }

  /**
   * 二元开关走动作端点，不走「把目标值 PATCH 进去」（product_251 B-3）。
   *
   * 两者的差别不是风格：`PATCH :id/state {state}` 要求调用方知道合法值有哪些、
   * 并且自己拼对；而这是个只有两个位置的开关，能拼错的只有拼写本身。动作端点
   * 让「停用一个客户端」在审计里也是一个动词，而不是一次通用更新。
   */
  @Post(":clientId/activate")
  async activate(
    @Req() req: Request & RequestContext,
    @Param("clientId") clientId: string,
  ): Promise<OidcClientRecord> {
    return this.setState(req, clientId, "active");
  }

  @Post(":clientId/deactivate")
  async deactivate(
    @Req() req: Request & RequestContext,
    @Param("clientId") clientId: string,
  ): Promise<OidcClientRecord> {
    return this.setState(req, clientId, "inactive");
  }

  private async setState(
    req: Request & RequestContext,
    clientId: string,
    next: ClientState,
  ): Promise<OidcClientRecord> {
    assertCanManage(req);
    const result = await this.pool.query<ClientRow>(
      `UPDATE appoidc.oidc_clients c
          SET status = $1, updated_at = now()
        WHERE c.client_id = $2 AND c.realm = 'customer'
        RETURNING c.id, c.client_id, c.product_id, c.release_channel, c.name,
                  c.display_name, c.redirect_uris, c.allowed_scopes,
                  c.pkce_required, c.status, c.created_at, c.updated_at`,
      [next, clientId],
    );
    if (!result.rows[0]) {
      throw notFound("OIDC_CLIENT_NOT_FOUND", "Client not found");
    }
    const productCode = await this.resolveProductCode(
      result.rows[0].product_id,
    );
    return toRecord({ ...result.rows[0], product_code: productCode });
  }

  private async resolveProductCode(
    productId: string | null,
  ): Promise<string | null> {
    if (!productId) return null;
    const result = await this.pool.query<{ product_code: string }>(
      `SELECT product_code FROM product.products WHERE id = $1`,
      [productId],
    );
    return result.rows[0]?.product_code ?? null;
  }
}

function assertCanManage(req: Request & RequestContext): void {
  if (!req.operator) {
    throw unauthenticated("AUTH_NO_SESSION", "No active session");
  }
  if (!req.capabilities?.includes(PRODUCT_MANAGE)) {
    throw notEntitled(PRODUCT_MANAGE);
  }
}

function validateCreate(body: CreateClientBody): void {
  if (!body.productId?.trim()) {
    throw invalidRequest(
      "VALIDATION_REQUIRED",
      "productId is required",
      "productId",
    );
  }
  if (!body.clientId?.trim()) {
    throw invalidRequest(
      "VALIDATION_REQUIRED",
      "clientId is required",
      "clientId",
    );
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(body.clientId.trim())) {
    throw invalidRequest(
      "VALIDATION_INVALID_VALUE",
      "clientId must be lowercase kebab (e.g. acme-agent, acme-agent-beta)",
      "clientId",
    );
  }
  if (!body.redirectUris || body.redirectUris.length === 0) {
    throw invalidRequest(
      "VALIDATION_REQUIRED",
      "at least one redirectUri is required",
      "redirectUris",
    );
  }
  for (const uri of body.redirectUris) {
    try {
      new URL(uri);
    } catch {
      throw invalidRequest(
        "VALIDATION_INVALID_URL",
        `invalid redirectUri: ${uri}`,
        "redirectUris",
      );
    }
  }
  if (
    body.releaseChannel &&
    !(RELEASE_CHANNELS as readonly string[]).includes(body.releaseChannel)
  ) {
    throw invalidRequest(
      "VALIDATION_INVALID_VALUE",
      `releaseChannel must be one of ${RELEASE_CHANNELS.join(", ")}`,
      "releaseChannel",
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23505"
  );
}
