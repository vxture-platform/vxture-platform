/**
 * operator-notices.router.ts — 运营通告的发布面。
 * @package @vxture/bff-opera
 * @layer Application
 * @category Router
 *
 * owner 2026-09-20：「面向客户的由 admin 发布，面向内部运营的由 opera 发布」。
 * 所以**写侧只在这里**——admin / arche 只读（它们各自的 BFF 用本平面根码读）。
 *
 * 与 `admin.announcements` 的分界：那张是面向**客户**的平台公告（target_plans /
 * target_tenant_types / is_dismissible / cta_url，客户在 console 看见），发布面在
 * admin，能力码是 `content:announcement.*`。本表面向**运营者**，能力码
 * `ops:notice.*`，两条线互不相干。
 *
 * ── 撤回是软删，不是硬删 ──
 * 通告已经被人看过、已读关系也已经落表；硬删会让那些已读记录跟着 CASCADE 消失，
 * 于是「我读过没有」这个事实被改写。软删只是让它退出列表。
 *
 * ── 本批只做 manual ──
 * 表上的 `source` 留了 `system` 这条路（产品上线等事件自动播报），但平台目前没有
 * 站内生产者（services/notification 只有 mail / sms / dispatch 三个投递通道）。
 * 这里**拒绝**接受客户端传 source：人手发的一律 manual，system 将来由事件侧直接
 * 写库，不走这个路由。
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import {
  NOTICE_PLANES,
  NOTICE_SEVERITIES,
  type NoticePlane,
  type NoticeSeverity,
} from "@vxture/service-notice";
import { insertOperatorAuditLog } from "../audit/audit-log";
import { withTransaction } from "../db/tx";
import {
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
  optionalText,
  parseIso,
  requireOperatorId,
  requireText,
  requireUuid,
  toIso,
  toIsoOrNull,
} from "./router.shared";

/* 平面码与严重度取自 @vxture/service-notice：它们是表上那两条 CHECK 约束在代码
 * 里的投影，只该有一处。此前 opera 与 admin 各写了一份——加第四个平面时，改了
 * 一处没改另一处，症状分别是插入吃 23514、与新平面在读侧永远匹配不上。 */
const PLANES = NOTICE_PLANES;
type Plane = NoticePlane;

const SEVERITIES = NOTICE_SEVERITIES;
type Severity = NoticeSeverity;

export interface OperatorNoticeItem {
  id: string;
  /** 空数组 = 三个平面都看得见。 */
  targetPlanes: Plane[];
  severity: Severity;
  title: string;
  body: string;
  link: string | null;
  source: "manual" | "system";
  publishedAt: string;
  expiresAt: string | null;
  /** 发布人显示名；账号注销后读不到，显示「—」由前端决定。 */
  createdByName: string | null;
  createdAt: string;
}

interface OperatorNoticeRow {
  id: string;
  target_planes: string[];
  severity: string;
  title: string;
  body: string;
  link: string | null;
  source: string;
  published_at: Date;
  expires_at: Date | null;
  created_by_name: string | null;
  created_at: Date;
}

function mapRow(row: OperatorNoticeRow): OperatorNoticeItem {
  return {
    id: row.id,
    targetPlanes: row.target_planes as Plane[],
    severity: row.severity as Severity,
    title: row.title,
    body: row.body,
    link: row.link,
    source: row.source as "manual" | "system",
    publishedAt: toIso(row.published_at),
    expiresAt: toIsoOrNull(row.expires_at),
    createdByName: row.created_by_name,
    createdAt: toIso(row.created_at),
  };
}

// 发布人取 display_name：**不回 created_by 那个 uuid**（全站规则：任何场景不展示
// UUID）。账号注销后 join 不到，回 null，前端画「—」。
const NOTICE_SELECT = `
  select n.id, n.target_planes, n.severity, n.title, n.body, n.link, n.source,
         n.published_at, n.expires_at, n.created_at,
         nullif(a.display_name, '') as created_by_name
    from admin.operator_notices n
    left join admin.operator_account a on a.id = n.created_by
`;

