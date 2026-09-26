import { Inject, Injectable } from "@nestjs/common";
import { Pool } from "pg";
import { COMMERCE_PG_POOL } from "../tokens";
import type {
  ProductSeatGrantOutcome,
  ProductSeatHolder,
  WorkspaceProductSeats,
} from "../types/product-seat.types";

/**
 * 产品席位占用的数据访问（metering.product_seats）。
 *
 * ── 上限判据不在这里 ──
 * 「满了不许再发」由库里的 `trg_product_seats_enforce_limit` 判（2026-11-15）。
 * 席位有两个写入方——客户在 console 自助指派、运营在 admin 代操作——判据挂在任何一条
 * 写路径上都会给另一条留门。本仓库层只做两件事：发起写入，把库抛出的错**翻译成调用方
 * 能据以给文案的结果**。
 *
 * 三个错误码是与触发器之间的契约（见 95_triggers.sql / 迁移头注）：
 *   VX409 → seat_limit_reached（附上限数字）
 *   VX404 → product_not_covered（该工作区没有在服务中的订阅覆盖这个产品）
 *   23505 → already_granted（这个人已经占着这个产品的席位；**不是**「席位已满」）
 * 触发器故意为已持有者放行，好让唯一索引来报——否则给一个已持有席位的人再点一次
 * 「指派」，得到的会是「席位已满」，一个把原因说错的报错。
 */
@Injectable()
export class PgProductSeatRepository {
  constructor(
    // Explicit token: esbuild 不会把 design:paramtypes 元数据 emit 进 BFF bundle。
    @Inject(COMMERCE_PG_POOL) private readonly pool: Pool,
  ) {}

  /**
   * 这个工作区每个**被订阅覆盖的产品**：上限、当前占用、占用者是谁。
   *
   * 产品集合来自 `plan_components`，不是 `subscriptions.product_id`——后者只是主组件，
   * 而套餐可以捆多个产品，席位要按组件逐个给。
   * 「在服务中」取 ('active','trialing','expiring','overdue')，与库里的
   * `metering.resolve_seat_max` 同一个集合（同一个问题只能有一个答案）。
   */
  async listWorkspaceSeats(
    workspaceId: string,
  ): Promise<WorkspaceProductSeats[]> {
    const products = await this.pool.query<{
      product_id: string;
      product_code: string;
      product_name: string;
      subscription_id: string;
      seat_max: number | null;
    }>(
      `select distinct on (pc.product_id)
              pc.product_id,
              p.product_code,
              p.product_name,
              s.id                                          as subscription_id,
              metering.resolve_seat_max(s.workspace_id, pc.product_id) as seat_max
         from metering.subscriptions s
         join product.plan_components pc on pc.plan_version_id = s.plan_version_id
         join product.products p on p.id = pc.product_id
        where s.workspace_id = $1
          and s.deleted_at is null
          and s.status in ('active','trialing','expiring','overdue')
        order by pc.product_id, s.created_at desc`,
      [workspaceId],
    );
    if (products.rows.length === 0) return [];

    const holders = await this.pool.query<{
      product_id: string;
      user_id: string;
      user_no: string;
      display_name: string | null;
      granted_at: Date;
    }>(
      `select ps.product_id, ps.user_id, u.user_no,
              coalesce(up.display_name, u.account) as display_name, ps.granted_at
         from metering.product_seats ps
         join account.users u on u.id = ps.user_id
         left join account.user_profiles up on up.user_id = u.id
        where ps.workspace_id = $1
          and ps.revoked_at is null
        order by ps.granted_at`,
      [workspaceId],
    );

    const byProduct = new Map<string, ProductSeatHolder[]>();
    for (const row of holders.rows) {
      const list = byProduct.get(row.product_id) ?? [];
      list.push({
        userId: row.user_id,
        userNo: row.user_no,
        displayName: row.display_name,
        grantedAt: row.granted_at.toISOString(),
      });
      byProduct.set(row.product_id, list);
    }

    return products.rows.map((row) => {
      const list = byProduct.get(row.product_id) ?? [];
      return {
        productId: row.product_id,
        productCode: row.product_code,
        productName: row.product_name,
        subscriptionId: row.subscription_id,
        /* -1 = 无限（目录的哨兵约定）；null = 读不到，调用方显示「—」而不是 0。 */
        seatMax: row.seat_max,
        occupied: list.length,
        holders: list,
      };
    });
  }

  /** 指派席位。上限由库判，这里只翻译结果。 */
  async grant(input: {
    workspaceId: string;
    productId: string;
    userId: string;
    grantedBy: string | null;
  }): Promise<ProductSeatGrantOutcome> {
    /* subscription_id 由库里的覆盖关系现算，不由调用方传——传进来的话，前端拿到的那个
       订阅 id 与「此刻真正覆盖这个产品的订阅」可能已经不是一条（升级、退订、到期）。 */
    try {
      const result = await this.pool.query<{ id: string }>(
        `insert into metering.product_seats
           (workspace_id, user_id, product_id, subscription_id, granted_by)
         select $1, $3, $2, s.id, $4
           from metering.subscriptions s
           join product.plan_components pc on pc.plan_version_id = s.plan_version_id
          where s.workspace_id = $1
            and pc.product_id = $2
            and s.deleted_at is null
            and s.status in ('active','trialing','expiring','overdue')
          order by s.created_at desc
          limit 1
         returning id`,
        [input.workspaceId, input.productId, input.userId, input.grantedBy],
      );
      /* 0 行 = 上面那条 select 没找到覆盖订阅。触发器没机会跑（没有行要插），
         所以这一支也要自己报 product_not_covered，否则调用方会以为「成功了但没插」。 */
      if (result.rowCount === 0)
        return { ok: false, reason: "product_not_covered" };
      return { ok: true, seatId: result.rows[0]!.id };
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "VX409") {
        return { ok: false, reason: "seat_limit_reached" };
      }
      if (code === "VX404") return { ok: false, reason: "product_not_covered" };
      if (code === "23505") return { ok: false, reason: "already_granted" };
      /* 23503 = 复合外键：这个人不是该工作区的成员。库挡住了，但错误消息没有上下文。 */
      if (code === "23503") return { ok: false, reason: "not_a_member" };
      throw err;
    }
  }

  /** 撤销席位（软撤销，留痕）。已经没有活席位时返回 false——重复点撤销不该报错。 */
  async revoke(input: {
    workspaceId: string;
    productId: string;
    userId: string;
    revokedBy: string | null;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `update metering.product_seats
          set revoked_at = now(), revoked_by = $4
        where workspace_id = $1
          and product_id = $2
          and user_id = $3
          and revoked_at is null`,
      [input.workspaceId, input.productId, input.userId, input.revokedBy],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
