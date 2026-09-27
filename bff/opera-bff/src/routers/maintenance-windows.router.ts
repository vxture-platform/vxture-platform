/**
 * maintenance-windows.router.ts — 维护窗口读写。
 * @package @vxture/bff-opera
 * @layer Application
 * @category Router
 *
 * 自 admin-bff 迁入（2026-08-07，批 A）。**行为逐条保持不变**，只换了宿主与主体
 * 类型：能力码仍是 `ops:maintenance.read|manage`，状态机仍是
 *   scheduled →(start) in_progress →(complete) completed
 *   scheduled|in_progress →(cancel) cancelled
 * 无删除（表无 deleted_at，终态即归档留存对账）。
 *
 * scheduled 全字段可编；in_progress 仅 end_at 顺延 + description/impact 追记；
 * 终态只读。状态转移走**条件 UPDATE**（0 行 = 404 还是 409 再查一次区分），
 * 写 = 事务 + 事务内审计。锚点列 id / created_by / created_at 永不出现在 SET
 * （deploy/database/ddl/98_column_locks.sql）。
 *
 * ── 产品级维护窗口（owner 2026-09-27）──
 * 窗口可挂 0..n 个产品（`productCodes`；0 = 平台级公告）。绑定是**计划**
 * （admin.maintenance_window_products），占用是**运行态**（product.products 的
 * maintenance_window_id / maintenance_until 两列，读者只看这两列）：
 *   start    → 把绑定产品的两列打上（窗口 id + end_at）；某个产品已被**另一个**进行中
 *              的窗口占着 → 409，整笔回滚，一个都不打；
 *   complete / cancel → 清掉（WHERE maintenance_window_id = 本窗口）；
 *   in_progress 顺延 end_at → 同步 maintenance_until。
 * 产品行的这两列只在这个文件里写。
 *
 * ── 产品页入口（owner 2026-09-28）──
 * 「暂停和恢复入口没有找到」：运营者站在产品页上，找不到把一个产品送进 / 拉出
 * 升级维护的按钮（只有「停用」，而停用会让产品从官网彻底消失）。入口现在长在
 * 产品页（product-catalog.router.ts `POST /api/products/:code/maintenance/start|complete`），
 * 但**写路径仍是这一份**：create / start / complete 三步抽成下面三个 `*Tx` helper
 * （收事务 client），窗口页的端点与产品页的端点走同一段 SQL、同一段审计——两个入口
 * 不会各长一套状态机。
 *
 * 设计权威仍是 docs/product/platform/admin/governance-write-paths.md §3.3/§4。
 */

import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { insertOperatorAuditLog } from "../audit/audit-log";
import { withTransaction, type Queryable } from "../db/tx";
import {
  conflict,
  internalError,
  invalidRequest,
  notEntitled,
  notFound,
  unauthenticated,
} from "../errors/api-error";
import { OPERA_BFF_RO_POOL, OPERA_BFF_RW_POOL } from "../tokens";
import type { RequestContext } from "../types/request-context";
import {
  LIST_LIMIT,
  normalizeStringArray,
  optionalText,
  parseIso,
  requireOperatorId,
  requireText,
  requireUuid,
  toIso,
  toIsoOrNull,
} from "./router.shared";

/** 窗口挂着的一个产品。只回可视码与名字——uuid 不出接口（铁律二）。 */
export interface MaintenanceWindowProduct {
  productCode: string;
  productName: string;
}

export interface MaintenanceWindowItem {
  id: string;
  severity: "minor" | "major" | "critical";
  /**
   * product_251 B-3：字段名统一叫 `state`。窗口的四态不是「启用/停用」，但 B-3
   * 的下半句同样适用——**一个产品内不得混用多个字段名**：产品目录与 OIDC 客户端
   * 都叫 `state` 了，这里再叫 `status`，运营者面对的仍然是两个词。
   * DB 列 `admin.maintenance_windows.status` 不动，只换接口字段名。
   */
  state: "scheduled" | "in_progress" | "completed" | "cancelled";
  title: string;
  description: string | null;
  impactDescription: string | null;
  affectedServices: string[];
  /** 受影响产品（按目录次序）。空数组 = 平台级公告，不挂产品。 */
  products: MaintenanceWindowProduct[];
  startAt: string;
  endAt: string;
  actualEndAt: string | null;
  createdBy: string;
  createdByName: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const WINDOW_SEVERITIES: ReadonlySet<MaintenanceWindowItem["severity"]> =
  new Set(["minor", "major", "critical"]);

const WINDOW_STATES: ReadonlySet<MaintenanceWindowItem["state"]> = new Set([
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
]);

@Controller("api/maintenance-windows")
export class MaintenanceWindowsRouter {
  constructor(
    @Inject(OPERA_BFF_RO_POOL) private readonly pool: Pool,
    @Inject(OPERA_BFF_RW_POOL) private readonly rwPool: Pool,
  ) {}

