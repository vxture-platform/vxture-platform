"use client";

/**
 * /atlas — 模型平台(租户视角只读:可用模型 / 授权 / 配额 / 用量)。
 * 批 0c:整页接 i18n(atlasPage 命名空间),此前表头 / 空态 / 指标是英文字面量、
 * 标题是中文字面量,中英混排。页面门 = tenant.model.read(批 0a;暂不授予任何角色,
 * 批 7 整改后再对客户开放)。
 */

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CapabilityGate } from "@/features/permissions/CapabilityGate";
import {
  Banner,
  DataTable,
  EmptyState,
  MetricGrid,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import type { DataTableColumn } from "@vxture/design-system";

import {
  fetchAiModels,
  fetchEntitlements,
  fetchTenantModelQuotas,
  fetchTenantModelUsage,
  type WorkspaceEntitlement,
} from "@/api/console-bff";
import type {
  AiModelRecord,
  SummaryMetric,
  TenancyQuotaResponse,
  TenancyUsageResponse,
} from "@/entities/console";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { DashboardSplit, PageSection, SignalList } from "@/layout/shell";

type ModelRow = [string, string, string, string];
type EntitlementRow = [string, string, string, string];
type QuotaRow = [string, string, string, string];
type UsageRow = [string, string, string, string];

const quotaStatusTone: Record<
  TenancyQuotaResponse["status"],
  Exclude<SummaryMetric["tone"], undefined>
> = {
  covered: "success",
  uncovered: "neutral",
  unavailable: "warning",
};

function AtlasPage() {
  const t = useTranslations("atlasPage");
  const locale = useLocale();
  const { session } = useConsoleSession();
  const [models, setModels] = useState<AiModelRecord[]>([]);
  // 批 7:「模型授权」(tenant↔model)是 Atlas 自己标注为不应存在的 legacy 轴,
  // 管理面已随 #129 退役。这里换成**产品权益**(tenant↔product)——#129 指明的
  // 正确来源;`/tenancy/models` 本来就按授权在服务端过滤过,删掉授权表不丢信息。
  const [entitlements, setEntitlements] = useState<WorkspaceEntitlement[]>([]);
  const [quotas, setQuotas] = useState<TenancyQuotaResponse | null>(null);
  const [usage, setUsage] = useState<TenancyUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const formatNumber = (value: number) =>
    new Intl.NumberFormat(locale).format(value);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);

    Promise.all([
      fetchAiModels(),
      fetchEntitlements(),
      fetchTenantModelQuotas(),
      fetchTenantModelUsage(),
    ])
      .then(([modelRecords, entitlementRows, quotaEnvelope, usageEnvelope]) => {
        if (!active) return;
        setModels(modelRecords);
        setEntitlements(entitlementRows);
        setQuotas(quotaEnvelope);
        setUsage(usageEnvelope);
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [session.tenant?.id]);

  const liveEntitlements = entitlements.filter(
    (e) => e.status !== null && e.status !== "expired",
  );
  const totalTokens =
    usage?.rows.reduce((total, row) => total + row.totalTokens, 0) ?? 0;
  const metrics: SummaryMetric[] = [
    {
      id: "available-models",
      label: t("metrics.models"),
      value: loading ? "-" : formatNumber(models.length),
      trend: t("metrics.modelsHint", { count: liveEntitlements.length }),
      tone: models.length ? "success" : "warning",
    },
    {
      id: "quota-status",
      label: t("metrics.quota"),
      value: loading || !quotas ? "-" : t(`quotaStatus.${quotas.status}`),
      trend: quotas?.tier
        ? t("metrics.quotaTier", { tier: quotas.tier })
        : t("metrics.quotaNoTier"),
      tone: quotas ? quotaStatusTone[quotas.status] : "neutral",
    },
    {
      id: "token-usage",
      label: t("metrics.tokens"),
      value: loading ? "-" : formatNumber(totalTokens),
      trend: usage
        ? t("metrics.tokensHint", { count: usage.rows.length })
        : "-",
      tone: totalTokens > 0 ? "success" : "neutral",
    },
  ];

  const modelColumns: DataTableColumn<ModelRow>[] = [
    { id: "model", header: t("models.colModel"), cell: (row) => row[0] },
    { id: "provider", header: t("models.colProvider"), cell: (row) => row[1] },
    { id: "protocol", header: t("models.colProtocol"), cell: (row) => row[2] },
    {
      id: "capabilities",
      header: t("models.colCapabilities"),
      cell: (row) => row[3],
    },
  ];
  const entitlementColumns: DataTableColumn<EntitlementRow>[] = [
    {
      id: "product",
      header: t("entitlements.colProduct"),
      cell: (row) => row[0],
    },
    { id: "tier", header: t("entitlements.colTier"), cell: (row) => row[1] },
    {
      id: "status",
      header: t("entitlements.colStatus"),
      cell: (row) => row[2],
    },
    {
      id: "limits",
      header: t("entitlements.colLimits"),
      cell: (row) => row[3],
    },
  ];
  const quotaColumns: DataTableColumn<QuotaRow>[] = [
    { id: "metric", header: t("quotas.colMetric"), cell: (row) => row[0] },
    {
      id: "remaining",
      header: t("quotas.colRemaining"),
      cell: (row) => row[1],
    },
    { id: "priority", header: t("quotas.colPriority"), cell: (row) => row[2] },
    { id: "tier", header: t("quotas.colTier"), cell: (row) => row[3] },
  ];
  const usageColumns: DataTableColumn<UsageRow>[] = [
    { id: "model", header: t("usage.colModel"), cell: (row) => row[0] },
    { id: "provider", header: t("usage.colProvider"), cell: (row) => row[1] },
    { id: "requests", header: t("usage.colRequests"), cell: (row) => row[2] },
    {
      id: "tokens",
      header: t("usage.colTokens"),
      cell: (row) => row[3],
      align: "right",
    },
  ];

  const modelRows = models.map<ModelRow>((model) => [
    model.modelName,
    model.provider,
    model.protocol,
    model.capabilities.join(", ") || "-",
  ]);
  const entitlementRows = entitlements.map<EntitlementRow>((e) => [
    e.bundled
      ? `${e.productCode} · ${t("entitlements.bundled")}`
      : e.productCode,
    e.tier ?? t("entitlements.none"),
    e.status ?? t("entitlements.none"),
    Object.entries(e.limits)
      .map(([k, v]) => `${k} ${formatNumber(v)}`)
      .join(" · ") || "-",
  ]);
  const quotaRows = (quotas?.pools ?? []).map<QuotaRow>((pool) => [
    pool.metric,
    `${formatNumber(pool.remaining)} / ${formatNumber(pool.limit)}`,
    String(pool.priority),
    quotas?.tier ?? "-",
  ]);
  const usageRows = (usage?.rows ?? []).map<UsageRow>((row) => [
    row.modelCode ?? "-",
    row.providerCode ?? "-",
    formatNumber(row.requests),
    formatNumber(row.totalTokens),
  ]);

  const quotaEmptyMessage = quotas
    ? {
        covered: t("quotas.emptyCovered"),
        uncovered: t("quotas.emptyUncovered"),
        unavailable: t("quotas.emptyUnavailable"),
      }[quotas.status]
    : t("quotas.emptyNone");

  const statusSignals = [
    {
      title: t("signals.scopeTitle"),
      description: session.tenant?.name
        ? t("signals.scopeBody", { tenant: session.tenant.name })
        : t("signals.scopeMissing"),
    },
    {
      title: t("signals.boundaryTitle"),
      description: t("signals.boundaryBody"),
    },
  ];

  return (
    <ViewLayout>
      <ViewHeader
        icon="cube"
        title={t("title")}
        description={t("description")}
      />

      {loadError ? <Banner tone="danger" title={t("loadError")} /> : null}

      <MetricGrid items={metrics} aria-label={t("metrics.groupLabel")} />

      <DashboardSplit>
        <PageSection
          icon="cube"
          level={2}
          title={t("models.title")}
          description={t("models.description")}
        >
          <DataTable
            columns={modelColumns}
            rows={modelRows}
            rowKey={(row, index) => row[0] ?? String(index)}
            loading={loading}
            empty={<EmptyState title={t("models.empty")} />}
          />
        </PageSection>

        <PageSection
          icon="key"
          level={2}
          title={t("entitlements.title")}
          description={t("entitlements.description")}
        >
          <DataTable
            columns={entitlementColumns}
            rows={entitlementRows}
            rowKey={(row, index) => `${row[0]}-${index}`}
            loading={loading}
            empty={<EmptyState title={t("entitlements.empty")} />}
          />
        </PageSection>
      </DashboardSplit>

      <DashboardSplit>
        <PageSection
          icon="database"
          level={2}
          title={t("quotas.title")}
          description={t("quotas.description")}
        >
          <DataTable
            columns={quotaColumns}
            rows={quotaRows}
            rowKey={(row, index) => `${row[0]}-${index}`}
            loading={loading}
            empty={<EmptyState title={quotaEmptyMessage} />}
          />
        </PageSection>

        <PageSection
          icon="chart-bar"
          level={2}
          title={t("usage.title")}
          description={t("usage.description")}
        >
          <DataTable
            columns={usageColumns}
            rows={usageRows}
            rowKey={(row, index) => `${row[0]}-${row[1]}-${index}`}
            loading={loading}
            empty={<EmptyState title={t("usage.empty")} />}
          />
        </PageSection>
      </DashboardSplit>

      <PageSection
        icon="info"
        level={2}
        title={t("signals.title")}
        description={t("signals.description")}
      >
        <SignalList items={statusSignals} />
      </PageSection>
    </ViewLayout>
  );
}

export default function Page() {
  return (
    <CapabilityGate capability="tenant.model.read">
      <AtlasPage />
    </CapabilityGate>
  );
}
