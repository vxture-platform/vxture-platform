/**
 * governance-overview.router.ts — 治理总览的当前态与待办（只读）。
 * @package @vxture/bff-arche
 * @layer Application
 * @category Router
 *
 * 总览此前只有一排入口卡：页面注释写着「真实治理仪表待有真数据源再接」，而数据源
 * 其实都在——账号、会话、审计、风险、合规、开关、投递，每一块都已有表。
 *
 * **每一块按它自己那一页的能力码给**：看不到风险记录页的人，总览里也没有风险那一块
 * （不是显示 0——0 读作「没有风险」）。所以响应里一块缺席就是「无权查看」，
 * 门户照此不渲染那一块。进得了本平台（`arche.plane`）就能打开总览本身。
 */
import { Controller, Get, Inject, Req } from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { OperatorAdminService } from "../auth/operator-admin.service";
import { ARCHE_BFF_RO_POOL } from "../tokens";
import type { RequestContext } from "../types/request-context";
import { summarizeSessions } from "./operator-sessions.router";
import { LOGIN_ALERT_SQL, SIGN_IN_FAILED_SQL } from "./sign-in-logs.router";

export interface GovernanceOverview {
  identity?: {
    activeOperators: number;
    inactiveOperators: number;
    roles: number;
    customRoles: number;
  };
  /** 在线会话（IdP 中央会话）。登录服务暂不可读时两项为 null——不是 0。 */
  sessions?: {
    activeSessions: number | null;
    onlineOperators: number | null;
  };
  signIns?: {
    failed24h: number;
    alerts24h: number;
  };
  audit?: {
    today: number;
    failedToday: number;
  };
  risk?: {
    pendingHigh: number;
    pendingFollowUp: number;
  };
  compliance?: {
    open: number;
    inReview: number;
  };
  config?: {
    enabledFlags: number;
    activeFlags: number;
  };
  notifications?: {
    failed24h: number;
  };
}

const anyOf = (req: RequestContext, ...codes: string[]) =>
  codes.some((code) => req.capabilities?.includes(code));

@Controller("api/overview")
export class GovernanceOverviewRouter {
  constructor(
    @Inject(ARCHE_BFF_RO_POOL) private readonly pool: Pool,
    @Inject(OperatorAdminService) private readonly idp: OperatorAdminService,
  ) {}

  @Get()
  async overview(
    @Req() req: Request & RequestContext,
  ): Promise<GovernanceOverview> {
    const count = async (sql: string): Promise<Record<string, number>> => {
      const { rows } = await this.pool.query<Record<string, number>>(sql);
      return rows[0] ?? {};
    };

    const [
      identity,
      roles,
      sessions,
      signIns,
      audit,
      risk,
      compliance,
      config,
      notifications,
    ] = await Promise.all([
      anyOf(req, "operator:account.manage")
        ? count(`select count(*) filter (where status = 'active')::int as active,
                          count(*) filter (where status <> 'active')::int as inactive
                     from admin.operator_account
                    where deleted_at is null and is_workforce_visible = true`)
        : null,
      anyOf(req, "operator:role.manage")
        ? count(`select count(*)::int as total,
                          count(*) filter (where is_system = false)::int as custom
                     from admin.operator_role
                    where is_workforce_visible = true`)
        : null,
      /* undefined = 无权查看（整块缺席）；null = 登录服务读不到（块在、数字显示「—」）。 */
      anyOf(req, "operator:session.read")
        ? this.idp
            .listOperatorSessions()
            .then(summarizeSessions)
            .catch(() => null)
        : undefined,
      anyOf(req, "audit:sign_in_log.read")
        ? count(`select
                     (select count(*)::int
                        from admin.operator_login_attempt la
                       where ${SIGN_IN_FAILED_SQL}
                         and la.created_at > now() - interval '24 hours') as failed,
                     (select count(*)::int
                        from support.audit_logs a
                       where ${LOGIN_ALERT_SQL}
                         and a.created_at > now() - interval '24 hours') as alerts`)
        : null,
      anyOf(req, "audit:log.read")
        ? count(`select count(*)::int as today,
                          count(*) filter (where result <> 'success')::int as failed
                     from support.audit_logs
                    where created_at >= date_trunc('day', now())`)
        : null,
      anyOf(req, "risk:record.read", "risk:record.manage")
        ? count(`select count(*) filter (where risk_level = 'high')::int as high,
                          count(*) filter (where risk_level = 'follow_up')::int as follow_up
                     from admin.risk_records
                    where deleted_at is null and reviewer_id is null`)
        : null,
      anyOf(req, "compliance:event.read", "compliance:event.manage")
        ? count(`select count(*) filter (where status = 'open')::int as open,
                          count(*) filter (where status = 'in_review')::int as in_review
                     from admin.compliance_events
                    where deleted_at is null`)
        : null,
      anyOf(req, "config:feature_flag.read", "config:feature_flag.manage")
        ? count(`select count(*) filter (where is_globally_enabled)::int as enabled,
                          count(*)::int as active
                     from admin.feature_flags
                    where is_archived = false`)
        : null,
      anyOf(req, "audit:notification_log.read")
        ? count(`select count(*)::int as failed
                     from support.notification_logs
                    where status in ('failed', 'bounced')
                      and created_at > now() - interval '24 hours'`)
        : null,
    ]);

    return {
      ...(identity || roles
        ? {
            identity: {
              activeOperators: identity?.["active"] ?? 0,
              inactiveOperators: identity?.["inactive"] ?? 0,
              roles: roles?.["total"] ?? 0,
              customRoles: roles?.["custom"] ?? 0,
            },
          }
        : {}),
      ...(sessions !== undefined
        ? {
            sessions: {
              activeSessions: sessions?.activeSessions ?? null,
              onlineOperators: sessions?.onlineOperators ?? null,
            },
          }
        : {}),
      ...(signIns
        ? {
            signIns: {
              failed24h: signIns["failed"] ?? 0,
              alerts24h: signIns["alerts"] ?? 0,
            },
          }
        : {}),
      ...(audit
        ? {
            audit: {
              today: audit["today"] ?? 0,
              failedToday: audit["failed"] ?? 0,
            },
          }
        : {}),
      ...(risk
        ? {
            risk: {
              pendingHigh: risk["high"] ?? 0,
              pendingFollowUp: risk["follow_up"] ?? 0,
            },
          }
        : {}),
      ...(compliance
        ? {
            compliance: {
              open: compliance["open"] ?? 0,
              inReview: compliance["in_review"] ?? 0,
            },
          }
        : {}),
      ...(config
        ? {
            config: {
              enabledFlags: config["enabled"] ?? 0,
              activeFlags: config["active"] ?? 0,
            },
          }
        : {}),
      ...(notifications
        ? { notifications: { failed24h: notifications["failed"] ?? 0 } }
        : {}),
    };
  }
}
