import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { ADMIN_BFF_RO_POOL } from "../tokens";
import { assertSession } from "../auth/capability";
import type { RequestContext } from "../types/console.types";

/**
 * 全局搜索：header ⌘K 面板的数据来源（admin 形态）。
 *
 * 与 console 的同名接口形状一致（`{ query, items, skipped }`，item 自带
 * `href`），但**实现走库侧 ILIKE 而不是内存过滤**。console 那边的数据以租户
 * 为界（成员几十、发票按周期出），扇出到已有读路径再过滤是合算的；admin 是
 * 跨租户视角，租户/订单/操作员都是全平台量级，把 500 行拉进内存再筛既不完整
 * 也不便宜。三条查询各自 limit，命中由数据库判。
 *
 * **按能力逐源放行**：三个数据源分别对应 tenants / orders / platform-admins
 * 三个既有列表接口的能力码，缺哪个就跳过哪一段，而不是整体 403。搜索是辅助
 * 入口，一个只管订单的运营人员搜出订单、搜不到租户，是正确结果；给他弹一个
 * 403 才是错的。能力判定只读 `req.capabilities`（中间件已填），不放宽任何
 * 一条既有授权——这里能搜到的，点进去那个页面本来也进得去。
 *
 * 页面/功能的搜索**不在这里**：那份数据是前端导航注册表（含 i18n 文案与工作域
 * 划分），后端没有、也不该有一份副本。前端本地匹配后与本接口结果合并。
 */

/** 单类结果的返回上限。面板一屏能看的量，多了也只是滚动噪音。 */
const PER_KIND_LIMIT = 5;
/** 低于此长度不检索：一两个字符的命中率约等于"全量返回"。 */
const MIN_QUERY_LENGTH = 2;

export type AdminSearchResultKind = "tenant" | "order" | "operator";

export interface AdminSearchResultItem {
  kind: AdminSearchResultKind;
  id: string;
  /** 主行文案。 */
  label: string;
  /** 副行文案（编号、租户名…）；无则省略。 */
  description?: string;
  /** 右端补充（状态、金额…）。 */
  meta?: string;
  /** 前端据此跳转；由后端给，前端不拼路径。 */
  href: string;
}

export interface AdminSearchResponse {
  query: string;
  items: AdminSearchResultItem[];
  /** 是否因为查询串太短而未检索——前端据此区分"没搜"和"搜了没有"。 */
  skipped: boolean;
}

/* 三条查询都用 `$1` 传整串 `%needle%`，不做字符串拼接——拼接就是注入。
 * ILIKE 在没有 trigram 索引时是顺序扫描；当前平台规模（租户千级、订单万级）
 * 可以接受，超过之后应加 `pg_trgm` 的 GIN 索引，本文件的 SQL 不用改。 */

const TENANT_SEARCH_SQL = `
select
  t.id,
  t.name,
  t.tenant_no::text as tenant_no
from tenancy.tenants t
where t.deleted_at is null
  and (t.name ilike $1 or t.tenant_no::text ilike $1)
order by t.created_at desc
limit ${PER_KIND_LIMIT}
`;

/* 订阅的可读码 = 最近一次履约它的订单号（billing.orders 经 current_order_id，
 * product_330）；旧列 subscriptions.order_no 已停写待删，不再匹配它。 */
const ORDER_SEARCH_SQL = `
select
  sub.id,
  cur.order_no,
  sub.status,
  sub.pay_amount,
  sub.currency,
  tenant.name as tenant_name
from metering.subscriptions sub
join billing.orders cur on cur.id = sub.current_order_id
join tenancy.tenants tenant on tenant.id = sub.tenant_id
where sub.deleted_at is null
  and cur.order_no ilike $1
order by sub.created_at desc
limit ${PER_KIND_LIMIT}
`;

