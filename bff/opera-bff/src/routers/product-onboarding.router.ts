/**
 * product-onboarding.router.ts — 产品接入的合并保存与密钥管理。
 * @package @vxture/bff-opera
 * @layer Application
 * @category Router
 *
 * owner 2026-09-14:「产品接入页面，注册客户端需要填写的信息是不是都整合在产品接入的
 * 新建/配置页面，除了需要单独的密钥管理可以弹出单独面板，现在分散且重复。」
 *
 * 此前一个产品的接入写在五个入口里：目录页「登记产品」弹窗、详情页「保存设置」（两次
 * 串行 PUT）、接入凭据页「注册客户端」、详情页凭据抽屉里「回调地址」与「授权页展示」
 * 两个弹窗。同一个客户端的回调地址，注册时一套校验、改的时候另一套；详情页两次 PUT
 * 之间失败会留下半截状态。
 *
 * 这里收成两类写：
 *
 *  - `POST /api/products/onboarding`、`PUT /api/products/:id/onboarding` —— 产品、边缘与回调、
 *    登录客户端在**一个事务**里。任何一处被拒，整笔回滚，页面上看到的就是库里的。
 *  - `PUT /api/products/:id/webhook-secret` —— 签名密钥与引用，**只从密钥面板写**，挂 step-up。
 *    client_secret 轮换仍是 `POST /api/oidc-clients/:clientId/rotate-secret`（同样挂 step-up）。
 *
 * ── step-up 按改动判，不按路由判 ──
 * 合并保存的大多数次只是改名字、换图标，每次都要二次验证是在训练运营者无脑点确认。
 * 真正的安全边界只有这几件：**签发新客户端**、改**登录回调 / 登出回跳白名单**、改 **scopes**、
 * 改 **PKCE**。事务里先锁行读出现状，由 `planClients` 算出本次是否触及它们，触及才调
 * `assertFreshStepUp`——判据与全局守卫是同一段代码。403 回到门户跑完仪式后**重发整个请求**，
 * 而判定发生在任何写之前，所以不存在「前半截已写、等验证完再写后半截」。
 *
 * ── 这里不做的事 ──
 *  - 不删客户端：保存里没带的客户端原样保留。停用走 `/api/oidc-clients/:clientId/deactivate`。
 *  - 不改 client_id、渠道、认证方式：client_id 写在产品自己的配置里，认证方式决定了有没有
 *    client_secret——改了等于换一个客户端，要换就新建一个渠道。
 *  - 不写密钥：请求体里没有密钥字段，边缘写入的 SQL 里连密钥两列都不出现。
 */