export interface OperatorNoticeWriteBody {
  title?: unknown;
  body?: unknown;
  link?: unknown;
  severity?: unknown;
  targetPlanes?: unknown;
  expiresAt?: unknown;
}

interface NormalizedNotice {
  title: string;
  body: string;
  link: string | null;
  severity: Severity;
  targetPlanes: Plane[];
  /** parseIso 回的是 ISO 串,不是 Date——pg 直接收字符串。 */
  expiresAt: string | null;
}

function normalize(input: OperatorNoticeWriteBody): NormalizedNotice {
  const title = requireText(input.title, "title", 256);
  const body = requireText(input.body, "body", 8000);
  const link = optionalText(input.link, "link", 512);

  const severityRaw = input.severity === undefined ? "info" : input.severity;
  if (!SEVERITIES.includes(severityRaw as Severity)) {
    throw invalidRequest(
      "VALIDATION_INVALID_VALUE",
      `severity must be one of ${SEVERITIES.join("/")}`,
      "severity",
    );
  }

  // 未给 = 空数组 = 三个平面都看得见。**不展开成三个元素**：将来加平面时，
  // 展开过的历史行会把新平面漏掉，而空数组自动包含它。
  let targetPlanes: Plane[] = [];
  if (input.targetPlanes !== undefined) {
    if (!Array.isArray(input.targetPlanes)) {
      throw invalidRequest(
        "VALIDATION_INVALID_VALUE",
        "targetPlanes must be an array",
        "targetPlanes",
      );
    }
    const seen = new Set<string>();
    for (const raw of input.targetPlanes) {
      if (typeof raw !== "string" || !PLANES.includes(raw as Plane)) {
        throw invalidRequest(
          "VALIDATION_INVALID_VALUE",
          `targetPlanes must contain only ${PLANES.join("/")}`,
          "targetPlanes",
        );
      }
      seen.add(raw);
    }
    // 三个都选 = 全选，收敛成空数组，与「未给」落成同一种表示。
    // 两种写法在库里各存一份的话，读侧的 `target_planes = '{}'` 判据就会漏掉一半。
    targetPlanes = seen.size === PLANES.length ? [] : ([...seen] as Plane[]);
  }

  const expiresAt =
    input.expiresAt === undefined || input.expiresAt === null
      ? null
      : parseIso(String(input.expiresAt), "expiresAt");

  return {
    title,
    body,
    link,
    severity: severityRaw as Severity,
    targetPlanes,
    expiresAt,
  };
}

@Controller("api/operator-notices")
export class OperatorNoticesRouter {
  constructor(
    @Inject(OPERA_BFF_RO_POOL) private readonly pool: Pool,
    @Inject(OPERA_BFF_RW_POOL) private readonly rwPool: Pool,
  ) {}

  /**
   * GET /api/operator-notices?includeExpired=true
   *
   * 发布面的列表——列的是**这个运营者发布过的全局清单**，不是「我的收件箱」。
   * 默认隐去已过期的：发布面关心的是还在生效的那些。
   */
  @Get()
  async listNotices(
    @Req() req: Request & RequestContext,
    @Query("includeExpired") includeExpired?: string,
  ): Promise<OperatorNoticeItem[]> {
    assertCanReadNotices(req);
    const withExpired = includeExpired === "true";
    const { rows } = await this.pool.query<OperatorNoticeRow>(
      `${NOTICE_SELECT}
        where n.deleted_at is null
          and ($1::bool or n.expires_at is null or n.expires_at > now())
        order by n.published_at desc, n.id desc
        limit $2`,
      [withExpired, LIST_LIMIT],
    );
    return rows.map(mapRow);
  }

