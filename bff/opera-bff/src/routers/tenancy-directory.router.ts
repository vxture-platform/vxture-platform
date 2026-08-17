/**
 * tenancy-directory.router.ts — 租户 / 工作区的 **id → 名称** 查号台。
 * @package @vxture/bff-opera
 * @layer Application
 * @category Router
 *
 * 2026-08-14 新建。起因：Metering 页把 `tenantId` / `workspaceId` 原样渲染成
 * uuid，一屏几十行清一色 `00000000-0000-4000-b000-0000000020xx`——**能读，但读不
 * 出任何东西**。运营看用量是要回答"哪个客户在烧钱"，uuid 回答不了这个问题，还得
 * 另开一个窗口去查，而那个窗口查的就是本文件这两张表。
 *
 * 为什么由 opera-bff 直查而不是找 Atlas 要：Atlas 的 reqlog 里存的就是 uuid，它
 * **也不知道**这些 id 叫什么名字——租户目录是平台的东西，不是 Atlas 的。让 Atlas
 * 去联查平台库才是真的越界。这里读的是 opera-bff 自己那个平台库 pool
 * （`OperaBffPoolsModule`），与 product-catalog / job-scheduler / product-health
 * 三个 router 同样的直连模式。
 *
 * **按 id 批量查，不是把目录全量吐出来。** 目录现在一百来行，全量返回也不会怎么样
 * ——但这个接口的消费方永远只需要"当前这一屏出现过的那些 id"，写成全量意味着租户
 * 长到几千的那天要回来改，而那天没人会记得这里。
 *
 * 只读，且**只回名字**：不回状态、不回归属人、不回任何联系方式。这是一张查号台，
 * 不是租户管理面——那个在 admin。回多余的字段等于在 opera 侧悄悄开了半个租户视图。
 *
 * 能力码复用 `model:model.manage`：调用点是 Atlas 计量页，看得到用量就看得到这些
 * 名字，不额外造一个只有零个持有者的死码。
 */

import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import { notEntitled, unauthenticated } from "../errors/api-error";
import type { Request } from "express";
import type { Pool } from "pg";
import { OPERA_BFF_RW_POOL } from "../tokens";
import type { RequestContext } from "../types/request-context";

const MODEL_MANAGE_CAPABILITY = "model:model.manage";

/** 一次最多查多少个 id。上限存在的理由不是性能，是别让一个拼错的 query 变成全表扫。 */
const MAX_IDS = 500;

export interface TenancyNameRecord {
  id: string;
  name: string;
}

/**
 * 工作区**一定带着它的租户一起回**，不是可选的附加信息。
 *
 * 实测：绝大多数租户只有一个工作区，且名字清一色是 `Default` / `默认工作空间`。
 * 单独回一个工作区名，等于回了一个所有行都一样的字符串——加了这一列和没加一样，
 * 甚至更糟，因为它看起来像是区分开了。只有配上租户才有分辨力。
 *
 * 所以这里做成**服务端 join 而不是让调用方查两次再自己拼**：拼接是每个页面都会
 * 重犯一遍的错（少拼一次就退化成"全是默认工作空间"），而 join 在这里只有一次。
 */
export interface WorkspaceNameRecord extends TenancyNameRecord {
  tenantId: string;
  /** 租户名（org_name）。工作区的显示以它为主导。 */
  tenantName: string;
}

export interface TenancyDirectoryResponse {
  tenants: TenancyNameRecord[];
  workspaces: WorkspaceNameRecord[];
}

@Controller("api/tenancy")
export class TenancyDirectoryRouter {
  constructor(@Inject(OPERA_BFF_RW_POOL) private readonly pool: Pool) {}

  /**
   * `?tenantIds=a,b&workspaceIds=c,d` → 两张 id→name 表。
   *
   * 查不到的 id **不出现在结果里**，而不是回一个 `name: null` 的占位行：调用方据此
   * 退回显示原始 id，那是它当前唯一知道为真的东西。硬造一个"未知租户"的名字，会
   * 让一行已删除的租户和一行拼错的 id 长得一模一样。
   *
   * 已软删的租户/工作区**照常回名字**：用量事实是历史，那笔消耗当时确实属于它。
   * 因为它后来被删掉就把历史记录里的名字抹成 uuid，是让页面对不上账。
   */
  @Get("directory")
  async getDirectory(
    @Req() req: Request & RequestContext,
    @Query("tenantIds") tenantIds?: string,
    @Query("workspaceIds") workspaceIds?: string,
  ): Promise<TenancyDirectoryResponse> {
    assertCanRead(req);

    const tenants = parseIds(tenantIds);
    const workspaces = parseIds(workspaceIds);

    const [tenantRows, workspaceRows] = await Promise.all([
      tenants.length > 0
        ? this.pool.query<TenancyNameRecord>(
            `SELECT id::text AS id, name FROM tenancy.tenants WHERE id = ANY($1::uuid[])`,
            [tenants],
          )
        : Promise.resolve({ rows: [] as TenancyNameRecord[] }),
      workspaces.length > 0
        ? /* INNER JOIN 而不是 LEFT：`workspaces.tenant_id` 是 NOT NULL 且带 FK，
             孤儿工作区在这个库里不可能存在。用 LEFT 会为了一个不会发生的情况让
             tenantName 变成可空，然后每个调用方都要处理那个空。 */
          this.pool.query<WorkspaceNameRecord>(
            `SELECT w.id::text AS id,
                    w.name,
                    w.tenant_id::text AS "tenantId",
                    t.name AS "tenantName"
               FROM tenancy.workspaces w
               JOIN tenancy.tenants t ON t.id = w.tenant_id
              WHERE w.id = ANY($1::uuid[])`,
            [workspaces],
          )
        : Promise.resolve({ rows: [] as WorkspaceNameRecord[] }),
    ]);

    return { tenants: tenantRows.rows, workspaces: workspaceRows.rows };
  }
}

/**
 * 逗号分隔 → 去重的 uuid 数组。
 *
 * 非 uuid 的串直接丢掉而不是原样送进 SQL：`= ANY($1::uuid[])` 遇到一个格式不对的
 * 元素会整条查询 22P02 失败，于是一个脏 id 会让整屏名字都查不出来。丢掉它，其余
 * 照常解析，那一个退回显示原始值。
 */
function parseIds(raw?: string): string[] {
  if (!raw) return [];
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => uuid.test(s)),
    ),
  ).slice(0, MAX_IDS);
}

function assertCanRead(req: Request & RequestContext): void {
  if (!req.operator) {
    throw unauthenticated("AUTH_NO_SESSION", "No active session");
  }
  if (!req.capabilities?.includes(MODEL_MANAGE_CAPABILITY)) {
    throw notEntitled(MODEL_MANAGE_CAPABILITY);
  }
}
