"use client";

import { useEffect, useMemo, useState } from "react";
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

const modelColumns: DataTableColumn<ModelRow>[] = [
  { id: "model", header: "Model", cell: (row) => row[0] },
  { id: "provider", header: "Provider", cell: (row) => row[1] },
  { id: "protocol", header: "Protocol", cell: (row) => row[2] },
  { id: "capabilities", header: "Capabilities", cell: (row) => row[3] },
];

const grantColumns: DataTableColumn<GrantRow>[] = [
  { id: "model", header: "Model", cell: (row) => row[0] },
  { id: "scope", header: "Scope", cell: (row) => row[1] },
  { id: "priority", header: "Priority", cell: (row) => row[2] },
  { id: "expires", header: "Expires", cell: (row) => row[3] },
];

const quotaColumns: DataTableColumn<QuotaRow>[] = [
  { id: "metric", header: "Metric", cell: (row) => row[0] },
  { id: "remaining", header: "Remaining / Limit", cell: (row) => row[1] },
  { id: "priority", header: "Priority", cell: (row) => row[2] },
  { id: "tier", header: "Tier", cell: (row) => row[3] },
];

const usageColumns: DataTableColumn<UsageRow>[] = [
  { id: "model", header: "Model", cell: (row) => row[0] },
  { id: "provider", header: "Provider", cell: (row) => row[1] },
  { id: "requests", header: "Requests", cell: (row) => row[2] },
  { id: "tokens", header: "Tokens", cell: (row) => row[3], align: "right" },
];

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

const quotaStatusLabel: Record<TenancyQuotaResponse["status"], string> = {
  covered: "已开通",
  uncovered: "未开通套餐",
  unavailable: "平台不可达",
};

const quotaStatusTone: Record<
  TenancyQuotaResponse["status"],
  Exclude<SummaryMetric["tone"], undefined>
> = {
  covered: "success",
  uncovered: "neutral",
  unavailable: "warning",
};

function buildMetrics(
  models: AiModelRecord[],
  grants: AiModelGrantRecord[],
  quotas: TenancyQuotaResponse | null,
  usage: TenancyUsageResponse | null,
  loading: boolean,
): SummaryMetric[] {
  const activeGrants = grants.filter((grant) => grant.isActive);
  const totalTokens =
    usage?.rows.reduce((total, row) => total + row.totalTokens, 0) ?? 0;

  return [
    {
      id: "available-models",
      label: "Available models",
      value: loading ? "-" : formatNumber(models.length),
      trend: `${formatNumber(activeGrants.length)} active grants`,
      tone: models.length ? "success" : "warning",
    },
    {
      id: "quota-status",
      label: "Quota status",
      value: loading || !quotas ? "-" : quotaStatusLabel[quotas.status],
      trend: quotas?.tier ? `tier: ${quotas.tier}` : "no tier",
      tone: quotas ? quotaStatusTone[quotas.status] : "neutral",
    },
    {
      id: "token-usage",
      label: "Token usage",
      value: loading ? "-" : formatNumber(totalTokens),
      trend: usage ? `${formatNumber(usage.rows.length)} rows` : "-",
      tone: totalTokens > 0 ? "success" : "neutral",
    },
  ];
}

function AtlasPage() {
  const { session } = useConsoleSession();
  const [models, setModels] = useState<AiModelRecord[]>([]);
  const [grants, setGrants] = useState<AiModelGrantRecord[]>([]);
  const [quotas, setQuotas] = useState<TenancyQuotaResponse | null>(null);
  const [usage, setUsage] = useState<TenancyUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

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
  const metrics = buildMetrics(models, grants, quotas, usage, loading);

  const modelRows = models.map<ModelRow>((model) => [
    model.modelName,
    model.provider,
    model.protocol,
    model.capabilities.join(", ") || "-",
  ]);
  const grantRows = grants
    .filter((grant) => grant.isActive)
    .map<GrantRow>((grant) => [
      modelById.get(grant.modelId)?.modelName ?? grant.modelId,
      grant.applicationType
        ? `${grant.applicationType}:${grant.applicationId ?? "-"}`
        : "tenant",
      String(grant.priority),
      grant.expiresAt ?? "Never",
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
        covered: "No active quota pools.",
        uncovered: "No plan published for this workspace yet.",
        unavailable: "Could not reach the platform's entitlement service.",
      }[quotas.status]
    : "No quota data.";

  const statusSignals = [
    {
      title: "Tenant scope",
      description: session.tenant?.name
        ? `Showing model-platform state for ${session.tenant.name}.`
        : "Tenant context is required before model-platform state can be shown.",
    },
    {
      title: "Control-plane boundary",
      description:
        "Provider, model, policy, price, and grant changes are managed by platform operators in Admin.",
    },
  ];

  return (
    <ViewLayout>
      <ViewHeader
        icon="cube"
        title="模型平台"
        description="当前租户可用模型、应用授权、配额和用量状态。"
      />

      {loadError ? (
        <Banner tone="danger" title="模型平台状态加载失败，请稍后重试。" />
      ) : null}

      <MetricGrid items={metrics} />

      <DashboardSplit>
        <PageSection
          icon="cube"
          level={2}
          title="可用模型"
          description="由平台控制面授权给当前租户的模型。"
        >
          <DataTable
            columns={modelColumns}
            rows={modelRows}
            rowKey={(row, index) => row[0] ?? String(index)}
            loading={loading}
            empty={<EmptyState title="No available models." />}
          />
        </PageSection>

        <PageSection
          icon="key"
          level={2}
          title="模型授权"
          description="租户级与应用级模型访问范围。"
        >
          <DataTable
            columns={grantColumns}
            rows={grantRows}
            rowKey={(row, index) => `${row[0]}-${row[1]}-${index}`}
            loading={loading}
            empty={<EmptyState title="No active model grants." />}
          />
        </PageSection>
      </DashboardSplit>

      <DashboardSplit>
        <PageSection
          icon="database"
          level={2}
          title="配额状态"
          description="来自平台侧的套餐配额资源池（非 Atlas 自身数据）。"
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
          title="用量记录"
          description="近期实际调用记录（Atlas 自身日志，非计费口径）。"
        >
          <DataTable
            columns={usageColumns}
            rows={usageRows}
            rowKey={(row, index) => `${row[0]}-${row[1]}-${index}`}
            loading={loading}
            empty={<EmptyState title="No model usage recorded." />}
          />
        </PageSection>
      </DashboardSplit>

      <PageSection
        icon="info"
        level={2}
        title="状态说明"
        description="租户侧仅显示当前上下文可见状态。"
      >
        <SignalList items={statusSignals} />
      </PageSection>
    </ViewLayout>
  );
}

export default function Page() {
  return (
    <CapabilityGate capability={"tenant.model.read"}>
      <AtlasPage />
    </CapabilityGate>
  );
}
