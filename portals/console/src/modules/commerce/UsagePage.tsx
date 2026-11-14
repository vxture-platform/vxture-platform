"use client";

/**
 * UsagePage.tsx - Workspace analytics with one global natural-period scope.
 * @package @vxture/console
 * @layer Presentation
 * @category Module
 * @author AI-Generated
 * @date 2026-11-14
 */

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  BarChart,
  Button,
  Icon,
  MetricGrid,
  SegmentedControl,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import type { MetricGridItem } from "@vxture/design-system";
import {
  fetchUsageAnalytics,
  type ConsoleUsageAnalytics,
  type ConsoleUsageWindow,
} from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { useRouter } from "@/lib/i18n/navigation";
import {
  LoadFailedBanner,
  LoadFailedEmpty,
} from "@/components/load/LoadFailed";
import { PageSection, SectionBody } from "@/layout/shell";
import { fmtCount } from "@/lib/format-metrics";
import { formatTimezone } from "@/lib/display-format";

// ============================================================================
// Readouts
// ============================================================================

function ShareLegend({
  items,
}: {
  items: { key: string; name: string; value: number; percent: number }[];
}) {
  return (
    <ul className="flex flex-wrap gap-x-lg gap-y-sm text-body-sm">
      {items.map((item) => (
        <li key={item.key} className="flex items-baseline gap-xs">
          <span className="text-foreground">{item.name}</span>
          <span className="tabular-nums font-medium text-foreground">
            {fmtCount(item.value)}
          </span>
          <span className="tabular-nums text-muted-foreground">
            {item.percent}%
          </span>
        </li>
      ))}
    </ul>
  );
}

// ============================================================================
// Global scope and data
// ============================================================================

/**
 * Display time, product and user distributions from one analytics snapshot.
 * @returns The workspace usage page.
 */