  // GET /api/maintenance-windows?state=a,b&from=ISO&to=ISO
  //   from/to 过滤 start_at；取最近 LIST_LIMIT 行。
  @Get()
  async listMaintenanceWindows(
    @Req() req: Request & RequestContext,
    @Query("state") state?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ): Promise<MaintenanceWindowItem[]> {
    assertCanReadMaintenanceWindows(req);

    const where: string[] = ["true"];
    const params: unknown[] = [];
    if (state) {
      const states = state.split(",").map((v) => v.trim());
      for (const s of states) {
        if (!WINDOW_STATES.has(s as MaintenanceWindowItem["state"])) {
          throw invalidRequest(
            "VALIDATION_INVALID_VALUE",
            "state must be of scheduled/in_progress/completed/cancelled",
            "state",
          );
        }
      }
      params.push(states);
      where.push(`w.status = any($${params.length}::varchar[])`);
    }
    if (from) {
      params.push(parseIso(from, "from"));
      where.push(`w.start_at >= $${params.length}`);
    }
    if (to) {
      params.push(parseIso(to, "to"));
      where.push(`w.start_at <= $${params.length}`);
    }
    params.push(LIST_LIMIT);

    const { rows } = await this.pool.query<MaintenanceWindowRow>(
      `${MAINTENANCE_WINDOW_SELECT} where ${where.join(" and ")}
       order by w.start_at desc limit $${params.length}`,
      params,
    );
    return rows.map(mapMaintenanceWindowRow);
  }