import {
  Body,
  Controller,
  Inject,
  Param,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import type { OidcRpClient } from "@vxture/core-oidc-rp";
import type { Request } from "express";
import type { Pool } from "pg";
import { RequireStepUp } from "../auth/step-up.decorator";
import { assertFreshStepUp } from "../auth/step-up.verify";
import { withTransaction, type Queryable } from "../db/tx";
import { invalidRequest, notFound } from "../errors/api-error";
import {
  RP_OIDC_CLIENT,
  RP_RUNTIME,
  type RpRuntime,
} from "../oidc/oidc-rp.tokens";
import { OPERA_BFF_RW_POOL } from "../tokens";
import type { RequestContext } from "../types/request-context";
import {
  insertProductClientTx,
  lockProductClientsTx,
  normalizeUriList,
  patchProductClientTx,
  validateClientInput,
  type OidcClientRecord,
  type ProductClientInput,
  type ProductClientPatch,
} from "./oidc-client.router";
import {
  insertProductTx,
  setWebhookSecretTx,
  updateProductTx,
  upsertEdgeTx,
  validateWrite,
  type EdgeWriteBody,
  type ProductRecord,
  type ProductWebhookRecord,
  type ProductWriteBody,
  type WebhookSecretBody,
} from "./product-catalog.router";
import { assertCanManage } from "./product-authz";
import { UUID_RE } from "./router.shared";

/** 合并保存的请求体。三块各自对应页面上的板块；密钥不在其中（见文件头）。 */
export interface OnboardingBody {
  product?: ProductWriteBody;
  edge?: EdgeWriteBody;
  clients?: ProductClientInput[];
}

export interface OnboardingResult {
  product: ProductRecord & { pinnedEdgeDomain?: string };
  /** 本次写过的边缘与回调；请求里没带 `edge` 时为 null（没写，不代表没有）。 */
  edge: ProductWebhookRecord | null;
  /** 写完之后这个产品下的全部客户端。 */
  clients: OidcClientRecord[];
  /** 本次新签发的 client_secret，**只此一次**。公共客户端没有 secret，不在其中。 */
  issuedSecrets: { clientId: string; clientSecret: string }[];
}

export interface ClientPlan {
  creates: { index: number; input: ProductClientInput }[];
  changes: { index: number; clientId: string; patch: ProductClientPatch }[];
  /** 本次是否触及安全边界：签发新客户端、改回调 / 登出回跳白名单、改 scopes、改 PKCE。 */
  touchesSecurity: boolean;
}

/** 白名单是集合：顺序与重复不构成改动，否则调个顺序也要二次验证。 */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * 把页面送来的客户端清单对照库里的现状，拆成「新建」与「按字段改」，并判定本次是否
 * 触及安全边界。
 *
 * 纯函数、不碰库：step-up 要不要做，是这条路由唯一不能判错的地方——判成「没触及」
 * 就是不经二次验证改了回调白名单。所以它单独可测。
 */
export function planClients(
  inputs: readonly ProductClientInput[],
  existing: readonly OidcClientRecord[],
): ClientPlan {
  const plan: ClientPlan = { creates: [], changes: [], touchesSecurity: false };
  const seenIds = new Set<string>();
  const seenChannels = new Set<string>();

  inputs.forEach((input, index) => {
    const prefix = `clients[${index}]`;
    const clientId = input.clientId?.trim() ?? "";
    if (clientId && seenIds.has(clientId)) {
      throw invalidRequest(
        "VALIDATION_CONFLICT",
        `client_id「${clientId}」在本次保存里出现了两次`,
        `${prefix}.clientId`,
      );
    }
    seenIds.add(clientId);
    const before = existing.find((c) => c.clientId === clientId);

    if (!before) {
      validateClientInput(input, { creating: true, fieldPrefix: prefix });
      const channel = input.releaseChannel ?? "stable";
      const holder = existing.find((c) => c.releaseChannel === channel);
      if (holder || seenChannels.has(channel)) {
        throw invalidRequest(
          "VALIDATION_CONFLICT",
          `渠道 ${channel} 已经有客户端${holder ? `「${holder.clientId}」` : ""}——一个产品每个渠道只有一个客户端`,
          `${prefix}.releaseChannel`,
        );
      }
      seenChannels.add(channel);
      plan.creates.push({ index, input });
      plan.touchesSecurity = true;
      return;
    }
    seenChannels.add(before.releaseChannel);

    if (
      input.releaseChannel !== undefined &&
      input.releaseChannel !== before.releaseChannel
    ) {
      throw invalidRequest(
        "VALIDATION_IMMUTABLE",
        "渠道建后不可改——要换渠道请新建一个客户端",
        `${prefix}.releaseChannel`,
      );
    }
    if (
      input.tokenEndpointAuthMethod !== undefined &&
      input.tokenEndpointAuthMethod !== before.tokenEndpointAuthMethod
    ) {
      throw invalidRequest(
        "VALIDATION_IMMUTABLE",
        "认证方式建后不可改——它决定了这个客户端有没有 client_secret",
        `${prefix}.tokenEndpointAuthMethod`,
      );
    }
    /* 以库里的认证方式去校验：「公共客户端不许关 PKCE」要看的是它现在是什么，
       而页面可能根本没送这一项。 */
    validateClientInput(
      {
        ...input,
        tokenEndpointAuthMethod:
          before.tokenEndpointAuthMethod === "none"
            ? "none"
            : "client_secret_basic",
      },
      { creating: false, fieldPrefix: prefix },
    );

    const patch: ProductClientPatch = {};
    if (input.displayName !== undefined) {
      const v = input.displayName?.trim() || null;
      if (v !== before.displayName) patch.displayName = v;
    }
    if (input.logoUrl !== undefined) {
      const v = input.logoUrl?.trim() || null;
      if (v !== before.logoUrl) patch.logoUrl = v;
    }
    if (input.redirectUris !== undefined) {
      const v = normalizeUriList(input.redirectUris);
      if (!sameSet(v, before.redirectUris)) {
        patch.redirectUris = v;
        plan.touchesSecurity = true;
      }
    }
    if (input.postLogoutRedirectUris !== undefined) {
      const v = normalizeUriList(input.postLogoutRedirectUris);
      if (!sameSet(v, before.postLogoutRedirectUris)) {
        patch.postLogoutRedirectUris = v;
        plan.touchesSecurity = true;
      }
    }
    if (input.allowedScopes !== undefined) {
      const v = normalizeUriList(input.allowedScopes);
      if (!sameSet(v, before.allowedScopes)) {
        patch.allowedScopes = v;
        plan.touchesSecurity = true;
      }
    }
    if (
      input.pkceRequired !== undefined &&
      input.pkceRequired !== before.pkceRequired
    ) {
      patch.pkceRequired = input.pkceRequired;
      plan.touchesSecurity = true;
    }
    if (Object.keys(patch).length > 0) {
      plan.changes.push({ index, clientId, patch });
    }
  });
  return plan;
}

function clientList(value: unknown): ProductClientInput[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw invalidRequest(
      "VALIDATION_INVALID_VALUE",
      "clients 必须是数组",
      "clients",
    );
  }
  return value as ProductClientInput[];
}