const OPERATOR_SEARCH_SQL = `
select
  a.id,
  a.username,
  a.display_name,
  a.email,
  r.role_name
from admin.operator_account a
join admin.operator_role r on r.id = a.role_id
where a.deleted_at is null
  and a.is_workforce_visible = true
  and (
    a.username ilike $1
    or a.display_name ilike $1
    or a.email ilike $1
  )
order by a.sort asc, a.created_at asc
limit ${PER_KIND_LIMIT}
`;

interface TenantHitRow {
  id: string;
  name: string | null;
  tenant_no: string | null;
}

interface OrderHitRow {
  id: string;
  order_no: string | null;
  status: string | null;
  pay_amount: string | number | null;
  currency: string | null;
  tenant_name: string | null;
}

interface OperatorHitRow {
  id: string;
  username: string | null;
  display_name: string | null;
  email: string | null;
  role_name: string | null;
}

@Controller("api/search")
export class SearchRouter {
  constructor(@Inject(ADMIN_BFF_RO_POOL) private readonly pool: Pool) {}

  @Get()
  async search(
    @Req() req: Request & RequestContext,
    @Query("q") q?: string,
  ): Promise<AdminSearchResponse> {
    assertSession(req);

    const query = (q ?? "").trim();
    if (query.length < MIN_QUERY_LENGTH) {
      return { query, items: [], skipped: true };
    }
    // ILIKE 的通配符由后端加，前端只传裸串——让前端拼 `%` 会把通配符语法
    // 泄露成用户可输入的东西（搜 "50%" 会变成任意匹配）。用户输入里的 `%`
    // 与 `_` 因此也需要转义，否则它们在这里是通配符而不是字面量。
    const needle = `%${query.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    const caps = req.capabilities ?? [];
    const can = (code: string) => caps.includes(code);

    /* 三源并发。能力不足的源根本不发查询；发出去的源若失败（超时、连接
     * 耗尽）只丢自己那一类，不整体 500。 */
    const [tenants, orders, operators] = await Promise.all([
      can("platform.tenant.manage")
        ? this.pool
            .query<TenantHitRow>(TENANT_SEARCH_SQL, [needle])
            .then((r) => r.rows)
            .catch(() => [])
        : Promise.resolve([]),
      can("commerce:order.read")
        ? this.pool
            .query<OrderHitRow>(ORDER_SEARCH_SQL, [needle])
            .then((r) => r.rows)
            .catch(() => [])
        : Promise.resolve([]),
      can("operator:account.manage")
        ? this.pool
            .query<OperatorHitRow>(OPERATOR_SEARCH_SQL, [needle])
            .then((r) => r.rows)
            .catch(() => [])
        : Promise.resolve([]),
    ]);

    const tenantHits: AdminSearchResultItem[] = tenants.map((row) => ({
      kind: "tenant" as const,
      id: row.id,
      label: row.name ?? row.tenant_no ?? row.id,
      // 状态是枚举码（active / suspended…），后端不下发展示文案，前端也没有
      // 现成的 i18n 键给它——与其把裸码摆到面板上，不如不摆。
      ...(row.tenant_no ? { description: row.tenant_no } : {}),
      href: `/tenants/${encodeURIComponent(row.id)}`,
    }));

    const orderHits: AdminSearchResultItem[] = orders.map((row) => ({
      kind: "order" as const,
      id: row.id,
      label: row.order_no ?? row.id,
      ...(row.tenant_name ? { description: row.tenant_name } : {}),
      ...(row.pay_amount != null
        ? { meta: `${row.currency ?? "CNY"} ${row.pay_amount}` }
        : {}),
      href: `/orders?order=${encodeURIComponent(row.id)}`,
    }));

    const operatorHits: AdminSearchResultItem[] = operators.map((row) => ({
      kind: "operator" as const,
      id: row.id,
      label: row.display_name ?? row.username ?? row.id,
      ...(row.email ? { description: row.email } : {}),
      ...(row.role_name ? { meta: row.role_name } : {}),
      href: `/platform-admins?admin=${encodeURIComponent(row.id)}`,
    }));

    return {
      query,
      items: [...tenantHits, ...orderHits, ...operatorHits],
      skipped: false,
    };
  }
}
