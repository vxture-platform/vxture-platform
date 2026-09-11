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
 * 2026-08-30（40-product-registry.md §3）：本路由只触达 `client_kind='product'`
 * 的行。四个平台门户（website/console/admin/opera）是 `client_kind='platform'`，
 * 只由 seed / 27-provision 管——它们不是任何产品的凭据，出现在「接入凭据」列表里
 * 只会诱使人从产品页去轮换 console 的密钥。创建时先确认 productId 指向一个未删除
 * 的目录行再写库：让 FK 去报错得到的是一句 500，这里给的是字段级 400。
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
  Patch,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import { RequireStepUp } from "../auth/step-up.decorator";
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
  logoUrl: string | null;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  allowedScopes: string[];
  pkceRequired: boolean;
  /** `client_secret_basic`(机密) 或 `none`(RFC 8252 公共客户端)。 */
  tokenEndpointAuthMethod: string;
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
  logo_url: string | null;
  redirect_uris: string[];
  post_logout_redirect_uris: string[];
  allowed_scopes: string[];
  pkce_required: boolean;
  token_endpoint_auth_method: string;
  status: ClientState;
  created_at: string;
  updated_at: string;
}

const SELECT_COLUMNS = `
  c.id, c.client_id, c.product_id, p.product_code, c.release_channel, c.name,
  c.display_name, c.logo_url, c.redirect_uris, c.post_logout_redirect_uris,
  c.allowed_scopes, c.pkce_required, c.token_endpoint_auth_method, c.status,
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
    logoUrl: row.logo_url,
    redirectUris: row.redirect_uris,
    postLogoutRedirectUris: row.post_logout_redirect_uris ?? [],
    allowedScopes: row.allowed_scopes,
    tokenEndpointAuthMethod: row.token_endpoint_auth_method,
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
  /** 授权 / 登出页展示的 logo。此前库里有列、accounts 在读、没有地方能填。 */
  logoUrl?: string | null;
  /** 登出回跳白名单。不配的话用户登出后停在 accounts 页，回不到产品。 */
  postLogoutRedirectUris?: string[];
  /**
   * token 端点认证方式。`client_secret_basic`（默认，机密客户端）或
   * `none`（RFC 8252 公共客户端：桌面 / 移动原生应用，零机密）。
   *
   * 此前接口**根本不传这一项**，吃列默认——也就是说从 opera 建不出公共客户端，
   * 产品要发桌面端只能走 seed 或直接改库（ruyin 2026-08-30 转原生应用时就踩过，
   * 旧 secret hash 留着撞 CHECK，生产 seed 整体回滚）。
   */
  tokenEndpointAuthMethod?: "client_secret_basic" | "none";
}

/**
 * 写路由回传的列。**收成常量**：此前 `setState` 手写了一份，而它比 `SELECT_COLUMNS`
 * 少了 logo_url / post_logout_redirect_uris / token_endpoint_auth_method——停用一个
 * 客户端之后界面拿到的那一份就少三个字段。散着写迟早漏，列在一处才比得出来。
 */
const RETURNING_COLUMNS = `c.id, c.client_id, c.product_id, c.release_channel, c.name,
                  c.display_name, c.logo_url, c.redirect_uris,
                  c.post_logout_redirect_uris, c.allowed_scopes, c.pkce_required,
                  c.token_endpoint_auth_method, c.status, c.created_at, c.updated_at`;

/** 去空白、丢空串、去重，顺序保持调用方给的。 */
function normalizeUriList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    const v = typeof raw === "string" ? raw.trim() : "";
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
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
    const clauses = ["c.realm = 'customer'", "c.client_kind = 'product'"];
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
    const productId = body.productId!.trim();
    const productCode = await this.requireRegisteredProduct(productId);

    const authMethod = body.tokenEndpointAuthMethod ?? "client_secret_basic";
    const isPublic = authMethod === "none";

    /* 公共客户端没有 secret 可发。仍然生成再丢掉会白烧一次 bcrypt，
       而 bcrypt(cost=10) 不便宜——按需生成。 */
    const secret = isPublic ? null : generateSecret();
    const secretHash = secret
      ? await hash(secret, await genSalt(BCRYPT_COST))
      : null;

    let row: ClientRow;
    try {
      const result = await this.pool.query<ClientRow>(
        `INSERT INTO appoidc.oidc_clients (
           client_id, client_secret_hash, realm, product_id, client_kind,
           release_channel, name, display_name, logo_url, redirect_uris,
           post_logout_redirect_uris, allowed_scopes, pkce_required,
           token_endpoint_auth_method
         ) VALUES ($1, $2, 'customer', $3, 'product', $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id, client_id, product_id, release_channel, name,
                   display_name, logo_url, redirect_uris, post_logout_redirect_uris,
                   allowed_scopes, pkce_required, token_endpoint_auth_method,
                   status, created_at, updated_at`,
        [
          body.clientId!.trim(),
          /* 公共客户端**不持有 secret**——这是协议属性不是「没配」。
             库上 chk_oidc_clients_public_pkce 也挡，但那会冒成 500。 */
          isPublic ? null : secretHash,
          productId,
          body.releaseChannel ?? "stable",
          body.name?.trim() || body.clientId!.trim(),
          body.displayName?.trim() || null,
          body.logoUrl?.trim() || null,
          body.redirectUris,
          body.postLogoutRedirectUris ?? [],
          body.allowedScopes ?? DEFAULT_SCOPES,
          /* 公共客户端**强制** PKCE（RFC 8252）。机密客户端默认也开（OAuth 2.1
             对所有客户端的建议），调用方可以关。 */
          isPublic ? true : (body.pkceRequired ?? true),
          authMethod,
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

    return {
      ...toRecord({ ...row, product_code: productCode }),
      /* 公共客户端回空串而不是 null:调用方拿到的仍是 string,
         界面据「是否公共」决定显不显示那一栏,不靠判空。 */
      clientSecret: secret ?? "",
    };
  }

  /**
   * 轮换 client secret。
   *
   * **挂 @RequireStepUp()**：这是凭证材料的重新签发，旧密钥当场作废——产品侧
   * 当前的配置立即失效，直到他们换上新的。
   *
   * 此前它是裸的：`security:oidc_client.manage` 这个 step-up 码 2026-08-31 退役，
   * 理由是「admin 里没有任何路由检查它」——但 OIDC 客户端管理**搬到了 opera**，
   * step-up 没跟过来。于是有管理权限就能换，不需要二次验证本人在键盘前。
   * 形态照 atlas.router.ts 的密钥类写路由（同样是 opera-bff 执行）。
   */
  @Post(":clientId/rotate-secret")
  @RequireStepUp()
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
        WHERE client_id = $2 AND realm = 'customer' AND client_kind = 'product'
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
  /**
   * 改展示物：授权页上的名字与 logo。
   *
   * 此前**建完就改不了**——批一把 `displayName` / `logoUrl` 加进了「注册」对话框，
   * 却没有对应的改。于是 vxtpl 的授权页一直显示 `Vxtpl`（seed 里的英文缩写），
   * 而它的中文主名早就改成了「专注训练智能体」。客户在授权页看到的是前者。
   *
   * **不挂 step-up**：这两项不是安全边界，改错了顶多难看。回调白名单是另一回事，
   * 见下面那个端点——把它们分成两个路由，是为了让「哪一个动作需要二次验证」在
   * 路由表上看得见，而不是藏在一个会读 body 的条件判断里。
   *
   * PATCH 语义：字段缺席 = 不动；显式 null = 清空。
   */
  @Patch(":clientId")
  async updateDisplay(
    @Req() req: Request & RequestContext,
    @Param("clientId") clientId: string,
    @Body() body: { displayName?: string | null; logoUrl?: string | null },
  ): Promise<OidcClientRecord> {
    assertCanManage(req);
    const touchesName = Object.prototype.hasOwnProperty.call(
      body,
      "displayName",
    );
    const touchesLogo = Object.prototype.hasOwnProperty.call(body, "logoUrl");
    if (!touchesName && !touchesLogo) {
      throw invalidRequest(
        "VALIDATION_REQUIRED",
        "displayName 与 logoUrl 至少给一个",
        "displayName",
      );
    }
    const result = await this.pool.query<ClientRow>(
      `UPDATE appoidc.oidc_clients c
          SET display_name = CASE WHEN $2::bool THEN $3 ELSE c.display_name END,
              logo_url     = CASE WHEN $4::bool THEN $5 ELSE c.logo_url END,
              updated_at = now()
        WHERE c.client_id = $1 AND c.realm = 'customer' AND c.client_kind = 'product'
        RETURNING ${RETURNING_COLUMNS}`,
      [
        clientId,
        touchesName,
        body.displayName?.trim() || null,
        touchesLogo,
        body.logoUrl?.trim() || null,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw notFound("OIDC_CLIENT_NOT_FOUND", "Client not found");
    }
    return toRecord(row);
  }

  /**
   * 改回调白名单（登录回调 + 登出回跳）。
   *
   * **挂 @RequireStepUp()**：这是安全边界，不是展示物。能往白名单里加一个地址的人，
   * 就能把授权码导到自己控制的端点上——那是账号接管，比轮换密钥还直接。
   * 同 `rotateSecret` 的判据。
   *
   * 两个数组**整组替换**，不做增量：增量语义要求调用方先读再合并，而「读到的那一份
   * 是不是最新的」没人保证；整组替换让界面上看到的就是将要写进去的。
   */
  @Put(":clientId/redirect-uris")
  @RequireStepUp()
  async updateRedirectUris(
    @Req() req: Request & RequestContext,
    @Param("clientId") clientId: string,
    @Body()
    body: { redirectUris?: string[]; postLogoutRedirectUris?: string[] },
  ): Promise<OidcClientRecord> {
    assertCanManage(req);
    const redirects = normalizeUriList(body.redirectUris);
    if (redirects.length === 0) {
      throw invalidRequest(
        "VALIDATION_REQUIRED",
        "至少要有一个登录回调地址——清空等于这个客户端再也登不进来",
        "redirectUris",
      );
    }
    const logouts = normalizeUriList(body.postLogoutRedirectUris);
    const result = await this.pool.query<ClientRow>(
      `UPDATE appoidc.oidc_clients c
          SET redirect_uris = $2, post_logout_redirect_uris = $3, updated_at = now()
        WHERE c.client_id = $1 AND c.realm = 'customer' AND c.client_kind = 'product'
        RETURNING ${RETURNING_COLUMNS}`,
      [clientId, redirects, logouts],
    );
    const row = result.rows[0];
    if (!row) {
      throw notFound("OIDC_CLIENT_NOT_FOUND", "Client not found");
    }
    return toRecord(row);
  }

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
        WHERE c.client_id = $2 AND c.realm = 'customer' AND c.client_kind = 'product'
        RETURNING ${RETURNING_COLUMNS}`,
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

  /**
   * 产品凭据只能挂在目录里**现存**的产品上——软删的行有 id 也不算。先在这里判、
   * 再写库：FK 撞了是一句 500 加约束名，这里回的是 `productId` 字段级 400。
   */
  private async requireRegisteredProduct(productId: string): Promise<string> {
    if (!UUID_RE.test(productId)) {
      throw invalidRequest(
        "VALIDATION_INVALID_VALUE",
        "productId must be a product id from the catalog",
        "productId",
      );
    }
    const result = await this.pool.query<{ product_code: string }>(
      `SELECT product_code FROM product.products
        WHERE id = $1 AND deleted_at IS NULL`,
      [productId],
    );
    const code = result.rows[0]?.product_code;
    if (!code) {
      throw invalidRequest(
        "VALIDATION_INVALID_VALUE",
        "productId does not reference a registered product",
        "productId",
      );
    }
    return code;
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const authMethod = body.tokenEndpointAuthMethod;
  if (
    authMethod &&
    authMethod !== "client_secret_basic" &&
    authMethod !== "none"
  ) {
    throw invalidRequest(
      "VALIDATION_ENUM",
      "认证方式取 client_secret_basic(机密) 或 none(公共客户端)",
      "tokenEndpointAuthMethod",
    );
  }
  /* 公共客户端（RFC 8252）三条绑死：零机密、强制 PKCE、回调是 loopback 或自定义
     scheme。前两条库上有 chk_oidc_clients_public_pkce 兜底，但那会冒成 500——
     这里先判，给的是字段级 400。
     第三条不在这里判：loopback 端口是任意的、自定义 scheme 由产品定，判严了会
     把合法的挡在外面。 */
  if (authMethod === "none" && body.pkceRequired === false) {
    throw invalidRequest(
      "VALIDATION_CONFLICT",
      "公共客户端必须强制 PKCE（RFC 8252）——它没有 secret，PKCE 是唯一的防护",
      "pkceRequired",
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
