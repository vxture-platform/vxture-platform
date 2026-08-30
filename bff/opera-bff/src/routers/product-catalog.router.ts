/**
 * product-catalog.router.ts — 产品目录注册（product.products CRUD）。
 * @package @vxture/bff-opera
 * @layer Application
 * @category Router
 *
 * "产品发布管理"第一阶段（2026-08-12）：`product.products` 此前只有
 * admin-bff `products.router.ts` 的只读 + plan-version 发布，全仓没有任何地方
 * 能新建/编辑一行产品记录——这是真实缺口，不是重复造轮子。
 *
 * 归属：opera 技术运维面（"产品目录"是基础设施登记，不是商业定价），admin 现
 * 有的产品展示（读 + 订阅套餐发布）原样不动、不跨包引用——两个 *-bff 之间零
 * 交叉引用的纪律延续到这里。
 *
 * 数据源：`product.products` 直接查（opera-bff 自己的 pg pool，
 * `OperaBffPoolsModule`），不是代理外部服务——这张表没有独立微服务可代理，
 * job-scheduler/product-health 两个router 已经是同样的直连模式。
 *
 * origin/origin_provider 两个字段（2026-08-12 迁移）是这次新增的来源轴：
 * self=平台自建、third_party=第三方接入、other；third_party 时
 * origin_provider 必填（DB CHECK 兜底，这里的校验只是提前给用户更好的错误）。
 *
 * 能力码：`platform:product.read` / `platform:product.manage`。
 */

import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import { VxConfigService } from "@vxture/core-config";
import type { Request } from "express";
import type { Pool } from "pg";
import { OperatorExchangeService } from "../auth/operator-exchange.service";
import {
  conflict,
  invalidRequest,
  notEntitled,
  notFound,
  unauthenticated,
} from "../errors/api-error";
import {
  fetchActiveUpstreamGrants,
  type ActiveUpstreamGrants,
} from "../lib/upstream-grants";
import { OPERA_BFF_RW_POOL } from "../tokens";
import type { RequestContext } from "../types/request-context";

const PRODUCT_READ = "platform:product.read";
const PRODUCT_MANAGE = "platform:product.manage";

/**
 * 「算不算数」的字段名统一叫 `state`（product_251 B-3）——**接口层**改名，
 * `product.products.status` 这个列不动：规范管的是边界形状，DDL 是另一层，
 * 两边分别有自己的稳定性要求。所以下面 `row.status → record.state` 的映射
 * 是有意的，不是遗漏。
 */
const STATES = ["active", "inactive", "draft", "deprecated"] as const;
type ProductState = (typeof STATES)[number];

/**
 * 产品生命周期状态机（`portals/opera/docs/opera-navigation-design.md` §6.4）。
 *
 * 库里的四个枚举值就是设计里那四态，不需要加字段：
 *   `draft` 草稿 → `active` 已上线 ⇄ `inactive` 已停用 → `deprecated` 已退役
 *
 * **`deprecated` 是终态，出边为空**——「谁曾经接入过、什么时候退的」必须答得出，
 * 所以退役是状态跃迁不是删行，且不可逆（要复活就重新登记一个产品码）。这与撤销授权
 * 迁 `revoked`、api-key 撤销保留行是同一条规则。
 *
 * **守卫立在这里而不是只立在界面上**：`PATCH :id/state` 此前任意值都放行，於是
 * 「终态」只是 opera 按钮上的一个约定——任何直连这个 BFF 的调用（脚本、curl、将来
 * 的第二个前端）都能把已退役的产品改回 active。约定挡不住的东西不叫约束。
 *
 * `draft → inactive` 也不给：草稿从来没上线过，「停用」对它没有意义，真实意图要么是
 * 继续接入要么是退役，两者都有各自的边。
 */
const STATE_TRANSITIONS: Record<ProductState, readonly ProductState[]> = {
  draft: ["active", "deprecated"],
  active: ["inactive", "deprecated"],
  inactive: ["active", "deprecated"],
  deprecated: [],
};

const STATE_LABELS: Record<ProductState, string> = {
  draft: "草稿",
  active: "已上线",
  inactive: "已停用",
  deprecated: "已退役",
};
const ORIGINS = ["self", "third_party", "other"] as const;
type ProductOrigin = (typeof ORIGINS)[number];

