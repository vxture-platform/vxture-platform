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
 * 能力码：`integration:product.read` / `integration:product.manage`（门在 `product-authz.ts`，
 * 与接入信号 router 共用一份）。
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Put,
  Query,
  Res,
  StreamableFile,
  Req,
} from "@nestjs/common";
import {
  PRODUCT_SURFACES,
  deriveSecretKey,
  encryptSecret,
  isValidProductSurface,
} from "@vxture/core-utils";
import { VxConfigService } from "@vxture/core-config";
import { isValidProductType, PRODUCT_TYPES } from "@vxture/core-utils";
import { isValidProductLayer, PRODUCT_LAYERS } from "@vxture-platform/shared";
import { isAutoDeterminedChecklistItem } from "@vxture/core-utils";
import { createHash } from "node:crypto";
import { UUID_RE } from "./router.shared";
import type { Request, Response as ExpressResponse } from "express";
import type { Pool, PoolClient } from "pg";
import { insertOperatorAuditLog } from "../audit/audit-log";
import type { Queryable } from "../db/tx";
import { RequireStepUp } from "../auth/step-up.decorator";
import { OperatorExchangeService } from "../auth/operator-exchange.service";
import { conflict, invalidRequest, notFound } from "../errors/api-error";
import {
  fetchActiveUpstreamGrants,
  type ActiveUpstreamGrants,
} from "../lib/upstream-grants";
import { OPERA_BFF_RW_POOL } from "../tokens";
import type { RequestContext } from "../types/request-context";
// Capability gate shared with product-integration-signals.router.ts (2026-08-31).
import { assertCanManage, assertCanRead } from "./product-authz";

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

/**
 * L0 平台级共享指标（只读）。`state` 为 `reserved` 的键同样不许产品重定义。
 *
 * 出参叫 `state` 不叫 `status`：管理面 API 口径里「算不算数」统一是 `state`
 * （DB 列仍是 `status`，只在接口层改名）。lint:api-conventions B-3 强制。
 */
export interface PlatformMetricRecord {
  metricKey: string;
  /**
   * 中文名与一句话说明——住在 `product.metric_catalog`（key → 名/说明），是**键的
   * 属性**而不是「(产品, 键)」的属性：同一个 `member.max` 不该每接一个产品就被再
   * 命名一遍（owner 2026-09-22：更高维度的统一，产品要复用）。
   * 没命名过时为空串，界面回落显示 metricKey 本身——平台不替产品命名。
   */
  displayName: string;
  metricDescription: string;
  kind: string | null;
  metricUnit: string | null;
  state: string | null;
}

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
  /**
   * 产品分层 L1/L2/L3（product_100_matrix §2）。定位轴，与 productType（类型）、
   * origin（来源）正交——external 是来源不是层级，客户端与内部服务不是目录产品。
   * null = 未分类（存量行在 layer 列落地前都是这个）。
   */
  layer: string | null;
  /**
   * 带理由跳过上线闸门的痕迹（owner 2026-09-17：“先上线再联调”）。
   *
   * 两者都为空 = 正常上线。理由不在这里——它是问责台账，归 `support.audit_logs`；
   * 产品行只答「是不是带缺项上线的、缺的是哪几项」。
   */
  launchOverrideAt: string | null;
  /** 跳过当时尚未满足的 `gate='launch'` 必填项 item_code；复验后转满足即不再提示。 */
  launchOverridePending: string[] | null;
  createdAt: string;
  updatedAt: string;
  /** 产品图标。console 应用中心磁贴、订阅卡在读它。 */
  iconUrl: string | null;
  /** 平台托管图标的版本号(内容哈希)。null = 没传过。 */
  iconVersion: string | null;
  /** 可露出的端（受管枚举）。一个都没勾时是空数组，不是 null。 */
  surfaces: string[];
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
  layer: string | null;
  launch_override_at: string | null;
  launch_override_pending: string[] | null;
  created_at: string;
  updated_at: string;
  icon_url: string | null;
  icon_version: string | null;
  surfaces: string[];
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
    layer: row.layer,
    /* 带理由跳过上线闸门的痕迹（owner 2026-09-17）。产品页据此常驻提示
       「上线时跳过 N 项，待复验」；两列都为空 = 正常上线。理由不在这里，
       它是问责台账，归 support.audit_logs。 */
    launchOverrideAt: row.launch_override_at,
    launchOverridePending: row.launch_override_pending ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    iconUrl: row.icon_url,
    iconVersion: row.icon_version,
    surfaces: row.surfaces ?? [],
  };
}

/**
 * 列表上「接入配置」一格的摘要（owner 2026-09-16：目录列信息要补齐，长的收进气泡）。
 *
 * 只在列表查询里带出，不进 SELECT_COLUMNS：那个常量还用在单行读与 RETURNING 上，
 * 那些路径不需要这份摘要。三份都是本地表，相关子查询一次带出，不让页面逐行再打。
 */
export interface ProductIntegrationSummary {
  edgeDomain: string | null;
  edgeUpstream: string | null;
  webhookUrl: string | null;
  homeUrl: string | null;
  hasWebhookSecret: boolean;
  clients: { clientId: string; channel: string; state: string }[];
  metricKeys: string[];
}

export type ProductListRecord = ProductRecord & {
  integration: ProductIntegrationSummary;
};

interface ProductListRow extends ProductRow {
  webhook_summary: {
    edgeDomain: string | null;
    edgeUpstream: string | null;
    webhookUrl: string | null;
    homeUrl: string | null;
    hasWebhookSecret: boolean;
  } | null;
  client_summary: { clientId: string; channel: string; state: string }[] | null;
  metric_keys: string[] | null;
}

function toListRecord(row: ProductListRow): ProductListRecord {
  const w = row.webhook_summary;
  return {
    ...toRecord(row),
    integration: {
      edgeDomain: w?.edgeDomain ?? null,
      edgeUpstream: w?.edgeUpstream ?? null,
      webhookUrl: w?.webhookUrl ?? null,
      homeUrl: w?.homeUrl ?? null,
      hasWebhookSecret: w?.hasWebhookSecret ?? false,
      clients: row.client_summary ?? [],
      metricKeys: row.metric_keys ?? [],
    },
  };
}

export interface ProductWriteBody {
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
  /** 分层 L1/L2/L3（受管值域 @vxture-platform/shared PRODUCT_LAYERS）；null = 清空。 */
  layer?: string | null;
  /** 产品图标。console 应用中心的磁贴、订阅卡在读它——此前库里有列、没有地方能填。 */
  iconUrl?: string | null;
  /**
   * 可露出的端（受管枚举，权威源 `@vxture/core-utils` 的 `PRODUCT_SURFACES`）。
   *
   * **整组替换语义**：传 `["web"]` = 只留 web，其余删掉；传 `[]` = 一个都不留。
   * 字段缺席（undefined）= 不动——「改个产品名」不该顺手把端清空。
   */
  surfaces?: string[];
}

interface ProductDeleteBody {
  /** 两步删除的第二步显式确认；服务端要求为 true，否则 400。 */
  confirm?: boolean;
}

/** 客户侧足迹(直接带 product_id 的表)。任一为真 ⇒ 只能退役、不能删除。 */
interface CustomerFootprint {
  hasUsage: boolean;
  hasBilling: boolean;
  hasProvisioning: boolean;
  hasEntitlements: boolean;
  /** 被别的产品的套餐当搭售件引用——删掉会把人家的套餐掏空。 */
  hasBundledUse: boolean;
  blocked: boolean;
}

/**
 * 删除影响面——两步删除第一步的预览、第二步执行前复核共用。
 * `footprint`/`upstream*` 决定能不能删；`cascade` 是删除时连带处理的运营侧配置。
 */
export interface ProductDeletionImpact {
  deletable: boolean;
  /** 挡住删除的原因码(deletable=false 时非空)，供门户直接给出去处。 */
  blockers: string[];
  footprint: CustomerFootprint;
  upstreamAtlas: number;
  upstreamRunos: number;
  cascade: {
    /** 会被一并软删的套餐(本产品作 primary 组件的套餐)。 */
    plans: number;
    /** 会被停用(status=inactive)的 product 型 OIDC 客户端——登录随之中断。 */
    oidcClients: string[];
  };
}

const SELECT_COLUMNS = `
  id, product_code, product_type, layer, category_id, product_name, product_nick,
  description, capability_keys, tags, standalone_subscribable, status,
  is_customer_visible, is_workforce_visible, origin, origin_provider,
  launch_override_at, launch_override_pending,
  icon_url, created_at, updated_at,
  /* 平台托管图标的版本号(内容哈希)。同样用裸 id 相关——理由见下面那段。
     只取版本不取字节:这个常量用在列表查询上,把 bytea 拖进每一行是灾难。 */
  (select i.checksum from product.product_icons i where i.product_id = id) as icon_version,
  /* 端是关系表，用相关子查询一次带出——不让调用方再打一遍。
     子查询里用**裸 id** 相关而不是 p.id：本常量同时用在三处 SELECT 与四处
     RETURNING，两种上下文都没有表别名。裸 id 在两处都能正确解析到外层那一行
     （在 dev 库上两种上下文各跑过一次，不是推的）。
     注意这段注释里不能出现反引号——它在模板字符串内部，一个反引号就把串截断了
     （第一版就是这么写的，tsc 报的是十几行外的语法错，看不出根因）。
     coalesce 到空数组：让「一个端都没勾」返回 [] 而不是 null。 */
  coalesce(
    (select array_agg(s.surface order by s.surface)
       from product.product_surfaces s where s.product_id = id),
    '{}'
  ) as surfaces
`;

/** 只收位图。SVG 可以带脚本——见 `putIcon` 的注释。 */
const ICON_MIME_TYPES = ["image/png", "image/webp", "image/jpeg"];
/** 256KB，与库上的 chk_product_icons_size 同一个数。 */
const ICON_MAX_BYTES = 262144;

/**
 * 一个路径参数既可能是 id 也可能是产品码——**先判形状，再挑列**。
 *
 * 反过来（先查一列不中再查另一列）在这里不成立：把产品码喂给 `uuid` 列是
 * `22P02`，那是**错误不是零行**，整条查询当场炸成 500，接不到"再试另一列"。
 *
 * 返回的是 SQL 片段而不是参数，所以**只能拿常量拼**：`$1` 始终承载值本身。
 */