function hasEdgeValues(edge: EdgeWriteBody | undefined): edge is EdgeWriteBody {
  if (!edge) return false;
  return [
    edge.homeUrl,
    edge.webhookUrl,
    edge.edgeUpstream,
    edge.edgeDomain,
  ].some((v) => typeof v === "string" && v.trim() !== "");
}

/**
 * 锁住产品行，取回产品码与**当前对客可见性**。非 uuid 直接 404——拿去比 uuid 列会冒成 22P02 的 500。
 *
 * 可见性跟着这一次 `FOR UPDATE` 一起读：它是 `flipsCustomerVisibility` 的判据，而那个
 * 判断必须在任何写之前做完。单开一条 SELECT 也行，但那就是同一行读两次。
 */
async function lockProduct(
  q: Queryable,
  id: string,
): Promise<{ productCode: string; isCustomerVisible: boolean }> {
  if (!UUID_RE.test(id)) {
    throw notFound("CATALOG_PRODUCT_NOT_FOUND", "Product not found");
  }
  const result = await q.query<{
    product_code: string;
    is_customer_visible: boolean;
  }>(
    `SELECT product_code, is_customer_visible FROM product.products
      WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    throw notFound("CATALOG_PRODUCT_NOT_FOUND", "Product not found");
  }
  return {
    productCode: row.product_code,
    isCustomerVisible: row.is_customer_visible,
  };
}

/**
 * 这一次保存是否**翻转了对客可见性**。
 *
 * 纯函数、不碰库，理由与 `planClients` 同一条：step-up 要不要做是不能判错的事，
 * 判错的表现是「不经二次验证把一个产品推上官网」而接口回 200。所以它单独可测。
 *
 * **两个方向都算**：把在售产品从官网与 console 上撤下来，和把它推上去一样是对外面
 * 的改动。admin 侧的同一件事（`PATCH capabilities/:productCode/content`）本就双向都卡。
 *
 * 字段缺席（`undefined`）= 不动，送了但值没变也不算改动——反复保存同一张表单
 * 不该每次都要 TOTP。
 */
export function flipsCustomerVisibility(
  body: ProductWriteBody,
  before: { isCustomerVisible: boolean },
): boolean {
  return (
    body.isCustomerVisible !== undefined &&
    body.isCustomerVisible !== before.isCustomerVisible
  );
}

/**
 * 要新建的 client_id 有没有被占用（包括别的产品、平台门户的客户端）。
 *
 * 在 step-up **之前**判：否则运营者先过一遍 TOTP，再被告知名字撞了。也不靠唯一约束
 * 兜——那样拿到的是一句没有字段定位的 409。
 */
async function assertClientIdsFree(
  q: Queryable,
  plan: ClientPlan,
): Promise<void> {
  if (plan.creates.length === 0) return;
  const ids = plan.creates.map((c) => c.input.clientId!.trim());
  const result = await q.query<{ client_id: string }>(
    `SELECT client_id FROM appoidc.oidc_clients WHERE client_id = ANY($1::text[])`,
    [ids],
  );
  const taken = result.rows[0];
  if (!taken) return;
  const index =
    plan.creates.find((c) => c.input.clientId?.trim() === taken.client_id)
      ?.index ?? 0;
  throw invalidRequest(
    "VALIDATION_CONFLICT",
    `client_id「${taken.client_id}」已经被占用——换一个，或按渠道加后缀（如 ${taken.client_id}-beta）`,
    `clients[${index}].clientId`,
  );
}

async function applyCreates(
  q: Queryable,
  product: ProductRecord,
  plan: ClientPlan,
): Promise<{ clientId: string; clientSecret: string }[]> {
  const issued: { clientId: string; clientSecret: string }[] = [];
  for (const { input } of plan.creates) {
    const { record, clientSecret } = await insertProductClientTx(
      q,
      product.id,
      product.productCode,
      input,
    );
    if (clientSecret) {
      issued.push({ clientId: record.clientId, clientSecret });
    }
  }
  return issued;
}

@Controller("api/products")
export class ProductOnboardingRouter {
  // 显式 @Inject：产物走 esbuild 打包，不产出 `design:paramtypes` 元数据。
  constructor(
    @Inject(OPERA_BFF_RW_POOL) private readonly pool: Pool,
    @Inject(RP_OIDC_CLIENT) private readonly oidcClient: OidcRpClient,
    @Inject(RP_RUNTIME) private readonly rpRuntime: RpRuntime,
  ) {}

  /**
   * 新建产品：登记、边缘与回调、登录客户端一次写完。
   *
   * 新产品落 `draft`。带了客户端就是签发凭证，要 step-up。
   */
  @Post("onboarding")
  async create(
    @Req() req: Request & RequestContext,
    @Body() body: OnboardingBody,
  ): Promise<OnboardingResult> {
    assertCanManage(req);
    const productBody = body.product ?? {};
    validateWrite(productBody, { requireCore: true });
    const plan = planClients(clientList(body.clients), []);
    return withTransaction(this.pool, async (client) => {
      await assertClientIdsFree(client, plan);
      if (plan.touchesSecurity) {
        await assertFreshStepUp(req, this.oidcClient, this.rpRuntime);
      }
      const product = await insertProductTx(
        client,
        productBody,
        req.operator?.id ?? null,
      );
      const edge = hasEdgeValues(body.edge)
        ? await upsertEdgeTx(
            client,
            product.id,
            product.productCode,
            product.integrationMode,
            body.edge,
          )
        : null;
      const issuedSecrets = await applyCreates(client, product, plan);
      const clients = await lockProductClientsTx(client, product.id);
      return { product, edge, clients, issuedSecrets };
    });
  }

  /**
   * 保存一个产品的全部接入配置。
   *
   * 顺序即判据：锁产品 → 锁客户端读现状 → 算改动 → （触及安全边界才）step-up →
   * 写产品 → 写边缘 → 改客户端 → 建客户端。判定在任何写之前。
   */
  @Put(":id/onboarding")
  async update(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: OnboardingBody,
  ): Promise<OnboardingResult> {
    assertCanManage(req);
    const productBody = body.product ?? {};
    validateWrite(productBody, { requireCore: true, requireCode: false });
    const inputs = clientList(body.clients);
    return withTransaction(this.pool, async (client) => {
      const before = await lockProduct(client, id);
      const existing = await lockProductClientsTx(client, id);
      const plan = planClients(inputs, existing);
      await assertClientIdsFree(client, plan);
      /* 两条安全边界并列：客户端凭证（回调 / scopes / PKCE / 新发）与对客可见性。
         后者决定一个产品在不在官网与 console 的目录里，是对外面的改动，而 admin 侧
         的同一件事一直要 step-up——两边不一致等于这道门有一侧是虚的。 */
      if (
        plan.touchesSecurity ||
        flipsCustomerVisibility(productBody, before)
      ) {
        await assertFreshStepUp(req, this.oidcClient, this.rpRuntime);
      }
      const product = await updateProductTx(
        client,
        id,
        productBody,
        req.operator?.id ?? null,
      );
      const edge = body.edge
        ? await upsertEdgeTx(
            client,
            id,
            product.productCode,
            product.integrationMode,
            body.edge,
          )
        : null;
      for (const change of plan.changes) {
        const updated = await patchProductClientTx(
          client,
          change.clientId,
          id,
          change.patch,
        );
        if (!updated) {
          throw notFound(
            "OIDC_CLIENT_NOT_FOUND",
            `客户端「${change.clientId}」不在这个产品下`,
          );
        }
      }
      const issuedSecrets = await applyCreates(client, product, plan);
      const clients = await lockProductClientsTx(client, id);
      return { product, edge, clients, issuedSecrets };
    });
  }

  /**
   * 签名密钥与密钥引用。**只在密钥面板里写**，挂 step-up：能换掉签名密钥的人，就能
   * 伪造平台发往产品的开通 / 停用事件。
   */
  @Put(":id/webhook-secret")
  @RequireStepUp()
  async setWebhookSecret(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: WebhookSecretBody,
  ): Promise<ProductWebhookRecord> {
    assertCanManage(req);
    return withTransaction(this.pool, async (client) => {
      await lockProduct(client, id);
      return setWebhookSecretTx(client, id, body);
    });
  }
}
