"use client";

import { useEffect, useState } from "react";
import {
  DataTable,
  EmptyState,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import type { DataTableColumn } from "@vxture/design-system";
import { DashboardSplit, PageSection } from "@/layout/shell";
import {
  PlannedBadge,
  PlannedEmpty,
  PlannedNotice,
} from "@/components/planned";
import { fetchQuotaUsage, type ConsoleQuotaUsage } from "@/api/console-bff";

// ============================================================================
// QuotasPage
// ============================================================================

/** The one quota source the BFF actually exposes today is a two-metric
 * `{ used, limit }` envelope, so the pool table is derived from it directly
 * rather than from an invented pool catalogue. */
type QuotaPoolRow = {
  id: keyof ConsoleQuotaUsage;
  label: string;
  used: number;
  limit: number;
};

const QUOTA_POOL_LABELS: Record<keyof ConsoleQuotaUsage, string> = {
  storage: "Storage",
  aiCredit: "AI credit",
};

export function QuotasPage() {
  const [usage, setUsage] = useState<ConsoleQuotaUsage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    fetchQuotaUsage()
      .then((result) => {
        if (active) {
          setUsage(result);
        }
      })
      .catch(() => {
        if (active) {
          setUsage(null);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const poolRows: QuotaPoolRow[] = usage
    ? (Object.keys(QUOTA_POOL_LABELS) as Array<keyof ConsoleQuotaUsage>).map(
        (key) => ({
          id: key,
          label: QUOTA_POOL_LABELS[key],
          used: usage[key].used,
          limit: usage[key].limit,
        }),
      )
    : [];

  const poolColumns: DataTableColumn<QuotaPoolRow>[] = [
    { id: "pool", header: "Pool", cell: (row) => row.label },
    {
      id: "used",
      header: "Used",
      align: "right",
      cell: (row) => row.used.toLocaleString(),
    },
    {
      id: "limit",
      header: "Limit",
      align: "right",
      cell: (row) => row.limit.toLocaleString(),
    },
  ];

  return (
    <ViewLayout>
      <ViewHeader
        icon="database"
        title="Quotas"
        description="Quota monitoring should feel operational and readable, not like a dense reporting dashboard."
        secondary={<PlannedBadge />}
      />
      <PlannedNotice />

      <DashboardSplit>
        <PageSection
          icon="gauge"
          level={2}
          title="Quota posture"
          description="Lead with the pools that need human attention before expanding into raw usage rows."
        >
          <PlannedEmpty icon="gauge" />
        </PageSection>

        <PageSection
          icon="warning"
          level={2}
          title="Alert actions"
          description="Quota management should feel like operations, not just reporting."
        >
          <PlannedEmpty icon="warning" />
        </PageSection>
      </DashboardSplit>

      <PageSection
        icon="database"
        level={2}
        title="Quota pools"
        description="Live usage reported by the subscription service for the current workspace."
      >
        <DataTable
          columns={poolColumns}
          rows={poolRows}
          rowKey={(row) => row.id}
          loading={loading}
          empty={
            <EmptyState
              title="Quota pool data is not yet available."
              description="Usage metering is activated once your subscription is provisioned and your first workload runs."
            />
          }
        />
      </PageSection>
    </ViewLayout>
  );
}
