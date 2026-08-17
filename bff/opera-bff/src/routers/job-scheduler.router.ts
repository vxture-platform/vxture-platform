/**
 * job-scheduler.router.ts — 后台任务心跳 + webhook 投递队列观测。
 * @package @vxture/bff-opera
 * @layer Application
 * @category Router
 *
 * 自 admin 的「任务调度」迁入（2026-08-11）。**换了整个数据源，不是同一个功能**：
 * admin 那份读 admin.governance_record（kind='jobs'），这张表从未建过——设计已在
 * docs/30-design/data_admin_200_schema.md 明确弃用（"弃 deploy 通用 governance_record
 * 单表"），admin-bff 那侧的路由自己也承认，先 `to_regclass` 探测不存在就直接返回 []
 * （见 platform-governance.router.ts）。搬空表没有意义。
 *
 * 真实数据分两块：
 *
 * 1. **后台任务心跳**（provisioning.background_jobs）：platform-api 四个
 *    `@Interval` 驱动的作业（provisioning-dispatch / sharing-expiry / trial-expiry /
 *    order-payment-expiry）各占一行、每 tick 原地 UPSERT——不是执行日志，是"这个作业
 *    现在活着吗、上次跑得怎么样"的当前态（最短 10s 一跳，日志化一天上万行没人看得完，
 *    见该表 DDL 表头注）。这张表和四个作业的写路径都是本次migration新建，不是复用
 *    已有的东西——之前从未有任何观测面盯着这四个作业是否还在跑。
 *
 * 2. **webhook 投递队列**（provisioning.webhook_deliveries）：早就存在、真实运行的
 *    生产队列（retry/lease/死信语义齐全），但此前没有任何 admin/opera 观测面——
 *    admin 自己的整改计划把它登记为运维盲区（20-admin-platform-refinement-plan.md：
 *    "provisioning webhook 投递/死信无任何 admin 观测面"）。这里只读 pending/
 *    delivering/delivered/failed/dead 五态计数 + 最近的 failed/dead 明细，不碰写路径
 *    （claim/retry/dead-letter 逻辑已经在 @vxture/service-provisioning 里跑，opera
 *    不重复实现，也不越权代它重试）。
 *
 * 只读、零新增写路径（本路由）：每次请求现读现算，不缓存。未设专属能力码：admin 原
 * 页面的权限码本就是"自认误配"的历史遗留（platform.model.manage 或 audit:read），
 * 不是一个值得延续的授权口径；迁移不新增门槛，只要求已登录 operator（同
 * product-health.router.ts / maintenance-windows.router.ts 之外，这是第三个走这条
 * 口径的路由，模式已经稳定：没有专属能力码就不额外设卡，等哪天真的需要授权分级，
 * 三个一起补，而不是各自埋一个不一致的临时判断）。
 */

import { Controller, Get, Inject, Req } from "@nestjs/common";
import { unauthenticated } from "../errors/api-error";
import type { Request } from "express";
import type { Pool } from "pg";
import { OPERA_BFF_RO_POOL } from "../tokens";
import type { RequestContext } from "../types/request-context";
import { toIso, toIsoOrNull } from "./router.shared";

const RECENT_ISSUES_LIMIT = 30;

export type JobStatus = "idle" | "running" | "success" | "failed";

export interface JobHeartbeatItem {
  jobName: string;
  status: JobStatus;
  intervalMs: number | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastDurationMs: number | null;
  lastItemsProcessed: number | null;
  lastError: string | null;
  runCount: number;
  failureCount: number;
  updatedAt: string;
}

export type WebhookDeliveryStatus =
  | "pending"
  | "delivering"
  | "delivered"
  | "failed"
  | "dead";

export interface WebhookQueueCounts {
  pending: number;
  delivering: number;
  delivered: number;
  failed: number;
  dead: number;
}

export interface WebhookDeliveryIssue {
  id: string;
  eventType: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  nextRetryAt: string | null;
  lastAttemptAt: string | null;
  tenantName: string | null;
  productName: string | null;
}

