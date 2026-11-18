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
import { formatDateTime, formatClock } from "@vxture-platform/shared";
import {
  BarChart,
  Button,
  Icon,
  MetricGrid,
  SegmentedControl,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
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
  const productTotal =
    current?.products.reduce((sum, product) => sum + product.total, 0) ?? 0;
  const products = useMemo(
    () =>
      current?.products.map((product) => ({
        key: product.productCode,
        name: product.productName,
        value: product.total,
        percent:
          productTotal > 0
            ? Math.round((product.total / productTotal) * 100)
            : 0,
      })) ?? [],
    [current, productTotal],
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
    formatDateTime(value, locale, "—", { timeZone: zone });
  // Hours use UTC keys to distinguish repeated DST hours; other keys are civil dates.
  const periodLabel = (period: string): string => {
    if (window === "hour") {
      return formatClock(`${period.replace(" ", "T")}:00Z`, locale, "—", {
        time: "long",
        timeZone: current?.bucketZone ?? "UTC",
      });
    }
    if (window === "month") return `${period.slice(0, 7)}-01`;
    return period.slice(5, 10);
  };
  const content = (chart: React.ReactNode) =>
    failed ? (
      <LoadFailedEmpty />
    ) : current ? (
      chart
    ) : (
      <p role="status" className="text-body-small text-muted-foreground">
        {t("loading")}
      </p>
    );

  // ============================================================================
  // Page
  // ============================================================================

  return (
    <ViewLayout>
      <ViewHeader
        className="[&>div:last-child]:max-w-full"
        icon="chart-line"
        title={t("title")}
        description={t("description")}
        action={
          <div className="flex flex-wrap items-center justify-end gap-sm">
            <SegmentedControl<ConsoleUsageWindow>
              ariaLabel={t("trend.windowLabel")}
              value={window}
              onChange={setWindow}
              size="sm"
              fill={false}
              items={[
                { value: "hour", label: t("trend.windowHour") },
                { value: "day", label: t("trend.windowDay") },
                { value: "week", label: t("trend.windowWeek") },
                { value: "month", label: t("trend.windowMonth") },
              ]}
            />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("scopeDetails")}
                  >
                    <Icon name="info" size="sm" fallback="placeholder" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" variant="surface">
                  <div className="flex flex-col gap-sm text-body-small">
                    <p>{t("globalScope")}</p>
                    {current ? (
                      <p>
                        {t("range", {
                          from: formatRange(current.from, current.bucketZone),
                          to: formatRange(current.to, current.bucketZone),
                          zone: formatTimezone(
                            current.bucketZone,
                            current.bucketZone,
                          ),
                        })}
                      </p>
                    ) : null}
                    {current?.zoneFallback ? <p>{t("zoneFallback")}</p> : null}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/usage/records")}
            >
              <Icon name="search" size="xs" fallback="placeholder" />
              <span>{t("viewRecords")}</span>
            </Button>
          </div>
        }
      />
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
        tone="glass"
        title={t("trend.title")}
        description={t("trend.naturalDescription")}
      >
        {content(
          <div className="flex flex-col gap-md">
            <BarChart
              key={scope}
              aria-label={t("trend.title")}
              plotHeight="tall"
              peakLabel={t("chartPeak")}
              formatValue={fmtCount}
              data={
                current?.buckets.map((bucket) => ({
                  key: bucket.period,
                  label: periodLabel(bucket.period),
                  value: bucket.total,
                  description: `${t("metrics.creditsUnit")} · ${total > 0 ? Math.round((bucket.total / total) * 100) : 0}% ${t("breakdown.share")}`,
                })) ?? []
              }
            />
            <p className="text-body-small">
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
        tone="glass"
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
                data={products.map((product) => ({
                  key: product.key,
                  label: product.name,
                  value: product.value,
                  description: `${t("metrics.creditsUnit")} · ${product.percent}% ${t("breakdown.share")}`,
                }))}
              />
            ) : (
              <p className="text-body-small">{t("share.emptyZero")}</p>
            )}
          </div>,
        )}
      </PageSection>
      <PageSection
        icon="users"
        level={2}
        tone="glass"
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
              data={members.map((member) => ({
                key: member.key,
                label: member.name,
                value: member.value,
                description: `${t("metrics.creditsUnit")} · ${member.percent}% ${t("breakdown.share")}`,
              }))}
            />
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
          <p className="text-body-small text-muted-foreground">
            {t("notes.naturalScope")}
          </p>
          <p className="text-body-small text-muted-foreground">
            {t("notes.attributionBody")}
          </p>
        </SectionBody>
      </PageSection>
    </ViewLayout>
  );
}
