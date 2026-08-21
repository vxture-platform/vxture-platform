"use client";

/**
 * AuditLogsPage.tsx — 审计日志(owner 2026-08-21 P1)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 租户操作轨迹(support.audit_logs,按 tenant_id 过滤;写入 = console 各写
 * 端点的 customer 审计钩子,与 admin/opera 运营面同表分面)。只读台账:
 * {全部|成功|失败} 筛选,近 90 天,200 条上限。capability 门
 * tenant.audit.read(owner/manager)。表格遵守默认结构(序号列,无操作列)。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  DataTable,
  EmptyState,
  SegmentedControl,
  StatusBadge,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import type { DataTableColumn, StatusBadgeTone } from "@vxture/design-system";
import { fetchAuditLogs, type ConsoleAuditLog } from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { PageSection, SignalList } from "@/layout/shell";
import { fmtDate, fmtTime } from "@/modules/commerce/components/hubModel";

const RESULT_TONES: Record<ConsoleAuditLog["result"], StatusBadgeTone> = {
  success: "success",
  failure: "warning",
  denied: "warning",
};

/** 已知动作 → i18n 键(点转下划线;未知动作回退原码,契约演进容错)。 */
const KNOWN_ACTIONS = new Set([
  "tenant.member.invite",
  "tenant.member.update",
  "tenant.member.disable",
  "tenant.member.reset_password",
  "tenant.member.remove",
  "tenant.verification.submit",
  "subscription.pause",
  "subscription.resume",
  "subscription.cancel",
  "subscription.auto_renew_on",
  "subscription.auto_renew_off",
  "addon.order.create",
  "addon.order.payment_declare",
  "addon.order.cancel",
  "billing.address.create",
  "billing.address.update",
  "billing.address.delete",
  "billing.invoice.apply",
]);

type ResultFilter = "all" | "success" | "failure";

export function AuditLogsPage() {
  const t = useTranslations("auditPage");
  const { session } = useConsoleSession();

  const [rows, setRows] = useState<ConsoleAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ResultFilter>("all");

  useEffect(() => {
    setLoading(true);
    fetchAuditLogs(filter === "all" ? undefined : filter)
      .then(setRows)
      .finally(() => setLoading(false));
  }, [session.tenant?.id, filter]);

  // useCallback 而非普通函数:它被 columns 的 useMemo 引用,不稳定的话
  // 要么进依赖数组导致每渲染重建列、要么被漏掉留一条 exhaustive-deps 警告。
  // 它只依赖 t,包一层即可两头都对。
  const actionLabel = useCallback(
    (action: string): string =>
      KNOWN_ACTIONS.has(action)
        ? t(`action.${action.replace(/\./g, "_")}`)
        : action,
    [t],
  );

  const columns = useMemo<DataTableColumn<ConsoleAuditLog>[]>(
    () => [
      {
        id: "at",
        header: t("table.colAt"),
        cell: (r) => (
          <span className="flex flex-col tabular-nums">
            <span className="text-foreground">{fmtDate(r.at)}</span>
            <span className="text-body-sm text-muted-foreground">
              {fmtTime(r.at)}
            </span>
          </span>
        ),
      },
      {
        id: "actor",
        header: t("table.colActor"),
        cell: (r) =>
          r.actorType === "customer" ? (
            (r.actorName ?? "—")
          ) : (
            <Badge variant="outline">
              {t(
                `actorType.${r.actorType === "operator" ? "operator" : "system"}`,
              )}
            </Badge>
          ),
      },
      {
        id: "action",
        header: t("table.colAction"),
        cell: (r) => (
          <span className="flex flex-col">
            <span className="text-foreground">{actionLabel(r.action)}</span>
            <span className="font-mono text-body-sm text-muted-foreground">
              {r.action}
            </span>
          </span>
        ),
      },
      {
        id: "resource",
        header: t("table.colResource"),
        cell: (r) => (
          <span className="font-mono text-body-sm text-muted-foreground">
            {r.resourceId}
          </span>
        ),
      },
      {
        id: "result",
        header: t("table.colResult"),
        align: "center",
        cell: (r) => (
          <StatusBadge tone={RESULT_TONES[r.result]}>
            {t(`result.${r.result}`)}
          </StatusBadge>
        ),
      },
      {
        id: "ip",
        header: t("table.colIp"),
        align: "right",
        cell: (r) =>
          r.ipAddress ? (
            <span className="font-mono text-body-sm text-muted-foreground">
              {r.ipAddress}
            </span>
          ) : (
            "—"
          ),
      },
    ],
    [t, actionLabel],
  );

  return (
    <ViewLayout>
      <ViewHeader
        icon="clipboard"
        title={t("title")}
        description={t("description")}
      />

      <PageSection
        icon="clipboard"
        level={2}
        title={t("table.title")}
        description={t("table.description")}
        action={
          <SegmentedControl<ResultFilter>
            ariaLabel={t("table.filterLabel")}
            value={filter}
            onChange={setFilter}
            items={[
              { value: "all", label: t("table.filterAll") },
              { value: "success", label: t("table.filterSuccess") },
              { value: "failure", label: t("table.filterFailure") },
            ]}
          />
        }
      >
        <DataTable<ConsoleAuditLog>
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={loading}
          indexStart={1}
          empty={<EmptyState title={t("table.empty")} />}
        />
      </PageSection>

      <PageSection
        icon="info"
        level={2}
        title={t("notes.title")}
        description={t("notes.description")}
      >
        <SignalList
          items={[
            { title: t("notes.scopeTitle"), description: t("notes.scopeBody") },
            {
              title: t("notes.retainTitle"),
              description: t("notes.retainBody"),
            },
          ]}
        />
      </PageSection>
    </ViewLayout>
  );
}