function productWhere(idOrCode: string): string {
  return UUID_RE.test(idOrCode) ? "p.id = $1" : "p.product_code = $1";
}

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
  ): Promise<ProductListRecord[]> {
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
    /* 摘要子查询用 p.id 相关而不是裸 id：oidc_clients 自己有 id 列，裸 id 会被解析成
       c.id（SELECT_COLUMNS 里的子查询没有这个问题——那两张表没有 id 列）。 */
    const result = await this.pool.query<ProductListRow>(
      `SELECT ${SELECT_COLUMNS},
         (SELECT json_build_object(
             'edgeDomain', w.edge_domain,
             'edgeUpstream', w.edge_upstream,
             'webhookUrl', w.webhook_url,
             'homeUrl', w.home_url,
             'hasWebhookSecret', w.webhook_secret_enc IS NOT NULL)
            FROM product.product_webhooks w WHERE w.product_id = p.id) AS webhook_summary,
         coalesce(
           (SELECT json_agg(json_build_object(
               'clientId', c.client_id,
               'channel', c.release_channel,
               'state', c.status)
               ORDER BY c.release_channel, c.client_id)
              FROM appoidc.oidc_clients c WHERE c.product_id = p.id),
           '[]'::json) AS client_summary,
         coalesce(
           (SELECT array_agg(m.metric_key ORDER BY m.metric_key)
              FROM product.product_metrics m WHERE m.product_id = p.id),
           '{}') AS metric_keys
        FROM product.products p
        WHERE ${clauses.join(" AND ")}
        -- 默认次序 = 目录次序，与 admin 产品目录和官网 /appcenter 同一句（owner
        -- 2026-09-22 裁定）。原先只排 product_code，于是运营在 admin 把某个产品移到
        -- 顶部之后，这一页纹丝不动——同一份清单两个后台两个顺序。
        -- 本页的表头排序（名称/来源/类型/状态/验收/更新时间）不受影响，要字母序点
        -- 一下【名称】就回来了；这里只定「没点任何表头时看到的是什么」。
        ORDER BY p.sort ASC, p.product_code ASC`,
      params,
    );
    return result.rows.map(toListRecord);
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
              i.item_code, i.item_name, i.description, i.is_required, i.gate, i.sort,
              s.is_satisfied, s.checked_at, s.remark
         FROM product.products p
         CROSS JOIN product.launch_checklist_items i
         LEFT JOIN product.product_launch_statuses s
           ON s.item_code = i.item_code AND s.product_id = p.id
        WHERE p.deleted_at IS NULL
          AND i.owner = 'opera'
        ORDER BY p.id, i.sort ASC`,
      [],
    );
    const byProduct: Record<string, ChecklistItemRecord[]> = {};
    for (const row of result.rows) {
      (byProduct[row.product_id] ??= []).push(toChecklistRecord(row));
    }
    return byProduct;
  }

  /**
   * 单个产品。**id 与 product_code 双接受。**
   *
   * 产品详情页的地址走可读码（`/product/catalog/karda` 而不是一串 uuid）——地址要
   * 能读、能分享、能在工单里粘贴。既有调用方传 uuid，一样收。
   *
   * **先判形状再决定查哪一列**，不是「先按 uuid 查、失败再按 code 查」：`id` 是
   * uuid 列，把 `"karda"` 喂进去是 `22P02 invalid input syntax`，一句 500，而真实
   * 答案是「按码去查」。这条教训来自 admin 那批可读码路由（`tenant_no` 是 bigint，
   * 同样要先挡形状）。
   *
   * UUID 判据只看**格式良好**，不卡 RFC 4122 的版本/变体位——与 `router.shared.ts`
   * 的 `UUID_RE` 同一条，那里记着为什么（严格版会把种子里刻意固定段的 id 判成无效）。
   */
  /**
   * L0 平台级共享指标。**只读**。
   *
   * 产品登记自己的指标之前要先知道哪些键是平台的——它们不能被产品重新定义
   * （95 的 `trg_product_metrics_no_platform_shadow`），额度由套餐组件贡献。
   * 此前这份清单在界面上完全看不见，运营者只能靠撞上那条 409 才知道。
   *
   * 路由必须**排在 `@Get(":idOrCode")` 之前**——Nest 按声明顺序匹配，放在后面会被
   * 参数段吃掉。同 `checklist-summary` 那条的理由。
   */
  @Get("platform-metrics")
  async listPlatformMetrics(
    @Req() req: Request & RequestContext,
  ): Promise<PlatformMetricRecord[]> {
    assertCanRead(req);
    const result = await this.pool.query<{
      metric_key: string;
      kind: string | null;
      metric_unit: string | null;
      status: string | null;
      display_name: string | null;
      description: string | null;
    }>(
      /* 中文名住在 `metric_catalog`（key → 名/说明）——它是**键的属性**，两张计量表
         共用一处命名（owner 2026-09-22：更高维度的统一，产品要复用）。
         LEFT JOIN：没命名过的回落显示 metric_key 本身，不阻塞。 */
      `SELECT m.metric_key, m.kind, m.metric_unit, m.status,
              mc.display_name, mc.description
         FROM product.platform_metrics m
         LEFT JOIN product.metric_catalog mc ON mc.metric_key = m.metric_key
        ORDER BY m.metric_key`,
    );
    return result.rows.map((r) => ({
      metricKey: r.metric_key,
      displayName: r.display_name ?? "",
      metricDescription: r.description ?? "",
      kind: r.kind,
      metricUnit: r.metric_unit,
      state: r.status,
    }));
  }

  /**
   * 产品图标（平台托管）。上传走 base64 JSON，不走 multipart。
   *
   * **为什么不是 multipart**：平台一个上传端点都还没有，引入 multipart 要装
   * `@nestjs/platform-express` 的文件中间件、配临时目录与清理。而图标是几十 KB 的
   * 小文件，浏览器端 `FileReader` 读成 base64 直接 POST，零新增中间件。
   * 将来有了对象存储与大文件（附件、工单截图），那时再引 multipart，它本来也该
   * 是另一条路——大文件不该先在内存里变成 base64。
   *
   * **不收 SVG**：SVG 可以带 `<script>`，从 console 自己的域名发出去等于存储型 XSS，
   * 且带着客户的会话。库上有 CHECK 兜底，这里先判，给字段级 400。
   *
   * **三条都双接受 id 或产品码**，与 `GET :idOrCode` 一致：不判形状直接把产品码喂给
   * `uuid` 列是 `22P02`——那是**错误不是零行**，于是「查不到」变成 500。而
   * console 那边的同一张图恰恰是按产品码寻址的（`/api/applications/:appCode/icon`），
   * 两边不一致会诱人拿产品码来试这边。
   */
  @Put(":id/icon")
  async putIcon(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: { mimeType?: string; dataBase64?: string },
  ): Promise<{ byteSize: number; mimeType: string }> {
    assertCanManage(req);
    const mime = (body.mimeType ?? "").trim();
    if (!ICON_MIME_TYPES.includes(mime)) {
      throw invalidRequest(
        "VALIDATION_ENUM",
        `图标只收 ${ICON_MIME_TYPES.join(" / ")}。SVG 不收——它可以带脚本，从控制台的域名发出去是存储型 XSS；要矢量请先栅格化。`,
        "mimeType",
      );
    }
    const raw = (body.dataBase64 ?? "").trim();
    if (!raw) {
      throw invalidRequest("VALIDATION_REQUIRED", "没有图片内容", "dataBase64");
    }
    let bytes: Buffer;
    try {
      bytes = Buffer.from(raw, "base64");
    } catch {
      bytes = Buffer.alloc(0);
    }
    /* `Buffer.from(x, "base64")` 对垃圾输入**不抛**，它跳过非法字符返回一个短
       buffer。所以判空是唯一能发现"这不是 base64"的地方。 */
    if (bytes.length === 0) {
      throw invalidRequest(
        "VALIDATION_INVALID_VALUE",
        "图片内容不是合法的 base64",
        "dataBase64",
      );
    }
    if (bytes.length > ICON_MAX_BYTES) {
      throw invalidRequest(
        "VALIDATION_TOO_LARGE",
        `图标不能超过 ${Math.floor(ICON_MAX_BYTES / 1024)}KB，当前 ${Math.ceil(bytes.length / 1024)}KB`,
        "dataBase64",
      );
    }
    /* 内容哈希给 HTTP 的 ETag 用：浏览器带 If-None-Match 回来就是 304，不重发字节。
       换图会换哈希，所以缓存不会对不齐——这正是外链方案做不到的那一半。 */
    const checksum = createHash("sha256")
      .update(bytes)
      .digest("hex")
      .slice(0, 32);
    /* 产品 id 从 `SELECT` 里取而不是直接用 `$1`：`$1` 可能是产品码。顺带把
       「产品不存在」变成 0 行——此前那是一条外键违例，也就是 500。 */
    const done = await this.pool.query(
      `INSERT INTO product.product_icons
         (product_id, mime_type, bytes, byte_size, checksum)
       SELECT p.id, $2, $3, $4, $5
         FROM product.products p
        WHERE ${productWhere(id)} AND p.deleted_at IS NULL
       ON CONFLICT (product_id) DO UPDATE SET
         mime_type = EXCLUDED.mime_type, bytes = EXCLUDED.bytes,
         byte_size = EXCLUDED.byte_size, checksum = EXCLUDED.checksum,
         updated_at = now()
       RETURNING byte_size, mime_type`,
      [id, mime, bytes, bytes.length, checksum],
    );
    const row = done.rows[0] as
      | { byte_size: number; mime_type: string }
      | undefined;
    if (!row) throw notFound("CATALOG_PRODUCT_NOT_FOUND", "No such product");
    return { byteSize: row.byte_size, mimeType: row.mime_type };
  }

  /**
   * 取图标字节（详情页预览用）。与 console-bff 那条读同一张表。
   *
   * 两个门户各有一条而不是共用一条：它们的鉴权不同（这边要运营者会话，那边是
   * 产品的公开标识），跨门户直连别人的 BFF 才是更奇怪的耦合。
   */
  @Get(":id/icon")
  async getIcon(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Res({ passthrough: true }) res: ExpressResponse,
  ): Promise<StreamableFile> {
    assertCanRead(req);
    const found = await this.pool.query<{
      mime_type: string;
      bytes: Buffer;
      checksum: string;
    }>(
      `SELECT i.mime_type, i.bytes, i.checksum
         FROM product.product_icons i
         JOIN product.products p ON p.id = i.product_id
        WHERE ${productWhere(id)} AND p.deleted_at IS NULL`,
      [id],
    );
    const row = found.rows[0];
    if (!row) throw notFound("CATALOG_ICON_NOT_FOUND", "No icon");
    res.set({
      "Content-Type": row.mime_type,
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: `"${row.checksum}"`,
      "X-Content-Type-Options": "nosniff",
    });
    return new StreamableFile(row.bytes);
  }

  @Delete(":id/icon")
  async deleteIcon(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<{ deleted: boolean }> {
    assertCanManage(req);
    const r = await this.pool.query(
      `DELETE FROM product.product_icons i
        USING product.products p
        WHERE p.id = i.product_id
          AND ${productWhere(id)} AND p.deleted_at IS NULL`,
      [id],
    );
    return { deleted: (r.rowCount ?? 0) > 0 };
  }

  @Get(":idOrCode")
  async get(
    @Req() req: Request & RequestContext,
    @Param("idOrCode") idOrCode: string,
  ): Promise<ProductRecord | null> {
    assertCanRead(req);
    const byId = UUID_RE.test(idOrCode);
    const result = await this.pool.query<ProductRow>(
      `SELECT ${SELECT_COLUMNS} FROM product.products
        WHERE ${byId ? "id = $1" : "product_code = $1"} AND deleted_at IS NULL`,
      [idOrCode],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  /*
   * —— `POST /api/products` 与 `PUT /api/products/:id` 已退役（2026-09-17）——
   *
   * 两条路由自 2026-09-14 接入收成一张页（#323）起就**没有调用方**：建档与保存都走
   * `product-onboarding.router.ts` 的合并保存（产品 / 边缘 / 客户端同一事务）。留着的代价
   * 不是“多两行死码”：它们写的是同一张表，却**绕过了合并保存那道按改动判的 step-up**
   * ——拿得到 `integration:product.manage` 的人可以绕开二次验证把一个产品推上官网。
   *
   * 所以是退役而不是“给旁路也挂一把锁”：写入口收成一个，门才只有一道。
   * `insertProductTx` / `updateProductTx` / `validateWrite` 三个 helper 原样导出，onboarding
   * 在用；「缺席即不改」那条回归守卫改指 `updateProductTx` 本体（缺陷在 helper
   * 里，不在路由外壳）。
   */

  /**
   * 产品生命周期迁移：上线 / 停用 / 恢复 / 退役。
   *
   * **整条路由挂 step-up（2026-09-17，owner）**——这四件事都是对外面的重大变化：
   * 上线让产品进 console / 官网目录并成为 token-exchange 目标，停用与退役当场
   * 收走客户的可用性。用**静态装饰器**而不是命令式 `assertFreshStepUp`：后者适合
   * 「同一条路由有时高危有时不」（合并保存那种），而这条路由**每一条边都是高危写**，
   * 正是 `step-up.guard.ts` 文件头说的那种场景。附带的好处：不必给本 router
   * 注入 `oidcClient` / `rpRuntime`（那会改构造签名、波及六份 spec）。
   *
   * **step-up 不是确认框**：凭据有效期内会复用，第二次起一按就过。身份≠意图，
   * 所以门户那侧另有确认框（`PRODUCT_ACTIONS` 的 `confirmIntent` / `destructive`）——
   * 两道门各管一件事，不能互相顶替。
   */
  @Patch(":id/state")
  @RequireStepUp()
  async setState(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body()
    body: {
      state?: string;
      /**
       * 带理由跳过上线闸门（owner 2026-09-17：“先上线再联调”）。
       *
       * **只对 `draft → active` 有意义**，其余边本来就不过检查单门。理由必填且不允许只打空白：
       * 跳过本身不是问题，没人说得清为什么跳才是。
       */
      override?: { reason?: string };
    },
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

      /*
       * 首次上线的检查单闸门。**此前只立在界面上。**
       *
       * 本文件开头为状态跃迁守卫写过一句判据：「任何直连这个 BFF 的调用都能把已退役
       * 的产品改回 active……约定挡不住的东西不叫约束」。检查单闸门当时没跟着搬过来
       * ——它整个住在 opera 的 `runLifecycle()` 里，于是 `draft → active` 在**零项
       * 满足**的情况下，一条 curl 就过。同一条原则，低一层没执行。
       *
       * 范围与界面那道完全一致，不多收一寸：
       *   · 只管 `draft → active`（`lifecycle.ts` 里只有 `launch` 带
       *     `requiresChecklist`）。`inactive → active`（恢复）在界面上是 advisory
       *     ——提醒不是门闩，服务端也不该把它变成门闩，那会把一次运维恢复堵死。
       *   · 只算**卡这道门**的项（`gate = 'launch'`）。这与展示口径
       *     （`checklist-summary` / `:id/checklist` 按 `owner = 'opera'`）**有意不同**：
       *     归属回答「这一项归谁勾」，门回答「这一项卡哪一道」，是两根正交的轴。
       *     `acceptance` 归 opera（仍在抽屉里、仍要人勾），但 `gate = 'publish'`
       *     ——它要的端到端链路需要产品先能被订阅，而订阅需要产品已上线；卡在这道
       *     门上就成了自锁（owner 2026-09-17）。发布门另立，见 40-product-registry.md。
       *
       * **LEFT JOIN 的 NULL 算作未满足**：一项从来没被写过，和被写成 false 是同一
       * 件事——都不是「已确认」。`coalesce` 而不是 `s.is_satisfied = false`，后者会
       * 把没有行的项漏掉，也就是把「一次都没检查过的产品」判成通过。
       */
      if (from === "draft" && next === "active") {
        const pending = await client.query<{
          item_code: string;
          item_name: string;
        }>(
          `SELECT i.item_code, i.item_name
             FROM product.launch_checklist_items i
             LEFT JOIN product.product_launch_statuses s
               ON s.item_code = i.item_code AND s.product_id = $1
            WHERE i.is_required
              AND i.gate = 'launch'
              AND NOT coalesce(s.is_satisfied, false)
            ORDER BY i.sort ASC`,
          [id],
        );
        if (pending.rowCount && pending.rowCount > 0) {
          const reason = body.override?.reason?.trim() ?? "";
          if (!reason) {
            await client.query("ROLLBACK");
            const names = pending.rows.map((r) => r.item_name || r.item_code);
            throw conflict(
              "CATALOG_LAUNCH_CHECKLIST_PENDING",
              `还有 ${names.length} 项必填接入检查未满足，不能上线：${names.join("、")}。` +
                `机器判定的几项要去产品的「上线复验」页跑一次，其余在接入检查单上确认。`,
            );
          }

          /*
           * 带理由跳过（owner 2026-09-17：“先上线再联调”）。
           *
           * **条件不删也不降级**：调研结论是六项里没有一项结构性锁死
           * （三项自动检查产品后端各调一次就点亮，不需要客户 / 订阅 / 套餐）。
           * 削弱条件只会让这道门以后什么也证明不了；所以保留门，另开一条
           * 写明理由的路，并把跳过的事实留在产品行上。
           *
           * 三列各答一件事：什么时候跳的 / 谁跳的 / 当时缺哪几项。
           * **理由不入产品行**——它是问责台账，归 `support.audit_logs`；
           * 产品行只需答「是不是带缺项上线的、缺的是哪几项」，那正是产品页常驻
           * 提示与后续复验要读的东西。
           *
           * step-up 已由路由级 `@RequireStepUp()` 覆盖（四条边都是高危写），
           * 这里不再单独判一次。
           */
          const skipped = pending.rows.map((r) => r.item_code);
          await client.query(
            `UPDATE product.products
                SET launch_override_at = now(),
                    launch_override_by = $2,
                    launch_override_pending = $3::jsonb,
                    updated_at = now()
              WHERE id = $1`,
            [id, req.operator?.id ?? null, JSON.stringify(skipped)],
          );
          await insertOperatorAuditLog(client, req, {
            action: "catalog.product.launch_override",
            resourceType: "product",
            resourceId: id,
            after: {
              reason: reason.slice(0, 512),
              skipped,
              skippedNames: pending.rows.map((r) => r.item_name || r.item_code),
            },
          });
        }
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
   * 删除预览(两步删除第一步)——只读，回一份影响面：能不能删、被什么挡住、删了
   * 会连带处理什么。门户据此把「有客户足迹只能退役 / 连带停用 N 个登录客户端 /
   * 软删 M 个套餐」摊给操作者看清，再走第二步确认。读路由永不 gate step-up。
   */
  @Get(":id/deletion-preview")
  async deletionPreview(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<ProductDeletionImpact> {
    assertCanManage(req);
    const exists = await this.pool.query(
      `SELECT 1 FROM product.products WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (!exists.rows[0]) {
      throw notFound("CATALOG_PRODUCT_NOT_FOUND", "Product not found");
    }
    return this.collectDeletionImpact(req, id);
  }

  /**
   * 删除产品(两步删除第二步)——软删除 `deleted_at`，从目录里彻底消失。与退役的
   * 分工：退役=可见的终态「已退役」(产品曾合法、现下线，老订阅照付)；删除=「本
   * 不该在册」直接隐去(误发布产品的出口)。
   *
   * 判据(owner 2026-08-31)：**无客户足迹即可删**——有用量/账单/开通/权益/上游生效
   * 授权任一者 ⇒ 409，只能退役。删除**不阻塞**于登录客户端：该产品的 `product` 型
   * OIDC 客户端在同事务里停用(status=inactive)，接受产品登录随之中断——这是结果、
   * 不是阻塞项(owner 明确)。
   *
   * 连带：本产品作 primary 组件的套餐一并软删；metrics/webhooks/launch 留库
   * (它们对 products 是 ON DELETE CASCADE，物理清除随将来硬删)。step-up + 审计：
   * 比退役更彻底，闸门不比退役低。
   */
  @Delete(":id")
  @RequireStepUp()
  async remove(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: ProductDeleteBody,
  ): Promise<ProductRecord> {
    assertCanManage(req);
    /* 服务端也要求显式确认——两步删除的第二步不该被一个漏参的 DELETE 顶穿。 */
    if (body?.confirm !== true) {
      throw invalidRequest(
        "DELETION_NOT_CONFIRMED",
        "delete requires confirm=true (two-step deletion)",
        "confirm",
      );
    }
    /* 上游授权检查放事务外(网络调用不进 FOR UPDATE，理由同退役)。有则 409。
       删除对已退役产品也写库，故强制查上游(不吃 deprecated 短路)。 */
    await this.assertNoActiveUpstreamGrants(req, id, {
      skipDeprecatedShortCircuit: true,
    });

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<ProductRow>(
        `SELECT ${SELECT_COLUMNS} FROM product.products
          WHERE id = $1 AND deleted_at IS NULL
          FOR UPDATE`,
        [id],
      );
      const row = current.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        throw notFound("CATALOG_PRODUCT_NOT_FOUND", "Product not found");
      }
      /* 客户足迹复核(事务内、直接 product_id 的表)——防 TOCTOU：预览与执行之间
         新产生的足迹要挡住。上游授权已在事务外查过。 */
      const footprint = await this.readCustomerFootprint(client, id);
      if (footprint.blocked) {
        await client.query("ROLLBACK");
        throw productHasCustomerFootprint(row.product_code, footprint);
      }

      /*
       * ── 删除 = 真删（owner 2026-09-22 裁定）──
       *
       * 「不删除的应该是归档/退役」——那条路是 `status='deprecated'`，行留着、码占着，
       * 对。而删除删的是**本不该在册**的行（无客户足迹），它占着的码位要能拿回来：
       * 软删留下的墓碑会让 `uq_products_product_code` 永久占住那个码，而再也没有任何
       * 恢复路径（全仓找不到把 deleted_at 清回 null 的代码）。
       *
       * ── 为什么先清配置再删主行 ──
       * 25 张表无级联引用 products。上面的足迹检查挡住了「有客户」的那些；剩下的是
       * **运营侧配置**，它们随产品消失才合理，所以在这里显式清掉，而不是改 DDL 的
       * 外键（那是数据模型改动，连带面要另评）。不清的话硬删会撞裸 23503 → 500。
       *
       * 顺序：套餐（连带 versions/components/prices 级联）→ 其余配置 → 主行。
       */
      /* 本产品作 primary 的套餐随它一起走。plans 无 product_id 列，归属经
         plan_components.component_role='primary' 反查。删 plans 会级联掉它的
         versions / components / prices。作 bundled 被别人引用的情况上面已挡。 */
      const plans = await client.query<{ plan_code: string }>(
        `DELETE FROM product.plans
          WHERE id IN (
            SELECT pv.plan_id FROM product.plan_versions pv
              JOIN product.plan_components pc ON pc.plan_version_id = pv.id
             WHERE pc.component_role = 'primary' AND pc.product_id = $1
          )
          RETURNING plan_code`,
        [id],
      );
      /* OIDC 客户端：此前只置 inactive、行留着（靠 product_id 指向软删行成立）。
         主行要真删了，这些行必须一起走，否则外键拦住。登录中断是已接受的后果。 */
      const clients = await client.query<{ client_id: string }>(
        `DELETE FROM appoidc.oidc_clients WHERE product_id = $1
          RETURNING client_id`,
        [id],
      );
      /* 其余运营侧配置与弱引用。都按 product_id 直删，不逐张报数——它们不是客户
         足迹，只是这个产品存在期间留下的配置。 */
      for (const sql of [
        `DELETE FROM kyc.verification_policies WHERE product_id = $1`,
        `DELETE FROM product.solution_products WHERE product_id = $1`,
        `DELETE FROM metering.resource_sharing_policies WHERE product_id = $1`,
        `DELETE FROM provisioning.webhook_deliveries WHERE product_id = $1`,
        `DELETE FROM account.user_product_favorites WHERE product_id = $1`,
        `DELETE FROM support.product_reviews WHERE product_id = $1`,
        `DELETE FROM sharing.visible_set_current WHERE product_id = $1`,
        `DELETE FROM sharing.visible_set_refresh WHERE product_id = $1`,
      ]) {
        await client.query(sql, [id]);
      }

      /* 审计先写：行删掉之后 product_code 就查不回来了。 */
      await insertOperatorAuditLog(client, req, {
        action: "catalog.product.delete",
        resourceType: "product",
        resourceId: row.product_code,
        before: { productCode: row.product_code, status: row.status },
        after: {
          deleted: true,
          removedClients: clients.rows.map((r) => r.client_id),
          removedPlans: plans.rows.map((r) => r.plan_code),
        },
      });

      const deleted = await client.query<ProductRow>(
        `DELETE FROM product.products WHERE id = $1
          RETURNING ${SELECT_COLUMNS}`,
        [id],
      );
      if (deleted.rowCount !== 1) {
        /* 上面 FOR UPDATE 已锁住行，删不掉只能是判据与外键不一致——那是缺陷，
           不是并发。抛出去回滚，别静默返回「已删除」。 */
        throw invalidRequest(
          "PRODUCT_DELETE_BLOCKED",
          `${row.product_code} 未被删除（影响 ${deleted.rowCount ?? 0} 行）——判据与外键约束不一致`,
          "id",
        );
      }
      await client.query("COMMIT");
      return toRecord(deleted.rows[0]!);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 删除影响面(预览与执行前复核共用的只读汇总)。客户足迹走库、上游授权打两个
   * 上游(与退役同一 `fetchActiveUpstreamGrants`，fail-closed)、连带项查套餐与客户端。
   */
  private async collectDeletionImpact(
    req: Request & RequestContext,
    id: string,
  ): Promise<ProductDeletionImpact> {
    const codeRes = await this.pool.query<{ product_code: string }>(
      `SELECT product_code FROM product.products WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    const productCode = codeRes.rows[0]?.product_code;
    if (!productCode) {
      throw notFound("CATALOG_PRODUCT_NOT_FOUND", "Product not found");
    }
    const footprint = await this.readCustomerFootprint(this.pool, id);
    const grants = await fetchActiveUpstreamGrants(
      {
        operatorExchange: this.operatorExchange,
        atlasApiUrl: this.atlasApiUrl,
        runosApiUrl: this.runosApiUrl,
      },
      req,
      productCode,
    );
    const plansRes = await this.pool.query<{ cnt: number }>(
      `SELECT count(*)::int AS cnt FROM product.plans
        WHERE deleted_at IS NULL
          AND id IN (
            SELECT pv.plan_id FROM product.plan_versions pv
              JOIN product.plan_components pc ON pc.plan_version_id = pv.id
             WHERE pc.component_role = 'primary' AND pc.product_id = $1
          )`,
      [id],
    );
    const clientsRes = await this.pool.query<{ client_id: string }>(
      `SELECT client_id FROM appoidc.oidc_clients
        WHERE product_id = $1 AND status = 'active' ORDER BY client_id`,
      [id],
    );
    const blockers: string[] = [];
    if (footprint.hasUsage) blockers.push("HAS_USAGE");
    if (footprint.hasBilling) blockers.push("HAS_BILLING");
    if (footprint.hasProvisioning) blockers.push("HAS_PROVISIONING");
    if (footprint.hasEntitlements) blockers.push("HAS_ENTITLEMENTS");
    if (grants.atlas.count > 0) blockers.push("HAS_UPSTREAM_ATLAS");
    if (grants.runos.count > 0) blockers.push("HAS_UPSTREAM_RUNOS");
    return {
      deletable: blockers.length === 0,
      blockers,
      footprint,
      upstreamAtlas: grants.atlas.count,
      upstreamRunos: grants.runos.count,
      cascade: {
        plans: plansRes.rows[0]?.cnt ?? 0,
        oidcClients: clientsRes.rows.map((r) => r.client_id),
      },
    };
  }

  /**
   * 客户侧足迹——只查直接带 `product_id` 的表(套餐无 product_id，订阅经套餐间接
   * 归属，其效应已由 entitlement_caches/quota_pools 落到直接列上)。一次往返多个
   * EXISTS，够判「删还是只能退役」。
   */
  private async readCustomerFootprint(
    db: Pool | PoolClient,
    id: string,
  ): Promise<CustomerFootprint> {
    const res = await db.query<{
      has_usage: boolean;
      has_billing: boolean;
      has_provisioning: boolean;
      has_entitlements: boolean;
      has_bundled_use: boolean;
    }>(
      /*
       * 2026-09-22：删除改真删（owner 裁定），判据必须**覆盖到硬删会撞的每一张
       * 无级联外键表**——否则删不掉的那些会以裸 23503 → 500 冒出来，而那正是同一天
       * 刚给套餐修掉的毛病。
       *
       * 此前只查 6 张（usage_events / invoice_items / provisionings /
       * entitlement_caches / quota_pools / subscription_entitlement_overrides），
       * 而 `metering.subscriptions`、`billing.orders`、五张 usage_summary_*、
       * usage_gauges、sharing.grants 一张都没查——订阅与订单没被查到尤其要命：
       * 它们正是「卖过」的直接证据。
       *
       * `has_bundled_use` 是另一类：本产品被**别的产品的套餐**当搭售件引用
       * （`component_role = 'bundled'`）。删掉它会把人家的套餐掏空，所以也得挡住。
       * 自己作 primary 的那些不算——那是它自己的套餐，随它一起走。
       */
      `SELECT
         (EXISTS(SELECT 1 FROM metering.usage_events           WHERE product_id = $1)
          OR EXISTS(SELECT 1 FROM metering.usage_gauges        WHERE product_id = $1)
          OR EXISTS(SELECT 1 FROM metering.usage_summary_hours WHERE product_id = $1)
          OR EXISTS(SELECT 1 FROM metering.usage_summary_days  WHERE product_id = $1)
          OR EXISTS(SELECT 1 FROM metering.usage_summary_weeks WHERE product_id = $1)
          OR EXISTS(SELECT 1 FROM metering.usage_summary_months WHERE product_id = $1)
          OR EXISTS(SELECT 1 FROM metering.usage_summary_years WHERE product_id = $1)) AS has_usage,
         (EXISTS(SELECT 1 FROM billing.invoice_items          WHERE product_id = $1)
          OR EXISTS(SELECT 1 FROM billing.orders              WHERE product_id = $1)) AS has_billing,
         EXISTS(SELECT 1 FROM provisioning.provisionings      WHERE product_id = $1) AS has_provisioning,
         (EXISTS(SELECT 1 FROM metering.entitlement_caches    WHERE product_id = $1)
          OR EXISTS(SELECT 1 FROM metering.quota_pools        WHERE product_id = $1)
          OR EXISTS(SELECT 1 FROM metering.subscriptions      WHERE product_id = $1)
          OR EXISTS(SELECT 1 FROM sharing.grants
                     WHERE resource_product_id = $1 OR grantee_product_id = $1)
          OR EXISTS(SELECT 1 FROM metering.subscription_entitlement_overrides WHERE product_id = $1)) AS has_entitlements,
         EXISTS(SELECT 1 FROM product.plan_components
                 WHERE product_id = $1 AND component_role = 'bundled') AS has_bundled_use`,
      [id],
    );
    const r = res.rows[0]!;
    return {
      hasUsage: r.has_usage,
      hasBilling: r.has_billing,
      hasProvisioning: r.has_provisioning,
      hasEntitlements: r.has_entitlements,
      hasBundledUse: r.has_bundled_use,
      blocked:
        r.has_usage ||
        r.has_billing ||
        r.has_provisioning ||
        r.has_entitlements ||
        r.has_bundled_use,
    };
  }

  /**
   * 退役前置：Atlas 的模型授权与 Runos 的能力授权都必须为零。
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
    opts?: { skipDeprecatedShortCircuit?: boolean },
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
       不为一个不会发生的写去打两个上游。删除路径例外（skipDeprecatedShortCircuit）：
       删除对已退役产品**也写库**（软删 + 停用客户端），跳过检查会把上游授权变孤儿，
       与预览无条件查上游的口径也不一致。 */
    if (!opts?.skipDeprecatedShortCircuit && row.status === "deprecated")
      return;

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
  // 复用 product.launch_checklist_items 字典表。归属与门是**表上的两列**
  // （2026-09-17）：
  //   · `owner`（opera | admin）——这一项归谁勾。本路由只读写 `owner = 'opera'`
  //     的项；商业前置两项归 admin，对本接口等同「没有这一项」。
  //   · `gate`（launch | publish）——这一项卡哪一道门。**只有上线门槛用它**，
  //     展示仍按 owner：`acceptance` 归 opera（要人勾）但卡发布门，若展示也按
  //     gate 过滤，它会从抽屉里消失、没人勾得到。
  // 此前两者被揉在一个代码常量（ADMIN_OWNED_ITEM_CODES）里，而「卡哪道门」根本
  // 没有表达处——那正是 acceptance 卡成循环自锁的原因。

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
      edge_upstream: string | null;
      edge_domain: string | null;
      has_secret: boolean;
    }>(
      /* 密文本身不进 SELECT 列表：不回传就不会被回传。取一个布尔即可——
         上线检查要区分「配了密钥」与「没配」,不需要知道配的是什么。 */
      `SELECT home_url, webhook_url, webhook_secret_ref, edge_upstream, edge_domain,
              (webhook_secret_enc IS NOT NULL) AS has_secret
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
          edgeUpstream: row.edge_upstream,
          edgeDomain: row.edge_domain,
          hasWebhookSecret: row.has_secret,
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
   *
   * **并且要校验路径**（2026-09-13 补）。通则把回调路径定死成所有产品同一个
   * `/api/webhooks/vxture`，变的只有域名；而在补上这一条之前，这里只看协议与长度，
   * 于是那条 MUST 在整个组织里没有任何强制点。实测后果是它**零实现**——每个产品
   * 各自取了个名字，而登记、上线检查、投递全程绿色。见 {@link assertStandardWebhookPath}。
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
      edgeUpstream?: string | null;
      edgeDomain?: string | null;
      /**
       * 签名密钥**原文**，只进不出。
       *
       * 三态,不能合并:
       *   · 字段缺席(undefined) → **不动**已存的密钥。运营者改个回调地址不该顺手
       *     把密钥清空,而表单回填不了密文(读接口只回布尔),不这样就必然误清。
       *   · 空串 → 显式清除。
       *   · 有值 → 加密后覆盖。
       */
      webhookSecret?: string | null;
    },
  ): Promise<ProductWebhookRecord> {
    assertCanManage(req);

    const homeUrl = normalizeUrl(body.homeUrl, "homeUrl");
    const webhookUrl = normalizeUrl(body.webhookUrl, "webhookUrl");
    const secretRef = normalizeRef(body.webhookSecretRef);
    const edgeUpstream = normalizeUpstream(body.edgeUpstream);
    const edgeDomain = normalizeDomain(body.edgeDomain);
    const secretTouched = body.webhookSecret !== undefined;
    const secretEnc = secretTouched
      ? encodeWebhookSecret(body.webhookSecret)
      : null;

    /* 先确认产品在。FK 违例会冒成 500，而这里真实的答案是 404——把「产品不存在」
       报成服务器错误，会让人去查服务而不是去查产品码。

       顺带取回 product_code：回调路径的存量登记按产品码记，而这个入口只拿到 uuid。
       多取一列不多一次往返。 */
    const exists = await this.pool.query<{ product_code: string }>(
      `SELECT product_code FROM product.products WHERE id = $1`,
      [id],
    );
    /* 判 `rows[0]` 而不是 `rowCount === 0`：两者在运行时等价，但只有前者能让
       类型收窄——`noUncheckedIndexedAccess` 下 `rows[0]` 是 `T | undefined`，
       而 `rowCount` 的比较不构成对数组元素的证明。 */
    const product = exists.rows[0];
    if (!product) {
      throw notFound("CATALOG_PRODUCT_NOT_FOUND", `Product ${id} not found`);
    }

    /* 路径校验排在存在性之后：产品码不存在时真实的答案是 404，先报 400
       会让人去查地址而不是去查产品码。 */
    assertStandardWebhookPath(webhookUrl, product.product_code);

    const result = await this.pool.query<{
      home_url: string | null;
      webhook_url: string | null;
      webhook_secret_ref: string | null;
      edge_upstream: string | null;
      edge_domain: string | null;
      has_secret: boolean;
    }>(
      /* 密钥那一列走「没碰就保持原样」:$6 为 false 时 UPDATE 分支保留旧值。
         INSERT 分支不需要这个分歧——没有旧值可保。 */
      `INSERT INTO product.product_webhooks
         (product_id, home_url, webhook_url, webhook_secret_ref, edge_upstream, webhook_secret_enc, edge_domain)
       VALUES ($1, $2, $3, $4, $5, $7, $8)
       ON CONFLICT (product_id) DO UPDATE
         SET home_url           = EXCLUDED.home_url,
             webhook_url        = EXCLUDED.webhook_url,
             webhook_secret_ref = EXCLUDED.webhook_secret_ref,
             edge_upstream      = EXCLUDED.edge_upstream,
             edge_domain        = EXCLUDED.edge_domain,
             webhook_secret_enc = CASE WHEN $6 THEN EXCLUDED.webhook_secret_enc
                                       ELSE product.product_webhooks.webhook_secret_enc END,
             updated_at         = now()
       RETURNING home_url, webhook_url, webhook_secret_ref, edge_upstream, edge_domain,
                 (webhook_secret_enc IS NOT NULL) AS has_secret`,
      [
        id,
        homeUrl,
        webhookUrl,
        secretRef,
        edgeUpstream,
        secretTouched,
        secretEnc,
        edgeDomain,
      ],
    );
    const row = result.rows[0]!;
    return {
      homeUrl: row.home_url,
      webhookUrl: row.webhook_url,
      webhookSecretRef: row.webhook_secret_ref,
      edgeUpstream: row.edge_upstream,
      edgeDomain: row.edge_domain,
      hasWebhookSecret: row.has_secret,
    };
  }

  /**
   * 产品的计量指标（`product.product_metrics`）。
   *
   * ── 为什么要补这个入口 ──
   * 这张表此前**全仓只有 seed 在写**——karda 那三个指标(ingest/search/ask)就是硬编码
   * 在 `seed-catalog.mjs` 里的。于是接一个要计量的产品,必须改 seed 再跑一次 db-init,
   * 而 db-init 要走审批门、要冻结合并。一个运营动作被做成了一次发版。
   *
   * 指标键是**跨仓契约**:产品按这个键上报用量(C3 consume),平台按这个键建配额池。
   * 键不存在时 `POST /usage/consume` 直接拒收——这也是为什么它必须先于套餐配置存在。
   */
  @Get(":id/metrics")
  async listMetrics(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<ProductMetricRecord[]> {
    assertCanRead(req);
    const result = await this.pool.query<{
      metric_key: string;
      merge_strategy: string;
      consume_mode: string | null;
      metric_unit: string | null;
      reset_period: string;
      display_name: string | null;
      description: string | null;
    }>(
      /* 中文名住在 `metric_catalog`（key → 名/说明）——它是**键的属性**，两张计量表
         共用一处命名（owner 2026-09-22：更高维度的统一，产品要复用）。
         LEFT JOIN：没命名过的回落显示 metric_key 本身，不阻塞。 */
      `SELECT m.metric_key, m.merge_strategy, m.consume_mode, m.metric_unit,
              m.reset_period, mc.display_name, mc.description
         FROM product.product_metrics m
         LEFT JOIN product.metric_catalog mc ON mc.metric_key = m.metric_key
        WHERE m.product_id = $1
        ORDER BY m.metric_key`,
      [id],
    );
    return result.rows.map((r) => ({
      metricKey: r.metric_key,
      displayName: r.display_name ?? "",
      metricDescription: r.description ?? "",
      mergeStrategy: r.merge_strategy,
      consumeMode: r.consume_mode,
      metricUnit: r.metric_unit,
      resetPeriod: r.reset_period,
    }));
  }

  /**
   * 登记 / 改一个计量指标（按 `metric_key` upsert）。
   *
   * **不做整表替换**：一次 PUT 全量覆盖的话，两个运营者同时编辑就会互相抹掉对方
   * 新加的指标,而且谁都不会收到提示。逐个 upsert + 逐个删,每一次都是一个独立动作。
   *
   * 四条组合约束交给库上的 CHECK(chk_product_metrics_*)——它们本来就在那儿,
   * 在这里再抄一遍就成了两份会各自漂移的规则。但**约束违例要翻译成字段级 400**:
   * 冒上来的 23514 只会显示成「保存失败」。
   */
  /**
   * 给一个计量键定中文名与说明（owner 2026-09-22）。
   *
   * ── 写的是「键」，不是「产品的键」 ──
   * 路径上没有产品 id：命名是键的属性，`member.max` 在所有产品下是同一个名字。
   * 这正是要统一的那件事——此前 display_name 挂在 product_metrics 上，每接一个产品
   * 就会被再命名一遍。
   *
   * 所以**改它会影响所有用到这个键的产品**，界面要说清楚，别让人以为只改了本产品。
   *
   * 空名字 = 删掉命名（回落显示 metric_key 本身）。不给默认值、不自动生成——平台替
   * 产品命名必然错（`varda.enabled` 该叫「Varda 开关」还是「智能体启用」，只有产品
   * 自己知道）。
   */
  @Put("metric-catalog/:metricKey")
  async putMetricName(
    @Req() req: Request & RequestContext,
    @Param("metricKey") metricKey: string,
    @Body() body: { displayName?: unknown; description?: unknown },
  ): Promise<{ metricKey: string; displayName: string; description: string }> {
    assertCanManage(req);
    const key = (metricKey ?? "").trim();
    if (!key || key.length > 64) {
      throw invalidRequest(
        "CATALOG_METRIC_KEY_INVALID",
        "metricKey 非法",
        "metricKey",
      );
    }
    const name =
      typeof body?.displayName === "string" ? body.displayName.trim() : "";
    const desc =
      typeof body?.description === "string" ? body.description.trim() : "";
    if (name.length > 128 || desc.length > 256) {
      throw invalidRequest(
        "CATALOG_METRIC_NAME_TOO_LONG",
        "名称最长 128 字、说明最长 256 字",
        name.length > 128 ? "displayName" : "description",
      );
    }
    const operatorId = req.operator?.id ?? null;

    if (!name) {
      /* 空名字 = 撤销命名。整行删掉而不是留个空串——「没命名过」与「命名成空」
         不该是两个态。 */
      await this.pool.query(
        `DELETE FROM product.metric_catalog WHERE metric_key = $1`,
        [key],
      );
      return { metricKey: key, displayName: "", description: "" };
    }

    const res = await this.pool.query<{
      display_name: string;
      description: string | null;
    }>(
      `INSERT INTO product.metric_catalog
         (metric_key, display_name, description, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (metric_key) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             description  = EXCLUDED.description,
             updated_by   = EXCLUDED.updated_by,
             updated_at   = now()
       RETURNING display_name, description`,
      [key, name, desc || null, operatorId],
    );
    const row = res.rows[0]!;
    return {
      metricKey: key,
      displayName: row.display_name,
      description: row.description ?? "",
    };
  }

  @Put(":id/metrics/:metricKey")
  async putMetric(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Param("metricKey") metricKey: string,
    @Body()
    body: {
      mergeStrategy?: string;
      consumeMode?: string | null;
      metricUnit?: string | null;
      resetPeriod?: string | null;
    },
  ): Promise<ProductMetricRecord> {
    assertCanManage(req);

    const key = (metricKey ?? "").trim();
    if (!key || key.length > 64) {
      throw invalidRequest(
        "VALIDATION_FORMAT",
        "指标键为空或超过 64 字符",
        "metricKey",
      );
    }
    const strategy = (body.mergeStrategy ?? "").trim();
    if (!["max", "union", "pool", "tiered"].includes(strategy)) {
      throw invalidRequest(
        "VALIDATION_ENUM",
        "合并策略取 max / union / pool / tiered",
        "mergeStrategy",
      );
    }
    const mode = (body.consumeMode ?? "").trim() || null;
    /* pool 型必须给消耗模式——库上有 chk_product_metrics_pool_consume,
       但那条冒上来是 23514,运营者只看到「保存失败」。 */
    if (strategy === "pool" && !["divisible", "atomic"].includes(mode ?? "")) {
      throw invalidRequest(
        "VALIDATION_REQUIRED",
        "pool 型指标必须给出消耗模式（divisible / atomic）",
        "consumeMode",
      );
    }
    if (strategy !== "pool" && mode) {
      throw invalidRequest(
        "VALIDATION_CONFLICT",
        "只有 pool 型才有消耗模式",
        "consumeMode",
      );
    }
    const reset = (body.resetPeriod ?? "").trim() || "none";
    if (!["none", "day", "month"].includes(reset)) {
      throw invalidRequest(
        "VALIDATION_ENUM",
        "重置周期取 none / day / month",
        "resetPeriod",
      );
    }
    /* 重置周期只对 pool 型有意义(chk_product_metrics_reset_scope)。 */
    if (strategy !== "pool" && reset !== "none") {
      throw invalidRequest(
        "VALIDATION_CONFLICT",
        "只有 pool 型才有重置周期",
        "resetPeriod",
      );
    }
    const unit = ((body.metricUnit ?? "").trim() || null)?.slice(0, 32) ?? null;

    const exists = await this.pool.query(
      `SELECT 1 FROM product.products WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (exists.rowCount === 0) {
      throw notFound("CATALOG_PRODUCT_NOT_FOUND", `Product ${id} not found`);
    }

    /*
     * L0 平台指标键不许被产品级重新定义（95 的 trg_product_metrics_no_platform_shadow）。
     *
     * 上面四条 CHECK 都在这里前置判过，理由写在 pool/consumeMode 那条旁边：
     * 「库上有约束，但那条冒上来是 23514，运营者只看到『保存失败』」。**这条触发器
     * 当时漏了**，而它比那四条更难懂——抛的是一句英文内部消息，点名的还是一份
     * 运营者没见过的文档编号。
     *
     * 判据**逐字照抄触发器**：按 metric_key 存在即拦，**不带 status 过滤**。
     * 库里六个键有四个是 `reserved`（compute.cpu / compute.gpu / egress.bytes /
     * ingress.bytes），按直觉加上 `status = 'active'` 会让这四个仍然 500——而那是
     * 最难查的形态：界面看起来做了校验，偏偏对一半的键失效。
     */
    const shadow = await this.pool.query<{ status: string | null }>(
      `SELECT status FROM product.platform_metrics WHERE metric_key = $1`,
      [key],
    );
    if (shadow.rowCount && shadow.rowCount > 0) {
      const status = shadow.rows[0]?.status ?? null;
      throw conflict(
        "CATALOG_METRIC_KEY_IS_PLATFORM_OWNED",
        `「${key}」是平台级共享指标${status === "reserved" ? "（已保留，尚未启用）" : ""}，产品不能重新定义它。` +
          `共享指标的额度由套餐组件贡献，不在这里登记；本产品自己的指标请换一个键。`,
      );
    }

    const result = await this.pool.query<{
      metric_key: string;
      merge_strategy: string;
      consume_mode: string | null;
      metric_unit: string | null;
      reset_period: string;
    }>(
      `INSERT INTO product.product_metrics
         (product_id, metric_key, merge_strategy, consume_mode, metric_unit, reset_period)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (product_id, metric_key) DO UPDATE
         SET merge_strategy = EXCLUDED.merge_strategy,
             consume_mode   = EXCLUDED.consume_mode,
             metric_unit    = EXCLUDED.metric_unit,
             reset_period   = EXCLUDED.reset_period
       RETURNING metric_key, merge_strategy, consume_mode, metric_unit, reset_period`,
      [id, key, strategy, mode, unit, reset],
    );
    const row = result.rows[0]!;
    /* 命名不在本表里，upsert 之后补读一次——读与写两处形状必须一致，否则调用方
       会拿到一个「有时有名字、有时没有」的记录。 */
    const named = await this.pool.query<{
      display_name: string | null;
      description: string | null;
    }>(
      `SELECT display_name, description FROM product.metric_catalog
        WHERE metric_key = $1`,
      [row.metric_key],
    );
    return {
      metricKey: row.metric_key,
      displayName: named.rows[0]?.display_name ?? "",
      metricDescription: named.rows[0]?.description ?? "",
      mergeStrategy: row.merge_strategy,
      consumeMode: row.consume_mode,
      metricUnit: row.metric_unit,
      resetPeriod: row.reset_period,
    };
  }

  /**
   * 退掉一个指标。
   *
   * 已被套餐组件引用的指标不许退——先查再报 409,说清是被哪几档挡着:运营者要的是
   * 「去哪儿解开」,不是「失败了」。
   *
   * 这段注释原本写的是「FK 会挡,但那是一句 500」。**没有 FK**(实测 pg_constraint
   * 里指向 product_metrics 的约束是零行),而那比有 FK 更糟:套餐组件按 `quota`
   * jsonb 的键名引用指标,字符串引用没有引用完整性,删掉定义之后**什么都不会发生**
   * ——直到某个客户的额度对不上。检查见方法体。
   */
  @Delete(":id/metrics/:metricKey")
  async deleteMetric(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Param("metricKey") metricKey: string,
  ): Promise<{ deleted: boolean }> {
    assertCanManage(req);

    /*
     * 先查还有谁在用这个键。
     *
     * 本方法的注释原本写着「已被套餐组件引用的指标删不掉——FK 会挡，但那是一句 500。
     * 这里先查再报 409」。**两头都不成立**：`product_metrics` 上没有任何外键指向它
     * （实测 pg_constraint 零行），而实现就是一条裸 DELETE。
     *
     * 没有 FK 不是「更安全」，是**更危险**：套餐组件按 `quota` jsonb 的**键名**引用
     * 指标（`{"doc.words": 1000000}`），字符串引用没有引用完整性。删掉定义之后组件
     * 上那个键还在，只是再也解析不出 merge_strategy / consume_mode / reset_period
     * ——配额物化拿不到池的形状。**不报错，不回滚，什么都不会发生**，直到某个客户
     * 的额度对不上。
     *
     * 所以这道检查不是把 500 换成 409，是把「静默损坏」换成「说得出会毁掉什么」。
     * 用 `jsonb_exists(quota, $2)` 而不是 `quota ? $2`：功能形式没有把 `?` 当占位符
     * 的歧义，各层驱动看着都一样。
     */
    const inUse = await this.pool.query<{ plan_name: string; tier: string }>(
      `SELECT DISTINCT coalesce(pl.plan_name, pl.plan_code) AS plan_name,
                       coalesce(pc.tier, '-') AS tier
         FROM product.plan_components pc
         JOIN product.plan_versions pv ON pv.id = pc.plan_version_id
         JOIN product.plans pl ON pl.id = pv.plan_id
        WHERE pc.product_id = $1
          AND pc.quota IS NOT NULL
          AND jsonb_exists(pc.quota, $2)
        ORDER BY plan_name, tier`,
      [id, metricKey],
    );
    if (inUse.rowCount && inUse.rowCount > 0) {
      const where = inUse.rows
        .map((r) => `${r.plan_name}（${r.tier}）`)
        .join("、");
      throw conflict(
        "CATALOG_METRIC_IN_USE",
        `「${metricKey}」还被这些套餐档位的配额引用着：${where}。` +
          `删掉指标定义不会连带清掉这些配额键，它们会变成解析不出池形状的孤儿。` +
          `已发布的套餐版本是不可变的——要去掉这个配额项，得开一个新的套餐版本，` +
          `而不是改现有版本。`,
      );
    }

    const result = await this.pool.query(
      `DELETE FROM product.product_metrics
        WHERE product_id = $1 AND metric_key = $2`,
      [id, metricKey],
    );
    return { deleted: (result.rowCount ?? 0) > 0 };
  }

  @Get(":id/checklist")
  async getChecklist(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<ChecklistItemRecord[]> {
    assertCanRead(req);
    const result = await this.pool.query<ChecklistRow>(
      `SELECT i.item_code, i.item_name, i.description, i.is_required, i.gate, i.sort,
              s.is_satisfied, s.checked_at, s.remark
         FROM product.launch_checklist_items i
         LEFT JOIN product.product_launch_statuses s
           ON s.item_code = i.item_code AND s.product_id = $1
        WHERE i.owner = 'opera'
        ORDER BY i.sort ASC`,
      [id],
    );
    return result.rows.map(toChecklistRecord);
  }

  @Patch(":id/checklist/:itemCode")
  async setChecklistItem(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Param("itemCode") itemCode: string,
    @Body()
    body: {
      isSatisfied?: boolean;
      remark?: string | null;
      /**
       * `"auto"` = 这一笔来自上线复验的实测结果，不是人手勾的。
       *
       * 只有它能写「机器判定」的那几项，而且写进去的 `checked_by` 是 NULL
       * ——`product_launch_statuses.checked_by` 的 DDL 注释从一开始就写着
       * 「自动校验为 NULL」，这张表早就预留了这个位置，只是没人用。
       */
      source?: "auto" | "manual";
    },
  ): Promise<ChecklistItemRecord> {
    assertCanManage(req);
    /* 存在性与归属**一次查清**：字典里没有的码若不查就会一路走到 INSERT 撞 FK
       冒成 500——而真实的答案是 404；admin 拥有的项字典里有、但不归 opera，对本
       接口同样是「没有这一项」。两者以前分两步（查存在 + 查代码常量），归属搬进
       库以后就是同一行数据，合成一次读。 */
    const known = await this.pool.query<{ owner: string }>(
      `SELECT owner FROM product.launch_checklist_items WHERE item_code = $1`,
      [itemCode],
    );
    if (known.rowCount === 0 || known.rows[0]!.owner !== "opera") {
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
    /*
     * 机器判定的项不收人工勾选。
     *
     * 此前这个端点对所有项一视同仁，于是「复验判失败 → 运营者手动勾上 → 闸门放行」
     * 是一条走得通的路，而且**事后看不出来**：机器写和人工写都记成同一个
     * `checked_by = operatorId`，DDL 预留的「自动校验为 NULL」从没被用过。
     *
     * 判据来源是 `@vxture/core-utils` 的 `AUTO_DETERMINED_CHECKLIST_ITEMS`——
     * opera 的复验页据它决定写不写回，这里据它决定收不收，两边同一份。
     *
     * 给的是 409 不是 403：这不是权限不够（有 manage 权限的人也不该勾），
     * 是这一项的值不由人决定。
     */
    const isAuto = isAutoDeterminedChecklistItem(itemCode);
    const fromAuto = body.source === "auto";
    if (isAuto && !fromAuto) {
      throw conflict(
        "CATALOG_CHECKLIST_ITEM_AUTO_DETERMINED",
        `「${itemCode}」由平台实测判定，不能手工勾选或取消。去产品的「上线复验」页跑一次，结果会自动写回。`,
      );
    }
    /* 反过来也挡：`source: "auto"` 不能拿去写人工项。否则复验页一个笔误就能把
       `acceptance`（端到端验收，必须人来判）写成一条无人署名的通过。 */
    if (!isAuto && fromAuto) {
      throw invalidRequest(
        "VALIDATION_INVALID_VALUE",
        `「${itemCode}」不是机器判定项，不接受 source=auto。`,
        "source",
      );
    }

    /* 机器判定的写入不署名（DDL：自动校验为 NULL），人工勾选署操作者。
       这让「这一项是谁说通过的」在数据里答得出来——此前答不出来。 */
    const checkedBy = fromAuto ? null : (req.operator?.id ?? null);

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
      [id, itemCode, body.isSatisfied, checkedBy, remark],
    );
    const result = await this.pool.query<ChecklistRow>(
      `SELECT i.item_code, i.item_name, i.description, i.is_required, i.gate, i.sort,
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

/*
 * ADMIN_OWNED_ITEM_CODES 与 isOperaChecklistItem 已于 2026-09-17 删除。
 *
 * 那个常量的注释自己写着：「真正的归属轴该是表上的一列……到那天把这个集合连同
 * isOperaChecklistItem 一起删掉，SQL 改按列过滤」。归属列（`owner`）与门列（`gate`）
 * 已随 2026-10-07-checklist-gate-owner.sql 落库，本文件的四处 SQL 改按列过滤：
 *
 *   展示 / 写入归属  → `i.owner = 'opera'`
 *   上线门槛         → `i.gate  = 'launch'`
 *
 * 两者**有意不同口径**：归属回答「归谁勾」，门回答「卡哪道」。acceptance 归 opera
 * 但卡 publish——它要的端到端链路需要产品先能被订阅，而订阅需要产品已上线，卡在
 * 上线门上就是自锁。
 */

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
    parts.push(`Atlas ${grants.atlas.count} 条模型授权`);
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

/**
 * 409 `PRODUCT_HAS_CUSTOMER_FOOTPRINT`：产品已有客户使用记录，删除被拒——只能退役。
 *
 * 与 `productHasActiveGrants` 同套形状(自带 `code` 的响应体，`AllExceptionsFilter`
 * 把额外字段原样带出)：门户拿到明细就能给出「有客户在用，改走退役」的准确文案，
 * 而不是只被告知「你不能」。
 */
export function productHasCustomerFootprint(
  productCode: string,
  footprint: {
    hasUsage: boolean;
    hasBilling: boolean;
    hasProvisioning: boolean;
    hasEntitlements: boolean;
  },
): HttpException {
  const parts: string[] = [];
  if (footprint.hasUsage) parts.push("用量记录");
  if (footprint.hasBilling) parts.push("账单");
  if (footprint.hasProvisioning) parts.push("开通记录");
  if (footprint.hasEntitlements) parts.push("生效权益");
  return new HttpException(
    {
      code: "PRODUCT_HAS_CUSTOMER_FOOTPRINT",
      message: `${productCode} 已有客户使用记录（${parts.join("、")}），不能删除——请改用退役。`,
      retryable: false,
      statusCode: HttpStatus.CONFLICT,
      productCode,
      footprint,
    },
    HttpStatus.CONFLICT,
  );
}

export interface ProductWebhookRecord {
  homeUrl: string | null;
  webhookUrl: string | null;
  /** 密钥**引用**（旧路径：ref → 容器环境变量）。不是密钥本体。 */
  webhookSecretRef: string | null;
  /**
   * 边缘上游：智能体在 tailnet 上的 `host:port`。
   *
   * 填了它,边缘那份 `*.vxture.com` 兜底 vhost 下次同步就会把该子域转到这里——
   * **接一个智能体不再需要往仓里手写一份 vhost**。精确 server_name 的既有产品
   * (arda/atlas/karda/runos/vxtpl)按 nginx 匹配优先级照旧走自己那份,不受影响。
   */
  edgeUpstream: string | null;
  /**
   * 边缘域名。表单预填 `{product_code}.vxture.com` 但**可改**。
   *
   * 此前域名全靠渲染器拼字符串，而推导已经在失效：anlan → anlan.ai、
   * xuanzhen → xuanzhen.ai 这两个 L3 智能体是异 apex，推导给出的域名根本不存在，
   * 且不报错。加这一列后推导降级成默认值，不再是唯一规则。
   */
  edgeDomain: string | null;
  /**
   * 是否已登记签名密钥(新路径,密文落库)。
   *
   * **只回布尔,永不回传密文或原文**——密钥本体一旦能从读接口拿到,
   * 「落库加密」这件事就白做了。要换密钥就重填一次,不提供「看一眼现在是什么」。
   */
  hasWebhookSecret: boolean;
}

export interface ProductMetricRecord {
  /** 跨仓契约键：产品按它上报用量，平台按它建配额池。 */
  metricKey: string;
  /**
   * 中文名与一句话说明——住在 `product.metric_catalog`（key → 名/说明），是**键的
   * 属性**而不是「(产品, 键)」的属性：同一个 `member.max` 不该每接一个产品就被再
   * 命名一遍（owner 2026-09-22：更高维度的统一，产品要复用）。
   * 没命名过时为空串，界面回落显示 metricKey 本身——平台不替产品命名。
   */
  displayName: string;
  metricDescription: string;
  /** max / union / pool / tiered */
  mergeStrategy: string;
  /** 仅 pool 型非空：divisible / atomic */
  consumeMode: string | null;
  metricUnit: string | null;
  /** none / day / month；仅 pool 型可非 none。 */
  resetPeriod: string;
}

export interface ChecklistItemRecord {
  itemCode: string;
  itemName: string;
  description: string | null;
  isRequired: boolean;
  /** 卡哪一道门：`launch` = 上线前必满足；`publish` = 发布前才要（不卡上线）。 */
  gate: string;
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
  gate: string;
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
    gate: row.gate,
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

/**
 * 通则 §C3 下发 规定的回调路径。**所有产品同一个**，变的只有域名。
 *
 * 三段各答一问：`api` 说明这是机器接口、不与产品的前端路由抢地址；`webhooks` 说明
 * 入站、外部来源、必须验签；`vxture` 说明谁发的，产品将来接第二家时
 * `/api/webhooks/<对方>` 自然并列。**版本不进路径**——URL 在这里按产品登记一次，
 * 把版本写进路径等于每次信封升级都要逐个产品改登记。
 */
const STANDARD_WEBHOOK_PATH = "/api/webhooks/vxture";

/**
 * 仍登记在旧路径上的存量产品。**带失效条件的登记，不是永久豁免。**
 *
 * 键是 `product_code`，值是它迁移前允许保留的那个路径。列在这里的产品仍可保存
 * webhook 行（比如轮换密钥），不至于因为这道闸门被卡在一次运维操作上；
 * **但它们只能保存自己那一个旧值，换成第三个路径同样会被拒**。
 *
 * 不在表里的产品一律按新规则判——这正是 D-2：新接入的产品没有「存量迁移」档。
 * 一个没列在这里的产品撞上这道闸门，正确的反应是**让那个产品迁到标准路径**，
 * 而不是往这张表里再加一行；加行要连同下面的失效条件一起写。
 *
 * **失效条件**：对应产品完成 X-4 三步迁移（① 产品侧同时能收新旧两个路径并上线；
 * ② 这里把登记地址改成标准路径；③ 产品侧撤掉旧路由）之后，删掉它那一行。
 * 三行全空时，连同这张表和 `legacyPathFor` 一起删掉。
 *
 * 为什么只有这两个：全仓检索的结果是 vxtpl 与 yucer 各自有一个
 * `app/provisioning/webhook/route.ts`，注释都标着「product_200 section 4」
 * ——而那一节通篇只规定义务、**从没规定过路径**。两个产品各自造了同一个名字，
 * 又互相成了对方的先例。其余产品的登记值这里读不到，它们会在这道闸门上现形，
 * 那是这道闸门该做的事。
 */
const LEGACY_WEBHOOK_PATHS = new Map<string, string>([
  ["vxtpl", "/provisioning/webhook"],
  ["yucer", "/provisioning/webhook"],
]);

/**
 * 回调地址的**路径**必须是通则规定的那一个。
 *
 * **为什么这道闸门必须在登记处而不是在投递处。** 投递处发现路径不对已经太晚：
 * 那时错的表现是对方返 404，或者——更常见也更糟——落到对方前端的 SPA catch-all
 * 拿回 `index.html` 和 **HTTP 200**，于是投递被判为送达，开通与档位变更静默消失，
 * 两侧都不报错。登记是这件事唯一的**单一咽喉**：每个产品的回调地址都从这里进库。
 *
 * 空值放行：三项都允许留空是这个入口的既有语义（运营者常常先拿到地址、密钥还没
 * 签发），这道闸门不改它。
 */
function assertStandardWebhookPath(
  url: string | null,
  productCode: string,
): void {
  if (url === null) return;

  /* 到这里 url 已经过 normalizeUrl，一定 parse 得动。 */
  const path = new URL(url).pathname;
  if (path === STANDARD_WEBHOOK_PATH) return;

  const legacy = LEGACY_WEBHOOK_PATHS.get(productCode);
  if (legacy !== undefined && path === legacy) return;

  throw invalidRequest(
    "VALIDATION_INVALID_VALUE",
    legacy !== undefined
      ? `webhookUrl 的路径必须是 ${STANDARD_WEBHOOK_PATH}（通则 §C3 下发：所有产品同一个路径，变的只有域名）。` +
          `${productCode} 作为存量产品可以暂时保留 ${legacy}，但不能改成第三个值 ${path}。`
      : `webhookUrl 的路径必须是 ${STANDARD_WEBHOOK_PATH}（通则 §C3 下发：所有产品同一个路径，变的只有域名），` +
          `收到的是 ${path}。${productCode} 不在存量登记里——正确的做法是让产品迁到标准路径，` +
          `而不是在平台侧迁就它：路径不一致时投递可能落到对方前端的 SPA 并拿回 200，` +
          `表现为「一切正常但产品什么都没收到」。`,
    "webhookUrl",
  );
}

/** 密钥**引用**不是密钥本体，不做 URL 校验；只拦长度（DDL varchar(128)）。 */
/**
 * 边缘上游的形状：`host:port`。
 *
 * 库上也有 CHECK，这里再判一次是为了**报得准**：库的 CHECK 冒上来是一句
 * 23514 约束违例，运营者只会看到「保存失败」;这里给的是字段级 400,直接说
 * 哪个字段、要什么形状。而且这个值会原样渲进 nginx 配置——带空格或分号的值
 * 会让边缘同步时 `nginx -t` 失败,那时人早已离开登记现场。
 */
/**
 * 端：去重、排序、逐个查受管枚举。
 *
 * 域外值**当场拒绝**而不是靠库上的 CHECK——CHECK 冒上来是一句 23514，
 * 运营者只看到「保存失败」；这里给的是字段级 400，说清是哪个值不在表里。
 * （库上那条 CHECK 仍然留着：判据写在数据层才挡得住绕过接口的写入。）
 */
function normalizeSurfaces(input: string[] | undefined): string[] {
  if (!input || input.length === 0) return [];
  const out: string[] = [];
  for (const raw of input) {
    const v = (raw ?? "").trim();
    if (v === "") continue;
    if (!isValidProductSurface(v)) {
      throw invalidRequest(
        "VALIDATION_INVALID_VALUE",
        `surface must be one of ${PRODUCT_SURFACES.join(", ")}`,
        "surfaces",
      );
    }
    if (!out.includes(v)) out.push(v);
  }
  return out.sort();
}

/**
 * 端的整组替换。先删后插，同一事务内。
 *
 * 不做「差集增删」：这张表只有主键两列，没有可保留的行内状态，diff 换不来任何
 * 东西，却要多一次查询和一段容易写错的集合运算。
 */
async function replaceSurfaces(
  client: Queryable,
  productId: string,
  surfaces: string[],
): Promise<void> {
  await client.query(
    `DELETE FROM product.product_surfaces WHERE product_id = $1`,
    [productId],
  );
  if (surfaces.length > 0) {
    await client.query(
      `INSERT INTO product.product_surfaces (product_id, surface)
       SELECT $1, unnest($2::text[])`,
      [productId, surfaces],
    );
  }
}

function normalizeUpstream(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (raw === "") return null;
  if (!/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?:[0-9]{1,5}$/.test(raw)) {
    throw invalidRequest(
      "VALIDATION_FORMAT",
      "边缘上游要写成 host:port（如 <tailnet-ip>:4050），不带协议、路径或空格",
      "edgeUpstream",
    );
  }
  const port = Number(raw.slice(raw.lastIndexOf(":") + 1));
  if (port < 1 || port > 65535) {
    throw invalidRequest(
      "VALIDATION_RANGE",
      "端口要在 1–65535 之间",
      "edgeUpstream",
    );
  }
  return raw;
}

/**
 * 边缘域名的形状：主机名。**不带协议、路径、端口**（端口在 edgeUpstream 那一列）。
 *
 * 这个值会原样进 nginx 的 map，一个带协议或斜杠的值会让边缘同步时 `nginx -t` 失败——
 * 而那时人早已离开登记现场。库上也有同款 CHECK；这里先判是为了给字段级 400。
 */
function normalizeDomain(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim().toLowerCase();
  if (raw === "") return null;
  if (
    !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(
      raw,
    )
  ) {
    throw invalidRequest(
      "VALIDATION_FORMAT",
      "边缘域名只写主机名（如 tenderforge.vxture.com），不带协议、路径或端口",
      "edgeDomain",
    );
  }
  if (raw.length > 255) {
    throw invalidRequest(
      "VALIDATION_TOO_LONG",
      "域名超过 255 字符",
      "edgeDomain",
    );
  }
  return raw;
}

/**
 * 签名密钥：原文进来，密文出去。空串 = 显式清除（返回 null）。
 *
 * 主密钥 `PLATFORM_WEBHOOK_ENC_KEY` **只有一个,永不随产品增长**——这正是与旧做法
 * (每产品一个 `{CODE}_PROVISION_WEBHOOK_SECRET`)的区别:接一个智能体不用改 .env。
 *
 * 主密钥没配时**拒绝写入**,不静默存明文:一个以为自己被加密了的明文密钥,
 * 比一个明说存不了的错误危险得多。
 */
function encodeWebhookSecret(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (raw === "") return null;
  const master = process.env.PLATFORM_WEBHOOK_ENC_KEY;
  if (!master) {
    throw invalidRequest(
      "SECRET_KEY_UNCONFIGURED",
      "平台未配置 PLATFORM_WEBHOOK_ENC_KEY，无法加密存储签名密钥",
      "webhookSecret",
    );
  }
  if (raw.length < 16) {
    throw invalidRequest(
      "VALIDATION_TOO_SHORT",
      "签名密钥至少 16 位",
      "webhookSecret",
    );
  }
  return encryptSecret(raw, deriveSecretKey(master));
}

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

export function validateWrite(
  body: ProductWriteBody,
  /** `requireCode` 缺省随 `requireCore`——只有「改」显式传 false（产品码不可改）。 */
  opts: { requireCore: boolean; requireCode?: boolean },
): void {
  /* `new` 被 opera 的「接入产品」页占用（`/product/catalog/new`，静态段优先于
     `[productCode]`）。登记成产品码的话，这个产品的页面永远打不开。 */
  if (body.productCode?.trim() === "new") {
    throw invalidRequest(
      "VALIDATION_RESERVED",
      "产品码 new 是保留字：opera 的「接入产品」页占用了这个地址",
      "productCode",
    );
  }
  if (opts.requireCore) {
    if ((opts.requireCode ?? true) && !body.productCode?.trim()) {
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
  // product_type 走受管枚举(@vxture/core-utils 单一权威源),不再自由输入。
  // create/update 只要带了 productType 就校验;历史遗留值经此写入面一律被挡下、需改成枚举值。
  if (body.productType && !isValidProductType(body.productType.trim())) {
    throw invalidRequest(
      "VALIDATION_INVALID_VALUE",
      `productType must be one of ${PRODUCT_TYPES.join(", ")}`,
      "productType",
    );
  }
  // layer 同样走受管值域（@vxture-platform/shared 单一权威源，DDL 有 chk_products_layer）。
  // 空串按「不分层」处理：下拉的「未分类」选项送的就是空串。
  if (body.layer && !isValidProductLayer(body.layer.trim())) {
    throw invalidRequest(
      "VALIDATION_INVALID_VALUE",
      `layer must be one of ${PRODUCT_LAYERS.join()}`,
      "layer",
    );
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

// ─────────────────────────────────────────────────────────────────────────────
// 写入本体。**在调用方的事务里跑**，由 `PUT :id` / `POST` 与产品接入的合并保存
// （`product-onboarding.router.ts`）共用——同一批字段只有一份写法，两个入口的
// 校验、缺席语义与善后不会各自漂。
// ─────────────────────────────────────────────────────────────────────────────

/** 产品码撞车：`uq_products_product_code` 冒上来是 23505、也就是 500 和一句英文约束名。 */
function mapProductCodeTaken(
  error: unknown,
  code: string | undefined,
): unknown {
  if ((error as { code?: string }).code === "23505") {
    return conflict(
      "CATALOG_CODE_TAKEN",
      `产品码「${code?.trim() ?? ""}」已经被别的产品占用了。`,
    );
  }
  return error;
}

/**
 * 登记一个产品（草稿）。调用方先跑过 `validateWrite(body, { requireCore: true })`。
 *
 * 产品行与端在同一个事务里：端是关系表，分两次写的话「产品建好了但端没写进去」是一个
 * 看不出来的半截状态——产品照常显示，只是它在如影端永远不出现。
 */
export async function insertProductTx(
  client: Queryable,
  body: ProductWriteBody,
  operatorId: string | null,
): Promise<ProductRecord> {
  const surfaces = normalizeSurfaces(body.surfaces);
  const row = await client
    .query<ProductRow>(
      /*
       * `sort` 显式取 max+1，让新产品落在目录**末尾**。
       *
       * 不写它的话拿列默认值 0，而存量产品在第一次用「上移/置顶」之后已被重排成
       * 1..n——0 比谁都小，于是每接一个新产品，它就自动抢到目录第一位，官网
       * /appcenter 首屏也跟着换人。没有任何报错，只是位置错了。
       *
       * ── 这不是「opera 也能排序」──
       * owner 2026-09-22 定：**排序控制权只在 admin 一处**（营销运营管，决定页面
       * 陈列），其余一律跟随。这里没有任何次序的选择权——新产品一律落末尾，
       * 排到哪由营销运营去 admin 决定。opera 全仓不得出现改 `sort` 的 UPDATE，
       * 这条由 products-reorder.spec.ts 的「唯一写入方」用例钉着。
       *
       * 空表时 max 为 NULL，coalesce 兜到 0 ⇒ 第一个产品拿 1。
       */
      `INSERT INTO product.products (
         product_code, product_type, category_id, product_name, product_nick,
         description, capability_keys, tags, standalone_subscribable, status,
         is_customer_visible, is_workforce_visible, origin, origin_provider,
         icon_url, created_by, updated_by, layer, sort
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10, $11, $12, $13, $14, $15, $15, $16,
         (SELECT coalesce(max(sort), 0) + 1 FROM product.products)
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
        body.iconUrl?.trim() || null,
        operatorId,
        body.layer?.trim() || null,
      ],
    )
    .then((r) => r.rows[0]!)
    .catch((error: unknown) => {
      throw mapProductCodeTaken(error, body.productCode);
    });
  if (surfaces.length > 0) {
    await client.query(
      `INSERT INTO product.product_surfaces (product_id, surface)
       SELECT $1, unnest($2::text[])`,
      [row.id, surfaces],
    );
  }
  /* RETURNING 里的端子查询在插入端之前就求过值了，回传的会是空数组——
     用刚写进去的值补上，而不是再查一次库。 */
  return { ...toRecord(row), surfaces };
}

/**
 * 改一个产品。调用方先跑过 `validateWrite(body, { requireCore: true, requireCode: false })`。
 */
export async function updateProductTx(
  client: Queryable,
  id: string,
  body: ProductWriteBody,
  operatorId: string | null,
): Promise<ProductRecord & { pinnedEdgeDomain?: string }> {
  /* 端**字段缺席 = 不动**（undefined），传了数组才整组替换。
     「改个产品名」不该顺手把端清空。 */
  const surfaces =
    body.surfaces === undefined ? null : normalizeSurfaces(body.surfaces);

  /*
   * ── 产品码：草稿态可改，启用后锁定（owner 2026-09-11）──
   *
   * `FOR UPDATE` 锁住这一行再判：不锁的话，「读到 draft → 另一个会话把它启用
   * → 这边照样改码」这条竞态是存在的，而产品一旦启用就有客户足迹。
   */
  const current = await client.query<{
    product_code: string;
    status: string;
  }>(
    `SELECT product_code, status FROM product.products
      WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
    [id],
  );
  const before = current.rows[0];
  if (!before) {
    throw notFound("CATALOG_PRODUCT_NOT_FOUND", "Product not found");
  }
  const wantedCode = body.productCode?.trim();
  const codeChange =
    wantedCode !== undefined &&
    wantedCode !== "" &&
    wantedCode !== before.product_code;
  if (codeChange && before.status !== "draft") {
    /* 明确报错，不静默忽略。收下一个新值、校验通过、然后被 SET 列表丢掉，
       会给运营者「我已经改了」的错觉——那比拒绝更糟。 */
    const label = STATE_LABELS[before.status as ProductState] ?? before.status;
    throw conflict(
      "CATALOG_CODE_LOCKED",
      `产品码只能在草稿状态修改。「${before.product_code}」已经是${label}状态——它的客户端配置、边缘路由与已售订阅都按这个码在走。`,
    );
  }

  /*
   * ── 善后：改码之前先把推导出来的边缘域名钉死 ──
   *
   * `edge_domain` 为空时，边缘路由表按 `{产品码}.vxture.com` 推导。于是改码
   * **等于换域名**，而 DNS 还指着旧的那个——下一次 deploy 渲染路由表时，旧域名
   * 从表里消失，访问它的人拿到 444（无响应关闭），没有任何一处会报错。
   * 所以在改码的同一个事务里，把当时**实际生效的**那个域名写成显式值。
   * 只在真的走边缘路由时才钉（`edge_upstream` 有值）。
   */
  let pinnedDomain: string | null = null;
  if (codeChange) {
    const pin = await client.query<{ edge_domain: string }>(
      `UPDATE product.product_webhooks
          SET edge_domain = $2, updated_at = now()
        WHERE product_id = $1
          AND coalesce(edge_domain, '') = ''
          AND coalesce(edge_upstream, '') <> ''
        RETURNING edge_domain`,
      [id, `${before.product_code}.vxture.com`],
    );
    pinnedDomain = pin.rows[0]?.edge_domain ?? null;
  }

  /*
   * ── 缺席即不改 ──
   * 原先 SET 列表取值一律 `body.x ?? 默认值`，于是**任何送部分字段的客户端都会把它
   * 没送的列抹掉**——接口回 200、界面提示保存成功，而那几个字段本来就不在页面上。
   * **三态**：键不在 = 不改；显式 null / 空串 = 清空；有值 = 覆盖。
   *
   * 为什么是 CASE 而不是把 SET 列表拼出来：`lint:anchor-writes` 是**静态**读 SQL 文本
   * 抽列名的，一插值它就抽到零列然后判过；而写进锚点列在生产上是 42501、整条事务回滚。
   * 每个可选列一对参数：`$奇数` 是「这次送了没」，`$偶数` 是值。
   */
  const has = (k: keyof ProductWriteBody) => body[k] !== undefined;
  const row = await client
    .query<ProductRow>(
      `UPDATE product.products SET
         product_type = $1,
         product_name = $2,
         product_code            = CASE WHEN $27::bool THEN $28 ELSE product_code            END,
         category_id             = CASE WHEN  $3::bool THEN  $4 ELSE category_id             END,
         product_nick            = CASE WHEN  $5::bool THEN  $6 ELSE product_nick            END,
         description             = CASE WHEN  $7::bool THEN  $8 ELSE description             END,
         capability_keys         = CASE WHEN  $9::bool THEN $10 ELSE capability_keys         END,
         tags                    = CASE WHEN $11::bool THEN $12 ELSE tags                    END,
         standalone_subscribable = CASE WHEN $13::bool THEN $14 ELSE standalone_subscribable END,
         is_customer_visible     = CASE WHEN $15::bool THEN $16 ELSE is_customer_visible     END,
         is_workforce_visible    = CASE WHEN $17::bool THEN $18 ELSE is_workforce_visible    END,
         origin                  = CASE WHEN $19::bool THEN $20 ELSE origin                  END,
         origin_provider         = CASE WHEN $21::bool THEN $22 ELSE origin_provider         END,
         icon_url                = CASE WHEN $23::bool THEN $24 ELSE icon_url                END,
         layer                   = CASE WHEN $29::bool THEN $30 ELSE layer                   END,
         updated_by = $25, updated_at = now()
       WHERE id = $26 AND deleted_at IS NULL
       RETURNING ${SELECT_COLUMNS}`,
      [
        body.productType!.trim(),
        body.productName!.trim(),
        has("categoryId"),
        body.categoryId ?? null,
        has("productNick"),
        body.productNick?.trim() || null,
        has("description"),
        body.description?.trim() || null,
        has("capabilityKeys"),
        body.capabilityKeys ?? [],
        has("tags"),
        body.tags ?? [],
        has("standaloneSubscribable"),
        body.standaloneSubscribable ?? true,
        has("isCustomerVisible"),
        body.isCustomerVisible ?? true,
        has("isWorkforceVisible"),
        body.isWorkforceVisible ?? true,
        has("origin"),
        body.origin ?? "self",
        has("originProvider"),
        body.originProvider?.trim() || null,
        has("iconUrl"),
        body.iconUrl?.trim() || null,
        operatorId,
        id,
        /* 排在最后而不是插在中间：前 24 个是成对的 CASE 参数，从中间插一个会把
           后面每一个编号都推一位，而编号错位不报错、只会把值写到别的列上去。 */
        codeChange,
        codeChange ? wantedCode : null,
        /* 同理排在最后：$29/$30 是 layer 那一对，插在中间会推移前面每一个编号。 */
        has("layer"),
        body.layer?.trim() || null,
      ],
    )
    .then((r) => r.rows[0])
    .catch((error: unknown) => {
      throw mapProductCodeTaken(error, body.productCode);
    });
  if (!row) {
    throw notFound("CATALOG_PRODUCT_NOT_FOUND", "Product not found");
  }
  if (surfaces !== null) {
    await replaceSurfaces(client, id, surfaces);
  }
  const record = toRecord(row);
  return {
    ...record,
    /* 同 insert：RETURNING 的子查询在替换之前求值，回传的是旧集合。 */
    surfaces: surfaces ?? record.surfaces,
    /* 改码时的善后结果。界面据此告诉运营者「边缘域名已钉在旧值上」——
       做了什么要说出来，悄悄改一行配置比不改更难查。 */
    ...(pinnedDomain !== null ? { pinnedEdgeDomain: pinnedDomain } : {}),
  };
}

/** 边缘与回调里**不是密钥**的那四项。 */
export interface EdgeWriteBody {
  homeUrl?: string | null;
  webhookUrl?: string | null;
  edgeUpstream?: string | null;
  edgeDomain?: string | null;
}

interface WebhookRow {
  home_url: string | null;
  webhook_url: string | null;
  webhook_secret_ref: string | null;
  edge_upstream: string | null;
  edge_domain: string | null;
  has_secret: boolean;
}

function toWebhookRecord(row: WebhookRow): ProductWebhookRecord {
  return {
    homeUrl: row.home_url,
    webhookUrl: row.webhook_url,
    webhookSecretRef: row.webhook_secret_ref,
    edgeUpstream: row.edge_upstream,
    edgeDomain: row.edge_domain,
    hasWebhookSecret: row.has_secret,
  };
}

/**
 * 写边缘与回调，**不碰密钥两列**（`webhook_secret_ref` / `webhook_secret_enc`）。
 *
 * 密钥只从密钥面板写（`setWebhookSecretTx`）。合并保存的 SQL 里连这两列都不出现，
 * 所以不存在「改个回调地址顺手把密钥清空」——那条三态规则此前要靠前端记得「框空就别带
 * 这个字段」来守，而表单回填不了密文，框恒空。
 *
 * 回调路径照登记处的规矩判（`assertStandardWebhookPath`），与 `PUT :id/webhook` 同一道闸门。
 */
export async function upsertEdgeTx(
  client: Queryable,
  productId: string,
  productCode: string,
  body: EdgeWriteBody,
): Promise<ProductWebhookRecord> {
  const homeUrl = normalizeUrl(body.homeUrl, "homeUrl");
  const webhookUrl = normalizeUrl(body.webhookUrl, "webhookUrl");
  const edgeUpstream = normalizeUpstream(body.edgeUpstream);
  const edgeDomain = normalizeDomain(body.edgeDomain);
  assertStandardWebhookPath(webhookUrl, productCode);
  const result = await client.query<WebhookRow>(
    `INSERT INTO product.product_webhooks
       (product_id, home_url, webhook_url, edge_upstream, edge_domain)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (product_id) DO UPDATE
       SET home_url      = EXCLUDED.home_url,
           webhook_url   = EXCLUDED.webhook_url,
           edge_upstream = EXCLUDED.edge_upstream,
           edge_domain   = EXCLUDED.edge_domain,
           updated_at    = now()
     RETURNING home_url, webhook_url, webhook_secret_ref, edge_upstream, edge_domain,
               (webhook_secret_enc IS NOT NULL) AS has_secret`,
    [productId, homeUrl, webhookUrl, edgeUpstream, edgeDomain],
  );
  return toWebhookRecord(result.rows[0]!);
}

/** 密钥面板的写入。两项各自三态：缺席 = 不动；空串 = 清除；有值 = 覆盖。 */
export interface WebhookSecretBody {
  webhookSecret?: string | null;
  webhookSecretRef?: string | null;
}

/**
 * 写签名密钥与引用。调用方负责 step-up 与产品存在性。
 *
 * 密钥**原文只进不出**：加密后落 `webhook_secret_enc`，回传只有一个布尔。
 */
export async function setWebhookSecretTx(
  client: Queryable,
  productId: string,
  body: WebhookSecretBody,
): Promise<ProductWebhookRecord> {
  const secretTouched = body.webhookSecret !== undefined;
  const refTouched = body.webhookSecretRef !== undefined;
  if (!secretTouched && !refTouched) {
    throw invalidRequest(
      "VALIDATION_REQUIRED",
      "webhookSecret 与 webhookSecretRef 至少给一个",
      "webhookSecret",
    );
  }
  const secretEnc = secretTouched
    ? encodeWebhookSecret(body.webhookSecret)
    : null;
  const ref = refTouched ? normalizeRef(body.webhookSecretRef) : null;
  const result = await client.query<WebhookRow>(
    `INSERT INTO product.product_webhooks
       (product_id, webhook_secret_ref, webhook_secret_enc)
     VALUES ($1, $3, $5)
     ON CONFLICT (product_id) DO UPDATE
       SET webhook_secret_ref = CASE WHEN $2::bool THEN EXCLUDED.webhook_secret_ref
                                     ELSE product.product_webhooks.webhook_secret_ref END,
           webhook_secret_enc = CASE WHEN $4::bool THEN EXCLUDED.webhook_secret_enc
                                     ELSE product.product_webhooks.webhook_secret_enc END,
           updated_at         = now()
     RETURNING home_url, webhook_url, webhook_secret_ref, edge_upstream, edge_domain,
               (webhook_secret_enc IS NOT NULL) AS has_secret`,
    [productId, refTouched, ref, secretTouched, secretEnc],
  );
  return toWebhookRecord(result.rows[0]!);
}