  /** POST /api/operator-notices —— 发布一条。source 恒为 manual，见文件头。 */
  @Post()
  async createNotice(
    @Req() req: Request & RequestContext,
    @Body() body: OperatorNoticeWriteBody,
  ): Promise<OperatorNoticeItem> {
    assertCanManageNotices(req);
    const createdBy = requireOperatorId(req);
    const input = normalize(body);

    return withTransaction(this.rwPool, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into admin.operator_notices
           (target_planes, severity, title, body, link, expires_at, created_by)
         values ($1::varchar(16)[], $2, $3, $4, $5, $6, $7)
         returning id`,
        [
          input.targetPlanes,
          input.severity,
          input.title,
          input.body,
          input.link,
          input.expiresAt,
          createdBy,
        ],
      );
      const created = rows[0];
      if (!created) {
        // 库没按要求插进去 = 本方故障。回 400 会让运营者以为是自己填错了，
        // 然后反复改一个永远改不好的输入。
        throw internalError(
          "OPERATOR_NOTICE_INSERT_FAILED",
          "Operator notice insert returned no row",
        );
      }
      await insertOperatorAuditLog(client, req, {
        action: "governance.operator_notice.create",
        resourceType: "operator_notice",
        resourceId: created.id,
        after: {
          title: input.title,
          severity: input.severity,
          targetPlanes: input.targetPlanes,
        },
      });
      const { rows: fresh } = await client.query<OperatorNoticeRow>(
        `${NOTICE_SELECT} where n.id = $1`,
        [created.id],
      );
      if (!fresh[0]) {
        throw internalError(
          "OPERATOR_NOTICE_READBACK_FAILED",
          "Operator notice read-back returned no row",
        );
      }
      return mapRow(fresh[0]);
    });
  }

  /**
   * DELETE /api/operator-notices/:id —— 撤回（软删）。
   *
   * 不硬删：已读关系挂着 ON DELETE CASCADE，硬删会连带抹掉「谁读过」这个事实。
   * 软删只是让它退出列表。
   */
  @Delete(":id")
  async withdrawNotice(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<{ id: string; withdrawn: true }> {
    assertCanManageNotices(req);
    const noticeId = requireUuid(id, "id", "Invalid notice id");

    return withTransaction(this.rwPool, async (client) => {
      // 条件 UPDATE：已撤回的再撤一次影响 0 行,与「不存在」在这里是同一个回答
      // ——撤回是幂等意图,不值得为「你撤过了」单独报一个错。
      const { rows } = await client.query<{ id: string }>(
        `update admin.operator_notices
            set deleted_at = now(), updated_at = now()
          where id = $1 and deleted_at is null
          returning id`,
        [noticeId],
      );
      if (!rows[0]) {
        const { rows: exists } = await client.query<{ id: string }>(
          `select id from admin.operator_notices where id = $1`,
          [noticeId],
        );
        if (!exists[0]) {
          throw notFound(
            "OPERATOR_NOTICE_NOT_FOUND",
            "Operator notice not found",
          );
        }
        // 已经是撤回态：按幂等回成功，不报 409。
        return { id: noticeId, withdrawn: true as const };
      }
      await insertOperatorAuditLog(client, req, {
        action: "governance.operator_notice.withdraw",
        resourceType: "operator_notice",
        resourceId: noticeId,
      });
      return { id: noticeId, withdrawn: true as const };
    });
  }
}

// ── 能力门 ──────────────────────────────────────────────────────────────────
// 读需要 read 或 manage（能发的人当然能看）；写只认 manage。

function assertCanReadNotices(req: Request & RequestContext): void {
  if (!req.operator) {
    throw unauthenticated("AUTH_NO_SESSION", "No active session");
  }
  if (
    !req.capabilities ||
    (!req.capabilities.includes("ops:notice.read") &&
      !req.capabilities.includes("ops:notice.manage"))
  ) {
    throw notEntitled("ops:notice.read");
  }
}

function assertCanManageNotices(req: Request & RequestContext): void {
  if (!req.operator) {
    throw unauthenticated("AUTH_NO_SESSION", "No active session");
  }
  if (!req.capabilities || !req.capabilities.includes("ops:notice.manage")) {
    throw notEntitled("ops:notice.manage");
  }
}
