"use client";

/**
 * VouchersPage.tsx — 我的卡券(owner 2026-08-21 P0)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 租户视角的卡券台账:折扣券/抵扣金券在订单支付页参与结算,本页负责
 * 「我有什么、什么时候到期、用掉的去了哪」。{可用|全部} 筛选;过期为读侧
 * 派生口径(与支付页可用清单一致)。DS 组合件;中文+i18n(vouchersPage);
 * 表格遵守默认结构(序号列;无行操作,不出操作列)。
 */

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Badge,
  DataTable,
  EmptyState,
  MetricGrid,
  SegmentedControl,
  StatusBadge,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import type {
  DataTableColumn,
  MetricGridItem,
  StatusBadgeTone,
} from "@vxture/design-system";
import { formatCurrency, type Locale } from "@vxture-platform/shared";
import { fetchVouchers, type ConsoleVoucher } from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import {
  LoadFailedBanner,
  LoadFailedEmpty,
} from "@/components/load/LoadFailed";
import { PageSection, SignalList } from "@/layout/shell";
import { fmtDate, fmtTime } from "./components/hubModel";

const STATUS_TONES: Record<ConsoleVoucher["status"], StatusBadgeTone> = {
  available: "success",
  reserved: "info",
  redeemed: "neutral",
  expired: "neutral",
  revoked: "warning",
};

const KNOWN_KINDS = new Set([
  "discount",
  "credit_voucher",
  "recharge_card",
  "redemption",
  "extension",
]);

type VoucherFilter = "available" | "all";