export function UsagePage() {
  const t = useTranslations("usagePage");
  const locale = useLocale();
  const router = useRouter();
  const { session } = useConsoleSession();
  const [window, setWindow] = useState<ConsoleUsageWindow>("day");
  const [data, setData] = useState<ConsoleUsageAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Retain the request's scope with its response so a workspace/window switch
  // cannot briefly label old numbers as belonging to the new selection.
  const scope = `${session.user?.id ?? ""}:${session.tenant?.id ?? ""}:${session.tenant?.workspace ?? ""}:${window}:${reloadKey}`;
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const ready = loadedScope === scope && !loading && !failed;
  const current = ready ? data : null;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    setData(null);
    fetchUsageAnalytics(window)
      .then((result) => {
        if (!active) return;
        setData(result);
        setLoadedScope(scope);
      })
      .catch(() => {
        if (!active) return;
        setFailed(true);
        setLoadedScope(scope);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [scope, window]);

  const total =
    current?.buckets.reduce((sum, bucket) => sum + bucket.total, 0) ?? 0;
  const products = useMemo(
    () =>
      current?.products.map((product) => ({
        key: product.productCode,
        name: product.productName,
        value: product.total,
        percent: total > 0 ? Math.round((product.total / total) * 100) : 0,
      })) ?? [],
    [current, total],
  );
  const members = useMemo(
    () =>
      current?.members.map((member) => ({
        key: member.userNo ?? "__unattributed__",
        name: member.userName ?? t("unattributed"),
        value: member.total,
        percent: total > 0 ? Math.round((member.total / total) * 100) : 0,
      })) ?? [],
    [current, total, t],
  );
  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: "total",
        icon: "gauge",
        label: t("metrics.total"),
        value: current ? fmtCount(total) : "—",
        trend: t("metrics.creditsUnit"),
      },
      {
        id: "products",
        icon: "chart-pie",
        label: t("metrics.products"),
        value: current
          ? fmtCount(current.products.filter((p) => p.total > 0).length)
          : "—",
      },
      {
        id: "members",
        icon: "users",
        label: t("metrics.members"),
        value: current
          ? fmtCount(
              current.members.filter(
                (m) => m.userNo !== null && m.eventCount > 0,
              ).length,
            )
          : "—",
      },
    ],
    [current, total, t],
  );

  const formatRange = (value: string, zone: string): string =>
    new Intl.DateTimeFormat(locale, {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(value));
  // Hours use UTC keys to distinguish repeated DST hours; other keys are civil dates.
  const periodLabel = (period: string): string => {
    if (window === "hour") {
      return new Intl.DateTimeFormat(locale, {
        timeZone: current?.bucketZone ?? "UTC",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(`${period.replace(" ", "T")}:00Z`));
    }
    if (window === "month") return period.slice(0, 7);
    return period.slice(5, 10);
  };
  const content = (chart: React.ReactNode) =>
    failed ? (
      <LoadFailedEmpty />
    ) : current ? (
      chart
    ) : (
      <p role="status" className="text-body-sm text-muted-foreground">
        {t("loading")}
      </p>
    );

  // ============================================================================
  // Page
  // ============================================================================

  return (
    <ViewLayout>
      <ViewHeader
        icon="chart-line"
        title={t("title")}
        description={t("description")}
        action={
          <Button
            variant="outline"
            size="md"
            onClick={() => router.push("/usage/records")}
          >
            <Icon name="search" size="xs" fallback="placeholder" />
            <span>{t("viewRecords")}</span>
          </Button>
        }
      />
      <div className="flex flex-col gap-sm">
        <SegmentedControl<ConsoleUsageWindow>
          ariaLabel={t("trend.windowLabel")}
          value={window}
          onChange={setWindow}
          items={[
            { value: "hour", label: t("trend.windowHour") },
            { value: "day", label: t("trend.windowDay") },
            { value: "week", label: t("trend.windowWeek") },
            { value: "month", label: t("trend.windowMonth") },
          ]}
        />
        <p className="text-body-sm text-muted-foreground">{t("globalScope")}</p>
        {current ? (
          <p className="text-body-sm text-muted-foreground">
            {t("range", {
              from: formatRange(current.from, current.bucketZone),
              to: formatRange(current.to, current.bucketZone),
              zone: formatTimezone(current.bucketZone, current.bucketZone),
            })}
          </p>
        ) : null}
        {current?.zoneFallback ? (
          <p role="status" className="text-body-sm text-muted-foreground">
            {t("zoneFallback")}
          </p>
        ) : null}
      </div>
      {failed ? (
        <LoadFailedBanner
          onRetry={() => setReloadKey((key) => key + 1)}
          retrying={loading}
        />
      ) : null}
      <MetricGrid
        items={metrics}
        columns={3}
        loading={!failed && !ready}
        aria-label={t("metrics.groupLabel")}
      />
      <PageSection
        icon="chart-line"
        level={2}
        title={t("trend.title")}
        description={t("trend.naturalDescription")}
      >
        {content(
          <div className="flex flex-col gap-md">
            <BarChart
              key={scope}
              aria-label={t("trend.title")}
              peakLabel={t("chartPeak")}
              formatValue={fmtCount}
              data={
                current?.buckets.map((bucket) => ({
                  key: bucket.period,
                  label: periodLabel(bucket.period),
                  value: bucket.total,
                })) ?? []
              }
            />
            <p className="text-body-sm">
              {t("trend.statTotal")}{" "}
              <span className="tabular-nums font-medium">
                {fmtCount(total)}
              </span>{" "}
              {t("metrics.creditsUnit")}
            </p>
          </div>,
        )}
      </PageSection>
      <PageSection
        icon="chart-pie"
        level={2}
        title={t("share.title")}
        description={t("share.description")}
      >
        {content(
          <div className="flex flex-col gap-md">
            {products.length > 0 ? (
              <BarChart
                key={scope}
                aria-label={t("share.title")}
                peakLabel={t("chartPeak")}
                formatValue={fmtCount}
                labelEvery={1}
                data={products.map((product) => ({
                  key: product.key,
                  label: product.name,
                  value: product.value,
                }))}
              />
            ) : (
              <p className="text-body-sm">{t("share.emptyZero")}</p>
            )}
            <ShareLegend items={products} />
          </div>,
        )}
      </PageSection>
      <PageSection
        icon="users"
        level={2}
        title={t("members.title")}
        description={t("members.description")}
      >
        {content(
          <div className="flex flex-col gap-md">
            <BarChart
              key={scope}
              aria-label={t("members.title")}
              peakLabel={t("chartPeak")}
              formatValue={fmtCount}
              labelEvery={1}
              data={members.map((member) => ({
                key: member.key,
                label: member.name,
                value: member.value,
              }))}
            />
            <ShareLegend items={members} />
          </div>,
        )}
      </PageSection>
      <PageSection
        icon="info"
        level={2}
        title={t("notes.title")}
        description={t("notes.description")}
      >
        <SectionBody>
          <p className="text-body-sm text-muted-foreground">
            {t("notes.naturalScope")}
          </p>
          <p className="text-body-sm text-muted-foreground">
            {t("notes.attributionBody")}
          </p>
        </SectionBody>
      </PageSection>
    </ViewLayout>
  );
}