export interface JobSchedulerSnapshot {
  jobs: JobHeartbeatItem[];
  queue: {
    counts: WebhookQueueCounts;
    recentIssues: WebhookDeliveryIssue[];
  };
}

interface JobHeartbeatRow {
  job_name: string;
  status: JobStatus;
  interval_ms: number | null;
  last_started_at: Date | string | null;
  last_finished_at: Date | string | null;
  last_duration_ms: number | null;
  last_items_processed: number | null;
  last_error: string | null;
  run_count: string | number;
  failure_count: string | number;
  updated_at: Date | string;
}

interface QueueCountRow {
  status: WebhookDeliveryStatus;
  count: string;
}

interface WebhookIssueRow {
  id: string;
  event_type: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  next_retry_at: Date | string | null;
  last_attempt_at: Date | string | null;
  tenant_name: string | null;
  product_name: string | null;
}

const EMPTY_COUNTS: WebhookQueueCounts = {
  pending: 0,
  delivering: 0,
  delivered: 0,
  failed: 0,
  dead: 0,
};

@Controller("api/job-scheduler")
export class JobSchedulerRouter {
  constructor(@Inject(OPERA_BFF_RO_POOL) private readonly pool: Pool) {}

  @Get()
  async getSnapshot(
    @Req() req: Request & RequestContext,
  ): Promise<JobSchedulerSnapshot> {
    if (!req.operator) {
      throw unauthenticated("AUTH_NO_SESSION", "No active session");
    }

    const [jobRows, countRows, issueRows] = await Promise.all([
      this.pool.query<JobHeartbeatRow>(
        `select job_name, status, interval_ms, last_started_at, last_finished_at,
                last_duration_ms, last_items_processed, last_error,
                run_count, failure_count, updated_at
         from provisioning.background_jobs
         order by job_name`,
      ),
      this.pool.query<QueueCountRow>(
        `select status, count(*)::text as count
         from provisioning.webhook_deliveries
         group by status`,
      ),
      this.pool.query<WebhookIssueRow>(
        `select d.id, d.event_type, d.status, d.attempts, d.max_attempts,
                d.last_error, d.next_retry_at, d.last_attempt_at,
                t.name as tenant_name, p.product_name
         from provisioning.webhook_deliveries d
         left join tenancy.tenants t on t.id = d.tenant_id
         left join product.products p on p.id = d.product_id
         where d.status in ('failed', 'dead')
         order by d.last_attempt_at desc nulls last
         limit ${RECENT_ISSUES_LIMIT}`,
      ),
    ]);

    return {
      jobs: jobRows.rows.map(mapJobHeartbeatRow),
      queue: {
        counts: mapQueueCounts(countRows.rows),
        recentIssues: issueRows.rows.map(mapWebhookIssueRow),
      },
    };
  }
}

function mapJobHeartbeatRow(row: JobHeartbeatRow): JobHeartbeatItem {
  return {
    jobName: row.job_name,
    status: row.status,
    intervalMs: row.interval_ms,
    lastStartedAt: toIsoOrNull(row.last_started_at),
    lastFinishedAt: toIsoOrNull(row.last_finished_at),
    lastDurationMs: row.last_duration_ms,
    lastItemsProcessed: row.last_items_processed,
    lastError: row.last_error,
    runCount: Number(row.run_count),
    failureCount: Number(row.failure_count),
    updatedAt: toIso(row.updated_at),
  };
}

function mapQueueCounts(rows: QueueCountRow[]): WebhookQueueCounts {
  const counts = { ...EMPTY_COUNTS };
  for (const row of rows) {
    if (row.status in counts) {
      counts[row.status] = Number(row.count);
    }
  }
  return counts;
}

function mapWebhookIssueRow(row: WebhookIssueRow): WebhookDeliveryIssue {
  return {
    id: row.id,
    eventType: row.event_type,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lastError: row.last_error,
    nextRetryAt: toIsoOrNull(row.next_retry_at),
    lastAttemptAt: toIsoOrNull(row.last_attempt_at),
    tenantName: row.tenant_name,
    productName: row.product_name,
  };
}