export function VouchersPage() {
  const t = useTranslations("vouchersPage");
  const locale = useLocale();
  const { session } = useConsoleSession();

  const [vouchers, setVouchers] = useState<ConsoleVoucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<VoucherFilter>("available");
  /* 读失败显影(批 0b):strict 读,失败置 loadFailed——指标画「—」、表格画「读取
   * 失败」,不再把回落的 [] 画成「没有卡券」。 */
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    fetchVouchers()
      .then((rows) => {
        if (active) setVouchers(rows);
      })
      .catch(() => {
        if (!active) return;
        setVouchers([]);
        setLoadFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session.tenant?.id, reloadKey]);

  const kindLabel = (kind: string): string =>
    KNOWN_KINDS.has(kind) ? t(`kind.${kind}`) : kind;

  /** 面值表达:折扣 = 9折/立减 ¥X(上限 ¥Y);金额券 = ¥X。 */
  const faceValue = (v: ConsoleVoucher): string => {
    if (v.kind === "discount") {
      if (v.discountType === "percent" && v.discountValue !== undefined) {
        const cap = v.maxOff
          ? t("face.maxOff", {
              amount: formatCurrency(
                Number.parseFloat(v.maxOff),
                locale as Locale,
                "CNY",
              ),
            })
          : "";
        return `${t("face.percentOff", { percent: v.discountValue })}${cap}`;
      }
      if (v.discountType === "fixed" && v.discountValue !== undefined) {
        return t("face.fixedOff", {
          amount: formatCurrency(v.discountValue, locale as Locale, "CNY"),
        });
      }
    }
    if (v.amount) {
      return formatCurrency(
        Number.parseFloat(v.amount),
        locale as Locale,
        "CNY",
      );
    }
    return "—";
  };

  const visible = useMemo(
    () =>
      filter === "all"
        ? vouchers
        : vouchers.filter((v) => v.status === "available"),
    [vouchers, filter],
  );

  const metrics = useMemo<MetricGridItem[]>(() => {
    const available = vouchers.filter((v) => v.status === "available");
    const soon = available.filter(
      (v) => new Date(v.expiresAt).getTime() - Date.now() < 7 * 86_400_000,
    ).length;
    const used = vouchers.filter((v) => v.status === "redeemed").length;
    // 没读到就是「—」:读失败时的 0 不是没有券,是没有数据。
    const count = (n: number) => (loadFailed ? "—" : String(n));
    return [
      {
        id: "available",
        icon: "ticket",
        label: t("metrics.available"),
        value: count(available.length),
        trend: loadFailed
          ? ""
          : soon > 0
            ? t("metrics.expiringSoon", { count: soon })
            : t("metrics.noExpiring"),
        ...(soon > 0 ? { trendTone: "warning" as const } : {}),
      },
      {
        id: "used",
        icon: "seal-check",
        label: t("metrics.used"),
        value: count(used),
        trend: loadFailed ? "" : t("metrics.usedHint"),
      },
      {
        id: "total",
        icon: "stack",
        label: t("metrics.total"),
        value: count(vouchers.length),
        trend: loadFailed ? "" : t("metrics.totalHint"),
      },
    ];
  }, [vouchers, t, loadFailed]);

  const columns: DataTableColumn<ConsoleVoucher>[] = [
    {
      id: "code",
      header: t("table.colCode"),
      cell: (v) => (
        <span className="flex flex-col">
          <span className="font-mono text-label-md text-foreground">
            {v.code}
          </span>
          <span className="text-body-sm text-muted-foreground">
            {v.batchName}
          </span>
        </span>
      ),
    },
    {
      id: "kind",
      header: t("table.colKind"),
      align: "center",
      cell: (v) => <Badge variant="outline">{kindLabel(v.kind)}</Badge>,
    },
    {
      id: "face",
      header: t("table.colFace"),
      align: "right",
      cell: (v) => (
        <span className="tabular-nums font-medium text-foreground">
          {faceValue(v)}
        </span>
      ),
    },
    {
      id: "status",
      header: t("table.colStatus"),
      align: "center",
      cell: (v) => (
        <StatusBadge tone={STATUS_TONES[v.status]}>
          {t(`status.${v.status}`)}
        </StatusBadge>
      ),
    },
    {
      id: "expires",
      header: t("table.colExpires"),
      align: "right",
      cell: (v) => <span className="tabular-nums">{fmtDate(v.expiresAt)}</span>,
    },
    {
      id: "usedAt",
      header: t("table.colUsedAt"),
      cell: (v) =>
        v.redeemedAt ? (
          <span className="flex flex-col tabular-nums">
            <span className="text-foreground">
              {fmtDate(v.redeemedAt)} {fmtTime(v.redeemedAt)}
            </span>
            {v.redemptionNo ? (
              <span className="font-mono text-body-sm text-muted-foreground">
                {v.redemptionNo}
              </span>
            ) : null}
          </span>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <ViewLayout>
      <ViewHeader
        icon="ticket"
        title={t("title")}
        description={t("description")}
      />

      {loadFailed ? (
        <LoadFailedBanner
          onRetry={() => setReloadKey((k) => k + 1)}
          retrying={loading}
        />
      ) : null}

      <MetricGrid
        items={metrics}
        columns={3}
        loading={loading}
        aria-label={t("metrics.groupLabel")}
      />

      <PageSection
        icon="ticket"
        level={2}
        title={t("table.title")}
        description={t("table.description")}
        action={
          <SegmentedControl<VoucherFilter>
            ariaLabel={t("table.filterLabel")}
            value={filter}
            onChange={setFilter}
            items={[
              { value: "available", label: t("table.filterAvailable") },
              { value: "all", label: t("table.filterAll") },
            ]}
          />
        }
      >
        <DataTable<ConsoleVoucher>
          columns={columns}
          rows={visible}
          rowKey={(v) => v.id}
          loading={loading}
          indexStart={1}
          empty={
            loadFailed ? (
              <LoadFailedEmpty />
            ) : (
              <EmptyState title={t("table.empty")} />
            )
          }
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
            { title: t("notes.useTitle"), description: t("notes.useBody") },
            {
              title: t("notes.sourceTitle"),
              description: t("notes.sourceBody"),
            },
          ]}
        />
      </PageSection>
    </ViewLayout>
  );
}
