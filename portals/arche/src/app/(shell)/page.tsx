"use client";

/* 治理总览 — Arche 治理平台首页。
 *
 * 两块：当前态与待办（BFF 按每一块自己那一页的能力码给，缺席的块就是无权查看——不显示
 * 成 0，0 读作「没有风险」），以及本人能打开的页面入口（与侧栏同一份导航注册表，不另写
 * 一份会过期的卡片清单）。 */

import { useEffect, useMemo, useState, type ComponentProps } from "react";
import {
  Banner,
  EntryCard,
  MetricGrid,
  SectionHeader,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import { fetchGovernanceOverview } from "@/api/arche-bff";
import { visibleNavSections } from "@/config/navigation";
import type { GovernanceOverview } from "@/entities/console";
import { useOperatorSession } from "@/features/session/SessionProvider";
import { formatNumber } from "@/lib/format";

type MetricItem = ComponentProps<typeof MetricGrid>["items"][number];

/** 读不到（null）显示「—」，不显示成 0。 */
function countOrMark(value: number | null): string {
  return value === null ? "—" : formatNumber(value);
}

function overviewMetrics(overview: GovernanceOverview): MetricItem[] {
  const items: MetricItem[] = [];
  const {
    identity,
    sessions,
    signIns,
    audit,
    risk,
    compliance,
    config,
    notifications,
  } = overview;
  if (identity) {
    items.push({
      id: "operators",
      icon: "fingerprint",
      label: "在用平台用户",
      help: "状态为启用的运营账号；停用、锁定、待激活另计。",
      value: formatNumber(identity.activeOperators),
      tags: [`其他状态 ${formatNumber(identity.inactiveOperators)}`],
    });
    items.push({
      id: "roles",
      icon: "role",
      label: "平台角色",
      help: "界面可见的角色数，含系统预置。",
      value: formatNumber(identity.roles),
      tags: [`自定义 ${formatNumber(identity.customRoles)}`],
    });
  }
  if (sessions) {
    items.push({
      id: "sessions",
      icon: "clock",
      label: "在线会话",
      help: "登录服务里仍然有效的运营账号会话；登录服务读不到时显示「—」。",
      value: countOrMark(sessions.activeSessions),
      tags: [`在线账号 ${countOrMark(sessions.onlineOperators)}`],
    });
  }
  if (signIns) {
    items.push({
      id: "sign-ins",
      icon: "list",
      label: "24 小时登录失败",
      help: "凭证错误、二次验证失败或被锁定的登录尝试；待二次验证不算。",
      value: formatNumber(signIns.failed24h),
      tags: [`登录告警 ${formatNumber(signIns.alerts24h)}`],
      ...(signIns.alerts24h > 0
        ? { tone: "danger" as const }
        : signIns.failed24h > 0
          ? { tone: "warning" as const }
          : {}),
    });
  }
  if (audit) {
    items.push({
      id: "audit",
      icon: "clipboard",
      label: "今日操作",
      help: "今天（服务器时区）写入审计日志的操作。",
      value: formatNumber(audit.today),
      tags: [`失败或被拒 ${formatNumber(audit.failedToday)}`],
      ...(audit.failedToday > 0 ? { tone: "warning" as const } : {}),
    });
  }
  if (risk) {
    items.push({
      id: "risk",
      icon: "shield-check",
      label: "待审阅高风险",
      help: "等级为高风险、尚未审阅的风险记录。",
      value: formatNumber(risk.pendingHigh),
      tags: [`需跟进 ${formatNumber(risk.pendingFollowUp)}`],
      ...(risk.pendingHigh > 0 ? { tone: "danger" as const } : {}),
    });
  }
  if (compliance) {
    items.push({
      id: "compliance",
      icon: "certificate",
      label: "待处理合规事件",
      help: "状态为待处理的合规事件。",
      value: formatNumber(compliance.open),
      tags: [`处理中 ${formatNumber(compliance.inReview)}`],
      ...(compliance.open > 0 ? { tone: "warning" as const } : {}),
    });
  }
  if (config) {
    items.push({
      id: "flags",
      icon: "tree-structure",
      label: "已启用开关",
      help: "未归档且全局启用的特性开关。",
      value: formatNumber(config.enabledFlags),
      tags: [`未归档 ${formatNumber(config.activeFlags)}`],
    });
  }
  if (notifications) {
    items.push({
      id: "notifications",
      icon: "terminal",
      label: "24 小时投递失败",
      help: "最近 24 小时失败或被退回的通知。",
      value: formatNumber(notifications.failed24h),
      ...(notifications.failed24h > 0 ? { tone: "danger" as const } : {}),
    });
  }
  return items;
}

export default function GovernanceOverviewPage() {
  const { capabilities } = useOperatorSession();
  const [overview, setOverview] = useState<GovernanceOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchGovernanceOverview()
      .then((value) => {
        if (active) setOverview(value);
      })
      .catch((error) => {
        if (active)
          setLoadError(error instanceof Error ? error.message : "读取失败");
      });
    return () => {
      active = false;
    };
  }, []);

  const metrics = useMemo(
    () => (overview ? overviewMetrics(overview) : []),
    [overview],
  );
  const entries = useMemo(
    () =>
      visibleNavSections(capabilities).flatMap((section) =>
        section.items
          .filter((item) => item.href !== "/")
          .map((item) => ({ ...item, meta: section.title })),
      ),
    [capabilities],
  );

  return (
    <ViewLayout>
      <ViewHeader
        icon="squares-four"
        title="治理总览"
        description="平台身份权限、登录会话、安全审计、风控合规与系统配置的当前态。"
      />
      {loadError ? (
        <Banner tone="danger" title="当前态读取失败" description={loadError} />
      ) : overview === null || metrics.length > 0 ? (
        <MetricGrid
          aria-label="治理当前态"
          columns={4}
          loading={overview === null}
          items={
            overview === null
              ? [
                  { id: "a", label: "—", value: "—" },
                  { id: "b", label: "—", value: "—" },
                  { id: "c", label: "—", value: "—" },
                  { id: "d", label: "—", value: "—" },
                ]
              : metrics
          }
        />
      ) : null}
      <SectionHeader level={2} icon="list-checks" title="入口" />
      <div className="grid gap-md sm:grid-cols-2 xl:grid-cols-3">
        {entries.map((item) => (
          <EntryCard
            key={item.href}
            href={item.href}
            icon={item.icon}
            title={item.label}
            meta={item.meta}
            description={item.description}
          />
        ))}
      </div>
    </ViewLayout>
  );
}
