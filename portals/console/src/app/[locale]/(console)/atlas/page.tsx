"use client";

/**
 * /atlas — 模型平台(租户视角只读:可用模型 / 授权 / 配额 / 用量)。
 * 批 0c:整页接 i18n(atlasPage 命名空间),此前表头 / 空态 / 指标是英文字面量、
 * 标题是中文字面量,中英混排。页面门 = tenant.model.read(批 0a;暂不授予任何角色,
 * 批 7 整改后再对客户开放)。
 */

import { useEffect, useMemo, useState } from "react";
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
  fetchAiModelGrants,
  fetchAiModels,
  fetchTenantModelQuotas,
  fetchTenantModelUsage,
} from "@/api/console-bff";
import type {
  AiModelGrantRecord,
  AiModelRecord,
  SummaryMetric,
  TenancyQuotaResponse,
  TenancyUsageResponse,
} from "@/entities/console";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { DashboardSplit, PageSection, SignalList } from "@/layout/shell";

type ModelRow = [string, string, string, string];
type GrantRow = [string, string, string, string];
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
  const [grants, setGrants] = useState<AiModelGrantRecord[]>([]);
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
      fetchAiModelGrants(),
      fetchTenantModelQuotas(),
      fetchTenantModelUsage(),
    ])
      .then(([modelRecords, grantRecords, quotaEnvelope, usageEnvelope]) => {
        if (!active) return;
        setModels(modelRecords);
        setGrants(grantRecords);
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

  const modelById = useMemo(
    () => new Map(models.map((model) => [model.id, model])),
    [models],
  );

  const activeGrants = grants.filter((grant) => grant.isActive);
  const totalTokens =
    usage?.rows.reduce((total, row) => total + row.totalTokens, 0) ?? 0;
  const metrics: SummaryMetric[] = [
    {
      id: "available-models",
      label: t("metrics.models"),
      value: loading ? "-" : formatNumber(models.length),
      trend: t("metrics.modelsHint", { count: activeGrants.length }),
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
  const grantColumns: DataTableColumn<GrantRow>[] = [
    { id: "model", header: t("grants.colModel"), cell: (row) => row[0] },
    { id: "scope", header: t("grants.colScope"), cell: (row) => row[1] },
    { id: "priority", header: t("grants.colPriority"), cell: (row) => row[2] },
    { id: "expires", header: t("grants.colExpires"), cell: (row) => row[3] },
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
  const grantRows = activeGrants.map<GrantRow>((grant) => [
    modelById.get(grant.modelId)?.modelName ?? grant.modelId,
    grant.applicationType
      ? `${grant.applicationType}:${grant.applicationId ?? "-"}`
      : t("grants.scopeTenant"),
    String(grant.priority),
    grant.expiresAt ?? t("grants.never"),
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
          title={t("grants.title")}
          description={t("grants.description")}
        >
          <DataTable
            columns={grantColumns}
            rows={grantRows}
            rowKey={(row, index) => `${row[0]}-${row[1]}-${index}`}
            loading={loading}
            empty={<EmptyState title={t("grants.empty")} />}
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