export interface ProductCategoryRecord {
  id: number;
  parentId: number | null;
  code: string;
  name: string;
}

export interface ProductRecord {
  id: string;
  productCode: string;
  productType: string;
  categoryId: number | null;
  productName: string;
  productNick: string | null;
  description: string | null;
  capabilityKeys: string[];
  tags: string[];
  standaloneSubscribable: boolean;
  state: ProductState;
  isCustomerVisible: boolean;
  isWorkforceVisible: boolean;
  origin: ProductOrigin;
  originProvider: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProductRow {
  id: string;
  product_code: string;
  product_type: string;
  category_id: number | null;
  product_name: string;
  product_nick: string | null;
  description: string | null;
  capability_keys: string[];
  tags: string[];
  standalone_subscribable: boolean;
  status: ProductState;
  is_customer_visible: boolean;
  is_workforce_visible: boolean;
  origin: ProductOrigin;
  origin_provider: string | null;
  created_at: string;
  updated_at: string;
}

function toRecord(row: ProductRow): ProductRecord {
  return {
    id: row.id,
    productCode: row.product_code,
    productType: row.product_type,
    categoryId: row.category_id,
    productName: row.product_name,
    productNick: row.product_nick,
    description: row.description,
    capabilityKeys: row.capability_keys,
    tags: row.tags,
    standaloneSubscribable: row.standalone_subscribable,
    state: row.status,
    isCustomerVisible: row.is_customer_visible,
    isWorkforceVisible: row.is_workforce_visible,
    origin: row.origin,
    originProvider: row.origin_provider,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface ProductWriteBody {
  productCode?: string;
  productType?: string;
  categoryId?: number | null;
  productName?: string;
  productNick?: string | null;
  description?: string | null;
  capabilityKeys?: string[];
  tags?: string[];
  standaloneSubscribable?: boolean;
  isCustomerVisible?: boolean;
  isWorkforceVisible?: boolean;
  origin?: ProductOrigin;
  originProvider?: string | null;
}

const SELECT_COLUMNS = `
  id, product_code, product_type, category_id, product_name, product_nick,
  description, capability_keys, tags, standalone_subscribable, status,
  is_customer_visible, is_workforce_visible, origin, origin_provider,
  created_at, updated_at
`;

@Controller("api/products")
export class ProductCatalogRouter {
  private readonly atlasApiUrl: string;
  private readonly runosApiUrl: string;

  /**
   * 后两个依赖只为退役闸门（`assertNoActiveUpstreamGrants`）——目录本身是本地表，
   * 不需要上游。注入而不是在闸门里现取，是让「产品目录会打两个上游」这件事在
   * 构造签名上就看得见。
   */
  constructor(
    @Inject(OPERA_BFF_RW_POOL) private readonly pool: Pool,
    @Inject(VxConfigService) configService: VxConfigService,
    @Inject(OperatorExchangeService)
    private readonly operatorExchange: OperatorExchangeService,
  ) {
    this.atlasApiUrl = configService.platform.ATLAS_API_URL.trim().replace(
      /\/+$/,
      "",
    );
    this.runosApiUrl = configService.platform.RUNOS_API_URL.trim().replace(
      /\/+$/,
      "",
    );
  }

  @Get()
  async list(
    @Req() req: Request & RequestContext,
    @Query("origin") origin?: string,
    @Query("state") state?: string,
  ): Promise<ProductRecord[]> {
    assertCanRead(req);
    const clauses: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    if (origin && (ORIGINS as readonly string[]).includes(origin)) {
      params.push(origin);
      clauses.push(`origin = $${params.length}`);
    }
    if (state && (STATES as readonly string[]).includes(state)) {
      params.push(state);
      clauses.push(`status = $${params.length}`);
    }
    const result = await this.pool.query<ProductRow>(
      `SELECT ${SELECT_COLUMNS} FROM product.products
        WHERE ${clauses.join(" AND ")}
        ORDER BY product_code ASC`,
      params,
    );
    return result.rows.map(toRecord);
  }

  @Get("categories")
  async listCategories(
    @Req() req: Request & RequestContext,
  ): Promise<ProductCategoryRecord[]> {
    assertCanRead(req);
    const result = await this.pool.query<{
      id: number;
      parent_id: number | null;
      code: string;
      name: string;
    }>(
      `SELECT id, parent_id, code, name FROM product.product_categories
        ORDER BY sort ASC, code ASC`,
    );
    return result.rows.map((r) => ({
      id: r.id,
      parentId: r.parent_id,
      code: r.code,
      name: r.name,
    }));
  }

  /**
   * 全部产品的检查单完成态，一次取回。
   *
   * 产品目录要在**列表**上显示每一行的验证态（未验证 / 待我方 / 待对方 / 通过），
   * 而验证态是从检查项推导出来的。逐行调 `:id/checklist` 就是 N 次往返；这里一条
   * SQL 把 products × launch_statuses 全带出来，形状与单产品那条完全一致，前端
   * 复用同一个 `verificationOf()`，不另写一套推导。
   *
   * 路由必须**排在 `@Get(":id")` 之前**——Nest 按声明顺序匹配，放在后面会被 `:id`
   * 吃掉，`checklist-summary` 会被当成一个产品 id 去查（然后 404 或 uuid 解析报错）。
   * 这类顺序 bug type-check 一点都看不出来，只有跑一次才知道。
   */
  @Get("checklist-summary")
  async getChecklistSummary(
    @Req() req: Request & RequestContext,
  ): Promise<Record<string, ChecklistItemRecord[]>> {
    assertCanRead(req);
    const result = await this.pool.query<ChecklistRow & { product_id: string }>(
      `SELECT p.id AS product_id,
              i.item_code, i.item_name, i.description, i.is_required, i.sort,
              s.is_satisfied, s.checked_at, s.remark
         FROM product.products p
         CROSS JOIN product.launch_checklist_items i
         LEFT JOIN product.product_launch_statuses s
           ON s.item_code = i.item_code AND s.product_id = p.id
        WHERE p.deleted_at IS NULL
          AND i.item_code <> ALL($1::text[])
        ORDER BY p.id, i.sort ASC`,
      [ADMIN_OWNED_ITEM_CODES],
    );
    const byProduct: Record<string, ChecklistItemRecord[]> = {};
    for (const row of result.rows) {
      (byProduct[row.product_id] ??= []).push(toChecklistRecord(row));
    }
    return byProduct;
  }

  @Get(":id")
  async get(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<ProductRecord | null> {
    assertCanRead(req);
    const result = await this.pool.query<ProductRow>(
      `SELECT ${SELECT_COLUMNS} FROM product.products
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  @Post()
  async create(
    @Req() req: Request & RequestContext,
    @Body() body: ProductWriteBody,
  ): Promise<ProductRecord> {
    assertCanManage(req);
    validateWrite(body, { requireCore: true });
    const operatorId = req.operator?.id ?? null;
    const result = await this.pool.query<ProductRow>(
      `INSERT INTO product.products (
         product_code, product_type, category_id, product_name, product_nick,
         description, capability_keys, tags, standalone_subscribable, status,
         is_customer_visible, is_workforce_visible, origin, origin_provider,
         created_by, updated_by
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10, $11, $12, $13, $14, $14
       ) RETURNING ${SELECT_COLUMNS}`,
      [
        body.productCode!.trim(),
        body.productType!.trim(),
        body.categoryId ?? null,
        body.productName!.trim(),
        body.productNick?.trim() || null,
        body.description?.trim() || null,
        body.capabilityKeys ?? [],
        body.tags ?? [],
        body.standaloneSubscribable ?? true,
        body.isCustomerVisible ?? true,
        body.isWorkforceVisible ?? true,
        body.origin ?? "self",
        body.originProvider?.trim() || null,
        operatorId,
      ],
    );
    return toRecord(result.rows[0]!);
  }

  @Put(":id")
  async update(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: ProductWriteBody,
  ): Promise<ProductRecord> {
    assertCanManage(req);
    validateWrite(body, { requireCore: true });
    const operatorId = req.operator?.id ?? null;
    const result = await this.pool.query<ProductRow>(
      `UPDATE product.products SET
         product_type = $1, category_id = $2, product_name = $3,
         product_nick = $4, description = $5, capability_keys = $6, tags = $7,
         standalone_subscribable = $8, is_customer_visible = $9,
         is_workforce_visible = $10, origin = $11, origin_provider = $12,
         updated_by = $13, updated_at = now()
       WHERE id = $14 AND deleted_at IS NULL
       RETURNING ${SELECT_COLUMNS}`,
      [
        body.productType!.trim(),
        body.categoryId ?? null,
        body.productName!.trim(),
        body.productNick?.trim() || null,
        body.description?.trim() || null,
        body.capabilityKeys ?? [],
        body.tags ?? [],
        body.standaloneSubscribable ?? true,
        body.isCustomerVisible ?? true,
        body.isWorkforceVisible ?? true,
        body.origin ?? "self",
        body.originProvider?.trim() || null,
        operatorId,
        id,
      ],
    );
    if (!result.rows[0]) {
      throw notFound("CATALOG_PRODUCT_NOT_FOUND", "Product not found");
    }
    return toRecord(result.rows[0]);
  }

  @Patch(":id/state")
  async setState(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: { state?: string },
  ): Promise<ProductRecord> {
    assertCanManage(req);
    if (!body.state || !(STATES as readonly string[]).includes(body.state)) {
      throw invalidRequest(
        "VALIDATION_INVALID_VALUE",
        `state must be one of ${STATES.join(", ")}`,
        "state",
      );
    }
    const next = body.state as ProductState;

    /* 退役闸门（2026-08-31，owner 优先级 #1；`opera/40-product-registry.md` §6）：
       目标态是 deprecated 时先问两个上游「这个产品还有没有生效中的授权」——有就
       409，查不到就 502。**只有 deprecated 这一条边挂闸门**：停用是可逆的、上线与
       恢复不减少任何东西，它们的语义不需要上游闭合。

       放在事务**之外**：网络调用不能夹在 FOR UPDATE 里，一次上游慢 30 秒就把这
       一行锁 30 秒，连带把同一产品的所有其它写都挂住。代价是检查与写之间有一个
       窗口（这期间新发的授权拦不住）——跨系统没有锁，这个窗口只能靠「未登记产品
       的授权」报表事后兜住，而不是靠把网络请求塞进事务假装原子。 */
    if (next === "deprecated") {
      await this.assertNoActiveUpstreamGrants(req, id);
    }

    /* 先读当前态再判迁移。多一次往返，但没有它就没法判"从哪来"——而这个状态机的
       全部约束（终态、无 draft→inactive）都定义在边上，不在目标态上。
       `FOR UPDATE` 锁住这一行到事务结束，否则两个并发请求会各自读到 active 然后
       一个写 deprecated、一个写 inactive，最后一个赢——把终态覆盖掉。 */
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{ status: ProductState }>(
        `SELECT status FROM product.products
          WHERE id = $1 AND deleted_at IS NULL
          FOR UPDATE`,
        [id],
      );
      const from = current.rows[0]?.status;
      if (!from) {
        await client.query("ROLLBACK");
        throw notFound("CATALOG_PRODUCT_NOT_FOUND", "Product not found");
      }

      /* 幂等重放（active → active）不报错也不写库：重复点一次「恢复」不该看到
         一条红色的"非法迁移"，它想要的结果本来就已经成立。 */
      if (from !== next) {
        if (!STATE_TRANSITIONS[from].includes(next)) {
          await client.query("ROLLBACK");
          const allowed = STATE_TRANSITIONS[from];
          throw conflict(
            "CATALOG_INVALID_STATE_TRANSITION",
            allowed.length === 0
              ? `${STATE_LABELS[from]}是终态，不能再改成${STATE_LABELS[next]}——产品退役后要重新接入，是登记一个新的产品码。`
              : `不允许从${STATE_LABELS[from]}改成${STATE_LABELS[next]}；可以改成：${allowed
                  .map((s) => STATE_LABELS[s])
                  .join(" / ")}。`,
          );
        }
      }

      const operatorId = req.operator?.id ?? null;
      const result = await client.query<ProductRow>(
        `UPDATE product.products
            SET status = $1, updated_by = $2, updated_at = now()
          WHERE id = $3 AND deleted_at IS NULL
          RETURNING ${SELECT_COLUMNS}`,
        [next, operatorId, id],
      );
      await client.query("COMMIT");
      return toRecord(result.rows[0]!);
    } catch (error) {
      /* ROLLBACK 已经发过的两条路径再发一次是无害的（no-op 事务）；没发过的
         （UPDATE 抛错）必须发，否则连接带着开着的事务回到池里。 */
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 退役前置：Atlas 的模型路由授权与 Runos 的能力授权都必须为零。
   *
   * 为什么要这道闸门：`product.products` 是「有哪些产品」的唯一权威，但两个上游
   * 各自的库里只存 `product_code` 字符串——没有 FK，也没有任何东西在产品退役时
   * 去动它们。此前退役一个产品，上游的授权原封不动地活着：一个目录里已经不存在
   * 的主体仍然能换票、仍然能调路由。闭合不能靠上游（它们看不见目录），只能立在
   * 目录这一侧、立在写终态的那条边上。
   *
   * 两条上游查询与 fail-closed 的理由见 `lib/upstream-grants.ts`
   * `fetchActiveUpstreamGrants`。这里只做两件事：查产品码、把「有」翻成 409。
   */
  private async assertNoActiveUpstreamGrants(
    req: Request & RequestContext,
    id: string,
  ): Promise<void> {
    const current = await this.pool.query<{
      product_code: string;
      status: ProductState;
    }>(
      `SELECT product_code, status FROM product.products
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    const row = current.rows[0];
    if (!row) {
      throw notFound("CATALOG_PRODUCT_NOT_FOUND", "Product not found");
    }
    /* 已退役的产品再收一次 deprecated 是幂等重放（下面的事务里不会写库）——
       不为一个不会发生的写去打两个上游。 */
    if (row.status === "deprecated") return;

    const grants = await fetchActiveUpstreamGrants(
      {
        operatorExchange: this.operatorExchange,
        atlasApiUrl: this.atlasApiUrl,
        runosApiUrl: this.runosApiUrl,
      },
      req,
      row.product_code,
    );
    if (grants.atlas.count === 0 && grants.runos.count === 0) return;
    throw productHasActiveGrants(grants);
  }

  // ── 接入检查单（product_200 §7，六步技术接入）─────────────────────────────
  // 复用 product.launch_checklist_items 字典表——commerce 那两项
  // （verification_policy/pricing_set）留给 admin 消费，这里按
  // ADMIN_OWNED_ITEM_CODES **排除**它们，其余全是 opera 的；不读不写不属于
  // opera 的两项。为什么是排除而不是正向清单，见该常量的注释。

  /**
   * 产品的 webhook 登记（`product.product_webhooks`，每产品至多一行）。
   *
   * 上线流程要回答「平台侧配齐了没有」，webhook 是其中一项。这里**只读登记**——
   * 不发测试投递。发一次真实回调是对**对方生产端点**的外部动作，属于新造探针，
   * 而本批的约束是不新造（见 `docs/70-workplan/20-opera-ia-restructure.md` B4 依赖）。
   * 全仓也确实没有任何 test-delivery 实现，那条依赖当时写错了。
   *
   * `webhook_secret_ref` 是**引用不是密钥**（密钥本体不在这张表），可以安全回传——
   * 上线检查要区分「配了签名密钥」与「没配」，只回一个布尔会让运营者无从核对配的是
   * 哪一个引用。
   */
  @Get(":id/webhook")
  async getWebhook(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<ProductWebhookRecord | null> {
    assertCanRead(req);
    const result = await this.pool.query<{
      home_url: string | null;
      webhook_url: string | null;
      webhook_secret_ref: string | null;
    }>(
      `SELECT home_url, webhook_url, webhook_secret_ref
         FROM product.product_webhooks WHERE product_id = $1`,
      [id],
    );
    const row = result.rows[0];
    /* 没有登记行与登记了但字段为空是两件事，都要能区分：前者回 null（从没配过），
       后者回一行带 null 字段（配过一半）。 */
    return row
      ? {
          homeUrl: row.home_url,
          webhookUrl: row.webhook_url,
          webhookSecretRef: row.webhook_secret_ref,
        }
      : null;
  }

  /**
   * webhook 登记的写入（upsert，`product_id` 是 PK 所以每产品至多一行）。
   *
   * **补这个入口是因为上线检查第五项原本指了一条走不通的路**：它失败时的 remedy 写着
   * 「需要在库里补 `product.product_webhooks` 这一行」——一个检查项失败后让运营者去手改
   * 数据库，闭环是断的。
   *
   * **三项都允许留空**（DDL 三列都可空）。运营者常常先拿到回调地址、密钥引用还没签发，
   * 这时要能先存一半；不给存就是把人推回手改库。检查项本来就区分「没有登记行」「配了
   * 一半」「配齐」三种态，写入侧不该把中间态堵死。
   *
   * 非空时才校验格式：地址必须是 http/https 绝对 URL——填一个相对路径或 `example` 这类
   * 占位，要到平台真的推一次订阅变更才暴露，而那时错的是对方收不到。
   */
  @Put(":id/webhook")
  async putWebhook(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body()
    body: {
      homeUrl?: string | null;
      webhookUrl?: string | null;
      webhookSecretRef?: string | null;
    },
  ): Promise<ProductWebhookRecord> {
    assertCanManage(req);

    const homeUrl = normalizeUrl(body.homeUrl, "homeUrl");
    const webhookUrl = normalizeUrl(body.webhookUrl, "webhookUrl");
    const secretRef = normalizeRef(body.webhookSecretRef);

    /* 先确认产品在。FK 违例会冒成 500，而这里真实的答案是 404——把「产品不存在」
       报成服务器错误，会让人去查服务而不是去查产品码。 */
    const exists = await this.pool.query(
      `SELECT 1 FROM product.products WHERE id = $1`,
      [id],
    );
    if (exists.rowCount === 0) {
      throw notFound("CATALOG_PRODUCT_NOT_FOUND", `Product ${id} not found`);
    }

    const result = await this.pool.query<{
      home_url: string | null;
      webhook_url: string | null;
      webhook_secret_ref: string | null;
    }>(
      `INSERT INTO product.product_webhooks
         (product_id, home_url, webhook_url, webhook_secret_ref)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (product_id) DO UPDATE
         SET home_url           = EXCLUDED.home_url,
             webhook_url        = EXCLUDED.webhook_url,
             webhook_secret_ref = EXCLUDED.webhook_secret_ref,
             updated_at         = now()
       RETURNING home_url, webhook_url, webhook_secret_ref`,
      [id, homeUrl, webhookUrl, secretRef],
    );
    const row = result.rows[0]!;
    return {
      homeUrl: row.home_url,
      webhookUrl: row.webhook_url,
      webhookSecretRef: row.webhook_secret_ref,
    };
  }

  @Get(":id/checklist")
  async getChecklist(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<ChecklistItemRecord[]> {
    assertCanRead(req);
    const result = await this.pool.query<ChecklistRow>(
      `SELECT i.item_code, i.item_name, i.description, i.is_required, i.sort,
              s.is_satisfied, s.checked_at, s.remark
         FROM product.launch_checklist_items i
         LEFT JOIN product.product_launch_statuses s
           ON s.item_code = i.item_code AND s.product_id = $1
        WHERE i.item_code <> ALL($2::text[])
        ORDER BY i.sort ASC`,
      [id, ADMIN_OWNED_ITEM_CODES],
    );
    return result.rows.map(toChecklistRecord);
  }

  @Patch(":id/checklist/:itemCode")
  async setChecklistItem(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Param("itemCode") itemCode: string,
    @Body() body: { isSatisfied?: boolean; remark?: string | null },
  ): Promise<ChecklistItemRecord> {
    assertCanManage(req);
    /* 先查字典再写：字典里没有的码，此前被正向清单挡成 404；现在清单是反向的，
       不查一下就会一路走到 INSERT 撞 FK 冒成 500——而真实的答案仍是 404。admin 那
       两项字典里有、但不归 opera，对本接口同样是「没有这一项」。 */
    const known = await this.pool.query(
      `SELECT 1 FROM product.launch_checklist_items WHERE item_code = $1`,
      [itemCode],
    );
    if (known.rowCount === 0 || !isOperaChecklistItem(itemCode)) {
      throw notFound(
        "CATALOG_CHECKLIST_ITEM_UNKNOWN",
        `Unknown checklist item: ${itemCode}`,
      );
    }
    if (typeof body.isSatisfied !== "boolean") {
      throw invalidRequest(
        "VALIDATION_REQUIRED",
        "isSatisfied is required",
        "isSatisfied",
      );
    }
    const operatorId = req.operator?.id ?? null;

    /* PATCH = 未出现即不改（product_251 B-1）。
       原来无条件写 `remark = EXCLUDED.remark`：只勾一下「已满足」而不带 remark 的请求
       会把已有的备注**抹掉**，返回 200，界面上看不出区别——运营者写的那段说明就这么
       没了。这是 B 组里最危险的那类缺陷：不进错误日志，几个月后才表现为「我明明写过」。
       区分三态：键不在 = 不改；显式 null/空串 = 清空；有值 = 覆盖。 */
    const touchesRemark = Object.prototype.hasOwnProperty.call(body, "remark");
    const remark = body.remark?.trim() || null;
    await this.pool.query(
      `INSERT INTO product.product_launch_statuses
         (product_id, item_code, is_satisfied, checked_at, checked_by, remark)
       VALUES ($1, $2, $3, now(), $4, $5)
       ON CONFLICT (product_id, item_code) DO UPDATE SET
         is_satisfied = EXCLUDED.is_satisfied,
         checked_at = now(),
         checked_by = EXCLUDED.checked_by,
         ${touchesRemark ? "remark = EXCLUDED.remark," : ""}
         updated_at = now()`,
      [id, itemCode, body.isSatisfied, operatorId, remark],
    );
    const result = await this.pool.query<ChecklistRow>(
      `SELECT i.item_code, i.item_name, i.description, i.is_required, i.sort,
              s.is_satisfied, s.checked_at, s.remark
         FROM product.launch_checklist_items i
         LEFT JOIN product.product_launch_statuses s
           ON s.item_code = i.item_code AND s.product_id = $1
        WHERE i.item_code = $2`,
      [id, itemCode],
    );
    return toChecklistRecord(result.rows[0]!);
  }
}

/**
 * 检查单里**不归 opera** 的检查项：商业前置两项，admin 消费（2026-08-30 改反向）。
 *
 * 字典表 `product.launch_checklist_items` 没有归属列——它建表时
 * （`data_platform_200_schema.md` §7.8）只装商业前置项，product_200 §7 的六步技术
 * 接入后来复用了同一张表（seed 里的注释）。此前这里写的是六个技术项的**正向清单**，
 * 与 seed 里那六行一一重复：seed 加第七个技术项、这里不加，界面上就少一项，而且
 * 没有任何东西会报错——DDL 的原话是「新增检查项 = INSERT 一行，不改表结构」，
 * 正向清单把这句话变成了假的。
 *
 * 改成反向：字典表里的行**默认都是 opera 的**，只排除 admin 那两项。这两项是这张
 * 表建表时就定下的商业前置（`verification_policy` 来自设计稿 §7.8，`pricing_set`
 * 由 seed 加入），比技术项稳定得多；技术项新增照 DDL 的话 INSERT 即可见。当前
 * seed 的八行经这条规则得到的正是原来那六项，顺序由 `sort` 给，行为不变（钉在
 * `product-catalog.spec.ts`）。
 *
 * 这仍是一个字面量，只是从「opera 有什么」缩成「opera 没有什么」。真正的归属轴
 * 该是表上的一列（seed 与 DDL 的改动，不在本文件的范围）；到那天把这个集合连同
 * `isOperaChecklistItem` 一起删掉，SQL 改按列过滤。
 */
export const ADMIN_OWNED_ITEM_CODES = [
  "verification_policy",
  "pricing_set",
] as const;

/** 字典里的一项归不归 opera（不回答「字典里有没有」——那要查库）。 */
export function isOperaChecklistItem(itemCode: string): boolean {
  return !(ADMIN_OWNED_ITEM_CODES as readonly string[]).includes(itemCode);
}

/**
 * 409 `PRODUCT_HAS_ACTIVE_GRANTS`：上游还有生效中的授权，退役被拒。
 *
 * 响应体带结构化明细 `{ productCode, atlas: {count, sample}, runos: {count, sample} }`
 * ——一个只被告知「你不能」的运营者只能自己去两个域页翻是哪几条；把条数与样本
 * 带回去，门户才能直接给出「去权益配置清掉这 N 条」的出口。不走 `conflict()`
 * 帮手：封套四件套装不下明细，而 `AllExceptionsFilter` 对自带 `code` 的响应体会
 * 把额外字段原样带出去（它为 atlas 的 `blockedBy` 留的那条通路）。
 *
 * 样本里的 `id` / `grantId` 是给机器的；门户展示只用 `endpointCode` /
 * `capabilityId`（UUID 不上屏）。
 */
export function productHasActiveGrants(
  grants: ActiveUpstreamGrants,
): HttpException {
  const parts: string[] = [];
  if (grants.atlas.count > 0) {
    parts.push(`Atlas ${grants.atlas.count} 条模型路由授权`);
  }
  if (grants.runos.count > 0) {
    parts.push(`Runos ${grants.runos.count} 条能力授权`);
  }
  return new HttpException(
    {
      code: "PRODUCT_HAS_ACTIVE_GRANTS",
      message: `${grants.productCode} 在上游还有生效中的授权（${parts.join("、")}），退役前要先全部撤销——去「权益配置」清掉再来。`,
      retryable: false,
      statusCode: HttpStatus.CONFLICT,
      productCode: grants.productCode,
      atlas: grants.atlas,
      runos: grants.runos,
    },
    HttpStatus.CONFLICT,
  );
}

export interface ProductWebhookRecord {
  homeUrl: string | null;
  webhookUrl: string | null;
  /** 密钥**引用**，不是密钥本体——本体不在这张表。 */
  webhookSecretRef: string | null;
}

export interface ChecklistItemRecord {
  itemCode: string;
  itemName: string;
  description: string | null;
  isRequired: boolean;
  sort: number;
  isSatisfied: boolean;
  checkedAt: string | null;
  remark: string | null;
}

interface ChecklistRow {
  item_code: string;
  item_name: string;
  description: string | null;
  is_required: boolean;
  sort: number;
  is_satisfied: boolean | null;
  checked_at: string | null;
  remark: string | null;
}

function toChecklistRecord(row: ChecklistRow): ChecklistItemRecord {
  return {
    itemCode: row.item_code,
    itemName: row.item_name,
    description: row.description,
    isRequired: row.is_required,
    sort: row.sort,
    isSatisfied: row.is_satisfied ?? false,
    checkedAt: row.checked_at,
    remark: row.remark,
  };
}

/** 空串与 null 一律落 null——数据库里「空串」和「没配」是同一件事，别造两种空。 */
function normalizeUrl(
  value: string | null | undefined,
  field: string,
): string | null {
  const raw = (value ?? "").trim();
  if (raw === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw invalidRequest(
      "VALIDATION_INVALID_URL",
      `${field} 必须是绝对 URL（含 http:// 或 https://）`,
      field,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw invalidRequest(
      "VALIDATION_INVALID_URL",
      `${field} 只接受 http / https`,
      field,
    );
  }
  /* DDL 是 varchar(512)，超长会被数据库拒成 500——在这里拦成 400。 */
  if (raw.length > 512) {
    throw invalidRequest(
      "VALIDATION_TOO_LONG",
      `${field} 超过 512 字符`,
      field,
    );
  }
  return raw;
}

/** 密钥**引用**不是密钥本体，不做 URL 校验；只拦长度（DDL varchar(128)）。 */
function normalizeRef(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (raw === "") return null;
  if (raw.length > 128) {
    throw invalidRequest(
      "VALIDATION_TOO_LONG",
      "webhookSecretRef 超过 128 字符",
      "webhookSecretRef",
    );
  }
  return raw;
}

function assertCanRead(req: Request & RequestContext): void {
  if (!req.operator) {
    throw unauthenticated("AUTH_NO_SESSION", "No active session");
  }
  if (
    !req.capabilities?.includes(PRODUCT_READ) &&
    !req.capabilities?.includes(PRODUCT_MANAGE)
  ) {
    throw notEntitled(PRODUCT_READ);
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

function validateWrite(
  body: ProductWriteBody,
  opts: { requireCore: boolean },
): void {
  if (opts.requireCore) {
    if (!body.productCode?.trim()) {
      throw invalidRequest(
        "VALIDATION_REQUIRED",
        "productCode is required",
        "productCode",
      );
    }
    if (!body.productType?.trim()) {
      throw invalidRequest(
        "VALIDATION_REQUIRED",
        "productType is required",
        "productType",
      );
    }
    if (!body.productName?.trim()) {
      throw invalidRequest(
        "VALIDATION_REQUIRED",
        "productName is required",
        "productName",
      );
    }
  }
  if (body.origin && !(ORIGINS as readonly string[]).includes(body.origin)) {
    throw invalidRequest(
      "VALIDATION_INVALID_VALUE",
      `origin must be one of ${ORIGINS.join(", ")}`,
      "origin",
    );
  }
  if (body.origin === "third_party" && !body.originProvider?.trim()) {
    throw invalidRequest(
      "VALIDATION_REQUIRED",
      "originProvider is required when origin=third_party",
      "originProvider",
    );
  }
}