  @Get(":id")
  async getMaintenanceWindow(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<MaintenanceWindowItem> {
    assertCanReadMaintenanceWindows(req);
    const windowId = requireUuid(id, "id", "Invalid maintenance window id");
    const { rows } = await this.pool.query<MaintenanceWindowRow>(
      `${MAINTENANCE_WINDOW_SELECT} where w.id = $1`,
      [windowId],
    );
    if (!rows[0]) {
      throw notFound(
        "MAINTENANCE_WINDOW_NOT_FOUND",
        "Maintenance window not found",
      );
    }
    return mapMaintenanceWindowRow(rows[0]);
  }

  // POST /api/maintenance-windows
  //   body: { title(<=256), startAt: ISO, endAt: ISO(> startAt；过去的窗口允许
  //           补录), severity?, description?, impactDescription?,
  //           affectedServices?: string[], productCodes?: string[] }。
  //   state 起始 'scheduled'。productCodes 必须都在产品目录里（未删除），否则 400
  //   点名不认识的码——写进去一个不存在的产品，start 时什么也打不上，而且没人知道。
  @Post()
  async createMaintenanceWindow(
    @Req() req: Request & RequestContext,
    @Body() body: MaintenanceWindowWriteBody,
  ): Promise<MaintenanceWindowItem> {
    assertCanManageMaintenanceWindows(req);
    const createdBy = requireOperatorId(req);
    const input = normalizeMaintenanceWindowInput(body);

    return withTransaction(this.rwPool, async (client) => {
      const windowId = await createMaintenanceWindowTx(
        client,
        req,
        input,
        createdBy,
      );
      return this.fetchMaintenanceWindow(client, windowId);
    });
  }

  /**
   * PUT /api/maintenance-windows/:id
   *   scheduled：全字段可编（真·全量替换）；in_progress：end_at 只可顺延 + 描述追记；终态 409。
   *
   * **同一个 URL 在两个状态下语义不同**——这是有意的业务规则，不是失误：一个正在跑的
   * 维护窗口，改标题改开始时间没有意义（它已经开始了）。但语义不同必须**说得出来**：
   * 原来 in_progress 分支把 `title`/`severity`/`startAt`/`affectedServices` **静默丢弃**，
   * 返回 200 和一行看起来正常的数据，运营者以为改了。这正是 product_251 P3 说的那类——
   * 「静默地做与请求不同的事，比报错更糟」。
   *
   * 现在的规则（B-1）：**送来的锁定字段与库里不同就拒**，相同则视为无操作放行。
   * 后者不能少——控制台编辑框在 live 模式下是 disabled 而不是不提交，它送的是原值。
   *
   * `productCodes` 同属锁定字段：进行中的窗口换产品等于要给新产品打标、给旧产品清标，
   * 那是另一次 start / complete，不是一次编辑。
   */
  @Put(":id")
  async updateMaintenanceWindow(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: MaintenanceWindowWriteBody,
  ): Promise<MaintenanceWindowItem> {
    assertCanManageMaintenanceWindows(req);
    const updatedBy = requireOperatorId(req);
    const windowId = requireUuid(id, "id", "Invalid maintenance window id");

    return withTransaction(this.rwPool, async (client) => {
      const current = await client.query<{
        status: MaintenanceWindowItem["state"];
        severity: MaintenanceWindowItem["severity"];
        title: string;
        affected_services: string[];
        product_codes: string[];
        start_at: Date;
        end_at: Date;
      }>(MAINTENANCE_WINDOW_LOCK_FOR_UPDATE_SQL, [windowId]);
      const row = current.rows[0];
      if (!row) {
        throw notFound(
          "MAINTENANCE_WINDOW_NOT_FOUND",
          "Maintenance window not found",
        );
      }

      let productCodes: string[] = row.product_codes ?? [];
      if (row.status === "scheduled") {
        const input = normalizeMaintenanceWindowInput(body);
        const productIds = await resolveProductIds(client, input.productCodes);
        await client.query(MAINTENANCE_WINDOW_FULL_UPDATE_SQL, [
          windowId,
          input.severity,
          input.title,
          input.description,
          input.impactDescription,
          input.affectedServices,
          input.startAt,
          input.endAt,
          updatedBy,
        ]);
        await replaceWindowProducts(client, windowId, productIds);
        productCodes = input.productCodes;
      } else if (row.status === "in_progress") {
        assertLiveEditable(body, row);
        const description = optionalText(
          body.description,
          "description",
          10000,
        );
        const impactDescription = optionalText(
          body.impactDescription,
          "impactDescription",
          10000,
        );
        let endAt: string | null = null;
        if (
          body.endAt !== undefined &&
          body.endAt !== null &&
          body.endAt !== ""
        ) {
          endAt = parseIso(body.endAt, "endAt");
          // 只可顺延（设计 §3.3）：进行中的窗口提前结束叫"完成"（记 actual_end_at），
          // 不是把计划结束时间改短。
          if (new Date(endAt) < new Date(row.end_at)) {
            throw invalidRequest(
              "MAINTENANCE_WINDOW_END_AT_NOT_EXTENDABLE",
              "endAt of an in_progress window can only be extended",
              "endAt",
            );
          }
        }
        await client.query(MAINTENANCE_WINDOW_LIVE_UPDATE_SQL, [
          windowId,
          endAt,
          description,
          impactDescription,
          updatedBy,
        ]);
        /* 顺延要跟到产品行上：官网 / console 显示的「预计 … 恢复」读的是
           products.maintenance_until，不是窗口的 end_at。 */
        if (endAt !== null) {
          await client.query(PRODUCTS_MAINTENANCE_UNTIL_SYNC_SQL, [
            windowId,
            endAt,
          ]);
        }
      } else {
        throw conflict(
          "MAINTENANCE_WINDOW_READ_ONLY",
          "Completed/cancelled maintenance windows are read-only",
        );
      }

      await insertOperatorAuditLog(client, req, {
        action: "governance.maintenance.update",
        resourceType: "maintenance_window",
        resourceId: windowId,
        before: {
          state: row.status,
          startAt: toIso(row.start_at),
          endAt: toIso(row.end_at),
          productCodes: row.product_codes ?? [],
        },
        after: { productCodes },
      });
      return this.fetchMaintenanceWindow(client, windowId);
    });
  }

  // POST /api/maintenance-windows/:id/start — scheduled → in_progress（手动触发，无调度器）
  //   顺带把绑定产品打上「升级维护中」。某个产品已被另一个进行中的窗口占着 → 409，
  //   整笔回滚（窗口不会半开：状态没变、一个产品都没打）。
  @Post(":id/start")
  async startMaintenanceWindow(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<MaintenanceWindowItem> {
    assertCanManageMaintenanceWindows(req);
    const updatedBy = requireOperatorId(req);
    const windowId = requireUuid(id, "id", "Invalid maintenance window id");

    return withTransaction(this.rwPool, async (client) => {
      await startMaintenanceWindowTx(client, req, windowId, updatedBy);
      return this.fetchMaintenanceWindow(client, windowId);
    });
  }

  // POST /api/maintenance-windows/:id/complete { actualEndAt?: ISO }
  //   in_progress → completed；actual_end_at 取 body 值或 now()。产品行的占用随之清掉。
  @Post(":id/complete")
  async completeMaintenanceWindow(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body?: { actualEndAt?: unknown },
  ): Promise<MaintenanceWindowItem> {
    assertCanManageMaintenanceWindows(req);
    const updatedBy = requireOperatorId(req);
    const windowId = requireUuid(id, "id", "Invalid maintenance window id");
    const actualEndAt =
      body?.actualEndAt === undefined ||
      body.actualEndAt === null ||
      body.actualEndAt === ""
        ? null
        : parseIso(body.actualEndAt, "actualEndAt");

    return withTransaction(this.rwPool, async (client) => {
      await completeMaintenanceWindowTx(
        client,
        req,
        windowId,
        actualEndAt,
        updatedBy,
      );
      return this.fetchMaintenanceWindow(client, windowId);
    });
  }

  // POST /api/maintenance-windows/:id/cancel — scheduled|in_progress → cancelled
  //   （取消一个进行中的窗口会记 actual_end_at，并清掉产品行的占用；取消一个
  //   scheduled 的窗口本来就没打过标，清 0 行）。
  @Post(":id/cancel")
  async cancelMaintenanceWindow(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<MaintenanceWindowItem> {
    assertCanManageMaintenanceWindows(req);
    const updatedBy = requireOperatorId(req);
    const windowId = requireUuid(id, "id", "Invalid maintenance window id");

    return withTransaction(this.rwPool, async (client) => {
      const { rowCount } = await client.query(MAINTENANCE_WINDOW_CANCEL_SQL, [
        windowId,
        updatedBy,
      ]);
      if (rowCount === 0) {
        await throwWindowNotFoundOrConflict(
          client,
          windowId,
          "Maintenance window is already terminal",
        );
      }
      const released = await releaseWindowProducts(client, windowId);
      await insertOperatorAuditLog(client, req, {
        action: "governance.maintenance.cancel",
        resourceType: "maintenance_window",
        resourceId: windowId,
        after: { productsReleased: released },
      });
      return this.fetchMaintenanceWindow(client, windowId);
    });
  }

  private async fetchMaintenanceWindow(
    db: Queryable,
    id: string,
  ): Promise<MaintenanceWindowItem> {
    const { rows } = await db.query<MaintenanceWindowRow>(
      `${MAINTENANCE_WINDOW_SELECT} where w.id = $1`,
      [id],
    );
    if (!rows[0]) {
      throw notFound(
        "MAINTENANCE_WINDOW_NOT_FOUND",
        "Maintenance window not found",
      );
    }
    return mapMaintenanceWindowRow(rows[0]);
  }
}

// products 子查询按目录次序（sort, product_code）带出，与产品目录页同一句。
const MAINTENANCE_WINDOW_SELECT = `
select
  w.id,
  w.severity,
  w.status,
  w.title,
  w.description,
  w.impact_description,
  w.affected_services,
  coalesce(
    (select json_agg(json_build_object('productCode', p.product_code, 'productName', p.product_name)
                     order by p.sort, p.product_code)
       from admin.maintenance_window_products mp
       join product.products p on p.id = mp.product_id
      where mp.window_id = w.id),
    '[]'::json
  ) as products,
  w.start_at,
  w.end_at,
  w.actual_end_at,
  w.created_by,
  coalesce(nullif(o.display_name, ''), o.username) as created_by_name,
  w.updated_by,
  w.created_at,
  w.updated_at
from admin.maintenance_windows w
left join admin.operator_account o on o.id = w.created_by
`;

const MAINTENANCE_WINDOW_INSERT_SQL = `
insert into admin.maintenance_windows
  (severity, status, title, description, impact_description,
   affected_services, start_at, end_at, created_by)
values
  ($1, 'scheduled', $2, $3, $4, $5::varchar[], $6, $7, $8)
returning id
`;

// PUT 前先锁窗口行，顺带把当前绑定的产品码带出来给 in_progress 的锁定字段比对。
const MAINTENANCE_WINDOW_LOCK_FOR_UPDATE_SQL = `
select w.status, w.severity, w.title, w.affected_services, w.start_at, w.end_at,
       array(
         select p.product_code
           from admin.maintenance_window_products mp
           join product.products p on p.id = mp.product_id
          where mp.window_id = w.id
          order by p.product_code
       )::varchar[] as product_codes
  from admin.maintenance_windows w
 where w.id = $1
   for update of w
`;

// scheduled only —— 锚点列（id/created_by/created_at）永不进 SET。
const MAINTENANCE_WINDOW_FULL_UPDATE_SQL = `
update admin.maintenance_windows
set severity           = $2,
    title              = $3,
    description        = $4,
    impact_description = $5,
    affected_services  = $6::varchar[],
    start_at           = $7,
    end_at             = $8,
    updated_by         = $9,
    updated_at         = now()
where id = $1 and status = 'scheduled'
`;

// in_progress 实时更新：顺延 end_at（$2 为 null 则保持）+ 描述追记。
const MAINTENANCE_WINDOW_LIVE_UPDATE_SQL = `
update admin.maintenance_windows
set end_at             = coalesce($2, end_at),
    description        = coalesce($3, description),
    impact_description = coalesce($4, impact_description),
    updated_by         = $5,
    updated_at         = now()
where id = $1 and status = 'in_progress'
`;

// returning end_at：产品行要打的 maintenance_until 就是它。
const MAINTENANCE_WINDOW_START_SQL = `
update admin.maintenance_windows
set status = 'in_progress', updated_by = $2, updated_at = now()
where id = $1 and status = 'scheduled'
returning end_at
`;

const MAINTENANCE_WINDOW_COMPLETE_SQL = `
update admin.maintenance_windows
set status = 'completed',
    actual_end_at = coalesce($2, now()),
    updated_by = $3,
    updated_at = now()
where id = $1 and status = 'in_progress'
`;

const MAINTENANCE_WINDOW_CANCEL_SQL = `
update admin.maintenance_windows
set actual_end_at = case when status = 'in_progress' then now() else actual_end_at end,
    status = 'cancelled',
    updated_by = $2,
    updated_at = now()
where id = $1 and status in ('scheduled', 'in_progress')
`;

// ── 绑定（计划）────────────────────────────────────────────────────────────

const PRODUCT_IDS_BY_CODE_SQL = `
select id, product_code
  from product.products
 where product_code = any($1::varchar[])
   and deleted_at is null
`;

const MAINTENANCE_WINDOW_PRODUCTS_DELETE_SQL = `
delete from admin.maintenance_window_products where window_id = $1
`;

const MAINTENANCE_WINDOW_PRODUCTS_INSERT_SQL = `
insert into admin.maintenance_window_products (window_id, product_id)
select $1, unnest($2::uuid[])
on conflict do nothing
`;

// ── 占用（运行态）：product.products 的两列只在下面三条里写 ──────────────────
// 不碰 products.updated_at：打标 / 清标是运行态变化，不是目录内容的一次编辑，
// 目录页按更新时间排序不该因为一次维护而抖动。

// start 时锁住绑定产品的行并读占用；for update of p 只锁产品行，不锁绑定表。
const MAINTENANCE_WINDOW_BOUND_PRODUCTS_LOCK_SQL = `
select p.product_code, p.maintenance_window_id
  from admin.maintenance_window_products mp
  join product.products p on p.id = mp.product_id
 where mp.window_id = $1
 order by p.product_code
   for update of p
`;

const PRODUCTS_MAINTENANCE_STAMP_SQL = `
update product.products
   set maintenance_window_id = $1,
       maintenance_until = $2
 where id in (select product_id from admin.maintenance_window_products where window_id = $1)
`;

const PRODUCTS_MAINTENANCE_UNTIL_SYNC_SQL = `
update product.products
   set maintenance_until = $2
 where maintenance_window_id = $1
`;

const PRODUCTS_MAINTENANCE_RELEASE_SQL = `
update product.products
   set maintenance_window_id = null,
       maintenance_until = null
 where maintenance_window_id = $1
`;

/**
 * 产品码 → id。**每个码都必须在目录里**（未删除）：写进一个不存在的产品，start 时
 * 什么也打不上，而且没人知道。回的 id 顺序与传入的码一致。
 */
async function resolveProductIds(
  db: Queryable,
  productCodes: readonly string[],
): Promise<string[]> {
  if (productCodes.length === 0) return [];
  const { rows } = await db.query<{ id: string; product_code: string }>(
    PRODUCT_IDS_BY_CODE_SQL,
    [productCodes],
  );
  const byCode = new Map(rows.map((r) => [r.product_code, r.id]));
  const unknown = productCodes.filter((c) => !byCode.has(c));
  if (unknown.length > 0) {
    throw invalidRequest(
      "MAINTENANCE_WINDOW_PRODUCT_UNKNOWN",
      `产品目录里没有这些产品码（或已删除）：${unknown.join(" / ")}`,
      "productCodes",
    );
  }
  return productCodes.map((c) => byCode.get(c)!);
}

/** 全量替换绑定（PUT 语义）：删光再插。绑定没有可 UPDATE 的列（98：全主键）。 */
async function replaceWindowProducts(
  db: Queryable,
  windowId: string,
  productIds: readonly string[],
): Promise<void> {
  await db.query(MAINTENANCE_WINDOW_PRODUCTS_DELETE_SQL, [windowId]);
  if (productIds.length > 0) {
    await db.query(MAINTENANCE_WINDOW_PRODUCTS_INSERT_SQL, [
      windowId,
      productIds,
    ]);
  }
}

/** complete / cancel：清掉本窗口打的标。按 maintenance_window_id 清，不按绑定表——
 *  绑定在 scheduled 时可以改，占用只认「是这个窗口打的」。 */
async function releaseWindowProducts(
  db: Queryable,
  windowId: string,
): Promise<number> {
  const { rowCount } = await db.query(PRODUCTS_MAINTENANCE_RELEASE_SQL, [
    windowId,
  ]);
  return rowCount ?? 0;
}

// ── 三步写路径（窗口页与产品页共用）───────────────────────────────────────
// 每个 helper 都收**事务 client**：调用方负责 BEGIN/COMMIT（withTransaction），
// helper 只管「这一步的 SQL + 这一步的审计」。抛出即整笔回滚——与端点内联时一样。

/** 条件 UPDATE 影响 0 行有两种可能：行不存在（404），或状态不允许（409）。 */
async function throwWindowNotFoundOrConflict(
  db: Queryable,
  windowId: string,
  conflictMessage: string,
): Promise<never> {
  const { rowCount } = await db.query(
    `select 1 from admin.maintenance_windows where id = $1`,
    [windowId],
  );
  if (rowCount === 0) {
    throw notFound(
      "MAINTENANCE_WINDOW_NOT_FOUND",
      "Maintenance window not found",
    );
  }
  throw conflict("MAINTENANCE_WINDOW_INVALID_TRANSITION", conflictMessage);
}

/**
 * 建窗口（scheduled）+ 绑定产品 + 审计 create。回窗口 id。
 * `input` 已经过 `normalizeMaintenanceWindowInput` 或由调用方在代码里构造
 * （产品页入口：标题按产品名拼、severity minor、start_at = now()）。
 */
export async function createMaintenanceWindowTx(
  client: Queryable,
  req: Request & RequestContext,
  input: NormalizedMaintenanceWindowInput,
  createdBy: string,
): Promise<string> {
  const productIds = await resolveProductIds(client, input.productCodes);
  const { rows } = await client.query<{ id: string }>(
    MAINTENANCE_WINDOW_INSERT_SQL,
    [
      input.severity,
      input.title,
      input.description,
      input.impactDescription,
      input.affectedServices,
      input.startAt,
      input.endAt,
      createdBy,
    ],
  );
  const created = rows[0];
  if (!created) {
    /* 库没有按要求插进去——这是本方故障。原来这里回 400，运营者会以为是
       自己填错了，然后反复改一个永远改不好的输入。 */
    throw internalError(
      "MAINTENANCE_WINDOW_INSERT_FAILED",
      "Maintenance window insert returned no row",
    );
  }
  await replaceWindowProducts(client, created.id, productIds);
  await insertOperatorAuditLog(client, req, {
    action: "governance.maintenance.create",
    resourceType: "maintenance_window",
    resourceId: created.id,
    after: {
      title: input.title,
      severity: input.severity,
      startAt: input.startAt,
      endAt: input.endAt,
      productCodes: input.productCodes,
    },
  });
  return created.id;
}

/** start 的结果：给调用方写自己那条审计用。 */
export interface MaintenanceWindowStarted {
  /** 打到产品行上的 maintenance_until（= 窗口 end_at）。 */
  maintenanceUntil: string;
  productCodes: string[];
  productsStamped: number;
}

/**
 * scheduled → in_progress，顺带把绑定产品打上「升级维护中」。
 * 某个产品已被**另一个**进行中的窗口占着 → 409，整笔回滚（窗口不会半开：
 * 状态没变、一个产品都没打）。
 */
export async function startMaintenanceWindowTx(
  client: Queryable,
  req: Request & RequestContext,
  windowId: string,
  updatedBy: string,
): Promise<MaintenanceWindowStarted> {
  const started = await client.query<{ end_at: Date | string }>(
    MAINTENANCE_WINDOW_START_SQL,
    [windowId, updatedBy],
  );
  const startedRow = started.rows[0];
  if (!startedRow) {
    await throwWindowNotFoundOrConflict(
      client,
      windowId,
      "Only a scheduled window can be started",
    );
  }
  /* 先锁产品行再判占用：FOR UPDATE 等到并发那笔提交后才返回，读到的是提交后的
     值——两个窗口同时 start 同一个产品，后到的那笔看见前一笔打的标，409。
     不锁直接 UPDATE 是「最后写的赢」，两个窗口都以为自己占住了。 */
  const bound = await client.query<{
    product_code: string;
    maintenance_window_id: string | null;
  }>(MAINTENANCE_WINDOW_BOUND_PRODUCTS_LOCK_SQL, [windowId]);
  const busy = bound.rows.filter(
    (r) =>
      r.maintenance_window_id !== null && r.maintenance_window_id !== windowId,
  );
  if (busy.length > 0) {
    throw conflict(
      "MAINTENANCE_WINDOW_PRODUCT_BUSY",
      `这些产品已经在另一个进行中的维护窗口里：${busy
        .map((r) => r.product_code)
        .join(
          " / ",
        )}。同一产品同时只能在一个进行中的窗口里，先完成或取消那个窗口再开始这个。`,
    );
  }
  const endAt = toIso(startedRow!.end_at);
  const stamped = await client.query(PRODUCTS_MAINTENANCE_STAMP_SQL, [
    windowId,
    endAt,
  ]);
  const result: MaintenanceWindowStarted = {
    maintenanceUntil: endAt,
    productCodes: bound.rows.map((r) => r.product_code),
    productsStamped: stamped.rowCount ?? 0,
  };
  await insertOperatorAuditLog(client, req, {
    action: "governance.maintenance.start",
    resourceType: "maintenance_window",
    resourceId: windowId,
    after: result,
  });
  return result;
}

/**
 * in_progress → completed；actual_end_at 取 `actualEndAt` 或 now()。
 * 产品行的占用随之清掉（按 maintenance_window_id = 本窗口）。回清掉的产品数。
 */
export async function completeMaintenanceWindowTx(
  client: Queryable,
  req: Request & RequestContext,
  windowId: string,
  actualEndAt: string | null,
  updatedBy: string,
): Promise<{ productsReleased: number }> {
  const { rowCount } = await client.query(MAINTENANCE_WINDOW_COMPLETE_SQL, [
    windowId,
    actualEndAt,
    updatedBy,
  ]);
  if (rowCount === 0) {
    await throwWindowNotFoundOrConflict(
      client,
      windowId,
      "Only an in_progress window can be completed",
    );
  }
  const released = await releaseWindowProducts(client, windowId);
  await insertOperatorAuditLog(client, req, {
    action: "governance.maintenance.complete",
    resourceType: "maintenance_window",
    resourceId: windowId,
    after: { actualEndAt, productsReleased: released },
  });
  return { productsReleased: released };
}

interface MaintenanceWindowRow {
  id: string;
  severity: MaintenanceWindowItem["severity"];
  status: MaintenanceWindowItem["state"];
  title: string;
  description: string | null;
  impact_description: string | null;
  affected_services: string[] | null;
  products: MaintenanceWindowProduct[] | null;
  start_at: Date | string;
  end_at: Date | string;
  actual_end_at: Date | string | null;
  created_by: string;
  created_by_name: string | null;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface MaintenanceWindowWriteBody {
  severity?: unknown;
  title?: unknown;
  description?: unknown;
  impactDescription?: unknown;
  affectedServices?: unknown;
  productCodes?: unknown;
  startAt?: unknown;
  endAt?: unknown;
}

export interface NormalizedMaintenanceWindowInput {
  severity: MaintenanceWindowItem["severity"];
  title: string;
  description: string | null;
  impactDescription: string | null;
  affectedServices: string[];
  productCodes: string[];
  startAt: string;
  endAt: string;
}

function mapMaintenanceWindowRow(
  row: MaintenanceWindowRow,
): MaintenanceWindowItem {
  return {
    id: row.id,
    severity: row.severity,
    state: row.status,
    title: row.title,
    description: row.description,
    impactDescription: row.impact_description,
    affectedServices: row.affected_services ?? [],
    products: row.products ?? [],
    startAt: toIso(row.start_at),
    endAt: toIso(row.end_at),
    actualEndAt: toIsoOrNull(row.actual_end_at),
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    updatedBy: row.updated_by,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

/** 按**集合**比，不按顺序、不认重复与首尾空格。 */
function setKey(xs: readonly unknown[]): string {
  return [...new Set(xs.map((v) => String(v).trim()))].sort().join(" ");
}

/**
 * in_progress 下哪些字段动不了（product_251 B-1 / P3）。
 *
 * **只拦「要改」，不拦「提到了」**：控制台的编辑框在 live 模式下是 disabled 而不是
 * 不提交，送来的是原值。把「送了原值」也拦掉，等于让人在界面上根本存不了描述。
 */
export function assertLiveEditable(
  body: MaintenanceWindowWriteBody,
  row: {
    severity: MaintenanceWindowItem["severity"];
    title: string;
    affected_services: string[];
    product_codes: string[];
    start_at: Date;
  },
): void {
  const locked: string[] = [];

  if (typeof body.title === "string" && body.title.trim() !== row.title) {
    locked.push("title");
  }
  if (
    body.severity !== undefined &&
    body.severity !== null &&
    body.severity !== row.severity
  ) {
    locked.push("severity");
  }
  if (body.startAt !== undefined && body.startAt !== null) {
    /* 解析失败也算"不同"——一个连格式都不对的值肯定不是库里那个。 */
    const sent = new Date(String(body.startAt)).getTime();
    if (Number.isNaN(sent) || sent !== row.start_at.getTime()) {
      locked.push("startAt");
    }
  }
  if (Array.isArray(body.affectedServices)) {
    /* 按**集合**比，不按顺序——2026-08-16 联调证伪了原来的按序比较：送
       `['beta','alpha']` 而库里是 `['alpha','beta']` 会被拒，可运营者一个服务都
       没改。`affectedServices` 回答的是「哪些服务受影响」，先后不承载任何语义。
       **误拒比漏拒更伤**：漏拒是少挡一次，误拒是让人对着一个自己没做过的改动
       找半天，还找不到。 */
    if (setKey(body.affectedServices) !== setKey(row.affected_services ?? [])) {
      locked.push("affectedServices");
    }
  }
  if (Array.isArray(body.productCodes)) {
    /* 同 affectedServices：集合比。进行中的窗口换产品不是编辑，是另一次 start / complete。 */
    if (setKey(body.productCodes) !== setKey(row.product_codes ?? [])) {
      locked.push("productCodes");
    }
  }

  if (locked.length > 0) {
    throw conflict(
      "MAINTENANCE_WINDOW_LIVE_FIELDS_LOCKED",
      `进行中的窗口不能改这些字段：${locked.join(" / ")}。` +
        `只能顺延结束时间、追记描述与影响说明；要改其它内容请先取消这个窗口再重建。`,
    );
  }
}

function normalizeMaintenanceWindowInput(
  body: MaintenanceWindowWriteBody,
): NormalizedMaintenanceWindowInput {
  if (!body || typeof body !== "object") {
    throw invalidRequest(
      "VALIDATION_BODY_REQUIRED",
      "Request body is required",
    );
  }
  if (
    body.severity !== undefined &&
    body.severity !== null &&
    !(
      typeof body.severity === "string" &&
      WINDOW_SEVERITIES.has(body.severity as MaintenanceWindowItem["severity"])
    )
  ) {
    throw invalidRequest(
      "VALIDATION_INVALID_VALUE",
      "severity must be one of minor/major/critical",
      "severity",
    );
  }
  const severity =
    body.severity === undefined || body.severity === null
      ? "minor"
      : (body.severity as MaintenanceWindowItem["severity"]);

  const startAt = parseIso(body.startAt, "startAt");
  const endAt = parseIso(body.endAt, "endAt");
  if (new Date(endAt) <= new Date(startAt)) {
    throw invalidRequest(
      "VALIDATION_INVALID_VALUE",
      "endAt must be after startAt",
      "endAt",
    );
  }
  return {
    severity,
    title: requireText(body.title, "title", 256),
    description: optionalText(body.description, "description", 10000),
    impactDescription: optionalText(
      body.impactDescription,
      "impactDescription",
      10000,
    ),
    affectedServices: normalizeStringArray(
      body.affectedServices,
      "affectedServices",
    ),
    /* 去重：同一个码送两遍是一个产品，不是两个；绑定表的主键也只认一次。 */
    productCodes: [
      ...new Set(normalizeStringArray(body.productCodes, "productCodes")),
    ],
    startAt,
    endAt,
  };
}

// ── 能力门（能力码沿用既有 ops:maintenance.*，迁移不改）──────────────

function assertCanReadMaintenanceWindows(req: Request & RequestContext): void {
  if (!req.operator) {
    throw unauthenticated("AUTH_NO_SESSION", "No active session");
  }
  if (
    !req.capabilities ||
    (!req.capabilities.includes("ops:maintenance.read") &&
      !req.capabilities.includes("ops:maintenance.manage"))
  ) {
    throw notEntitled("ops:maintenance.read");
  }
}

export function assertCanManageMaintenanceWindows(
  req: Request & RequestContext,
): void {
  if (!req.operator) {
    throw unauthenticated("AUTH_NO_SESSION", "No active session");
  }
  if (
    !req.capabilities ||
    !req.capabilities.includes("ops:maintenance.manage")
  ) {
    throw notEntitled("ops:maintenance.manage");
  }
}
