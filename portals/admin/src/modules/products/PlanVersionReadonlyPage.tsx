"use client";

/**
 * PlanVersionReadonlyPage.tsx —— 已发布版本的只读详情（设计稿第四屏）。
 *
 * @package  @vxture/admin
 * @layer    Presentation
 * @category module
 *
 * ── 为什么已发布版本要有自己的页面 ────────────────────────────────────────
 * 它是**客户按之掏钱的那份契约**，订阅正钉在它上面。运营要回答「这个客户当时买的
 * 到底是什么」，只能来这里看。
 *
 * 它与编辑器长得像，但**一个输入框都没有**——不是把控件禁用掉，是根本不渲染。
 * 「展示与编辑混在一起、靠禁用表达只读」正是旧版单页的病根。
 *
 * ── 路由用套餐码，不用档位 ────────────────────────────────────────────────
 * 设计稿原本写 `/plan-versions/karda/pro/v2`（产品 + 档位 + 版本），但库里**不禁止
 * 同档多套餐**——arda 的 `pro` 档实际挂着 `arda-pro` 与 `arda-beta-trial` 两条，
 * 「pro 档的 v2」指代不唯一。所以中间那段用 `plan_code`：它本身唯一，且仍然可读，
 * 符合「地址栏走可读码、不出现 UUID」。
 *
 * ── 配额表与编辑器右栏是同一份数据的两种形态 ──────────────────────────────
 * 那边是可调序的选择器（要交互），这边是表（只读）；但表头、列序、徽标口径完全
 * 一致。同一份东西在两屏长得不一样，人就会怀疑它们是不是两回事。
 *
 * ── 这一屏唯一的写操作是「开新草稿」 ──────────────────────────────────────
 * 它不改这一版，而是复制一份内容开新版本——已发布的改不了，要改就开新版本。入口
 * 放在这里，人就不会跑回列表页找「新建」，也不会误以为这一屏能编辑。
 *
 * @author AI-Generated
 * @date 2026-09-18
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  DataTable,
  DetailPageTemplate,
  EmptyState,
  PanelItem,
  PanelList,
  Section,
  StatusBadge,
} from "@vxture/design-system";
import type { DataTableColumn } from "@vxture/design-system";
import {
  createPlanDraftVersion,
  fetchMetricOptions,
  fetchPlanMatrix,
  fetchPlanVersion,
  fetchPlanVersions,
  type MetricOption,
  type PlanMatrixPlan,
  type PlanVersionComponent,
  type PlanVersionDetail,
} from "@/api/admin-bff";
import { PageHeader } from "@/modules/shared/PageHeader";
import { useTableLabels } from "@/modules/shared/table";
import { tierBadgeClass, tierLabel } from "@/modules/shared/tier-level";
import { formatDate, formatNumber } from "@/modules/tenants/tenant-utils";

/** 主组件 quota = 配额本体 + `_pricing`（计价参数，α 在此）。两者分开呈现。 */
function splitPricing(quota: Record<string, unknown>): {
  body: Record<string, unknown>;
  pricing: Record<string, unknown>;
} {
  const { _pricing, ...body } = quota;
  const pricing =
    _pricing && typeof _pricing === "object" && !Array.isArray(_pricing)
      ? (_pricing as Record<string, unknown>)
      : {};
  return { body, pricing };
}

interface QuotaRow {
  key: string;
  scope: "platform" | "product" | "unknown";
  amount: string;
  unit: string;
}

/**
 * 额度一律**原样显示**。`-1` 是 max 型的无限哨兵（product_220 §2），界面不把它
 * 翻译成「不限」——翻译过就对不上库里存的值了。其余数字加千分位，因为
 * `storage.bytes` 这种键动辄十一位，不分组根本读不出量级。
 */
function formatAmount(value: unknown): string {
  if (typeof value === "number") {
    return value === -1 ? "-1" : formatNumber(value);
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(value) ?? "—";
}

export function PlanVersionReadonlyPage({
  productCode,
  planCode,
  versionNo,
}: {
  productCode: string;
  planCode: string;
  versionNo: number;
}) {
  const t = useTranslations("planVersionsPage");
  const locale = useLocale();
  const router = useRouter();
  const tableLabels = useTableLabels();

  const [plan, setPlan] = useState<PlanMatrixPlan | null>(null);
  const [productName, setProductName] = useState(productCode);
  const [detail, setDetail] = useState<PlanVersionDetail | null>(null);
  const [metrics, setMetrics] = useState<MetricOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await fetchPlanMatrix(true);
      const product = all.find((item) => item.productCode === productCode);
      if (product) setProductName(product.productName);
      const found = product?.plans.find((p) => p.planCode === planCode) ?? null;
      setPlan(found);
      if (!found) return;
      const versions = await fetchPlanVersions(found.planId);
      const target = versions.find((v) => v.versionNo === versionNo);
      if (!target) return;
      setDetail(await fetchPlanVersion(target.id));
      // 配额项的归属（WS 共享 / 本产品）不在版本数据里，要靠候选清单反查。
      setMetrics(await fetchMetricOptions(productCode));
    } finally {
      setLoading(false);
    }
  }, [productCode, planCode, versionNo]);

  useEffect(() => {
    void load();
  }, [load]);

  const scopeOf = useCallback(
    (key: string): QuotaRow["scope"] =>
      metrics.find((m) => m.metricKey === key)?.scope ?? "unknown",
    [metrics],
  );
  const unitOf = useCallback(
    (key: string): string =>
      metrics.find((m) => m.metricKey === key)?.metricUnit ?? "—",
    [metrics],
  );

  const bundled = useMemo(
    () =>
      (detail?.components ?? []).filter((c) => c.componentRole === "bundled"),
    [detail],
  );

  const pricing = useMemo(() => splitPricing(detail?.quota ?? {}), [detail]);

  const quotaRows: QuotaRow[] = useMemo(
    () =>
      Object.entries(pricing.body).map(([key, value]) => ({
        key,
        scope: scopeOf(key),
        amount: formatAmount(value),
        unit: unitOf(key),
      })),
    [pricing.body, scopeOf, unitOf],
  );

  const quotaColumns: DataTableColumn<QuotaRow>[] = [
    {
      id: "key",
      header: t("readonly.colKey"),
      cell: (row) => <span className="font-mono">{row.key}</span>,
    },
    {
      id: "owner",
      header: t("readonly.colOwner"),
      align: "center",
      cell: (row) =>
        row.scope === "unknown" ? (
          <span className="text-body-sm text-muted-foreground">—</span>
        ) : (
          <StatusBadge tone={row.scope === "platform" ? "brand" : "neutral"}>
            {row.scope === "platform"
              ? t("editorV2.groupPlatform")
              : t("editorV2.groupProduct")}
          </StatusBadge>
        ),
    },
    {
      id: "amount",
      header: t("readonly.colAmount"),
      align: "center",
      cell: (row) => <span className="font-mono">{row.amount}</span>,
    },
    {
      id: "unit",
      header: t("readonly.colUnit"),
      align: "center",
      cell: (row) => <span className="font-mono">{row.unit}</span>,
    },
  ];

  const openNextDraft = useCallback(async () => {
    if (!plan) return;
    setBusy(true);
    setMessage(null);
    try {
      const draft = await createPlanDraftVersion(plan.planId);
      router.push(
        `/plan-versions/${encodeURIComponent(productCode)}/${encodeURIComponent(planCode)}/${draft.versionNo}/edit`,
      );
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : t("readonly.draftOpenFailed"),
      );
      setBusy(false);
    }
  }, [plan, router, productCode, planCode, t]);

  const header = (
    <PageHeader
      icon="file-text"
      title={
        plan
          ? t("readonly.title", { plan: plan.planName, n: versionNo })
          : planCode
      }
      description={t("readonly.locked")}
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            router.push(`/plan-versions/${encodeURIComponent(productCode)}`)
          }
        >
          {t("readonly.back", { name: productName })}
        </Button>
      }
    />
  );

  if (!loading && (!plan || !detail)) {
    return (
      <DetailPageTemplate className="min-w-0" header={header}>
        <EmptyState title={t("readonly.empty")} />
      </DetailPageTemplate>
    );
  }

  return (
    <DetailPageTemplate className="min-w-0" header={header}>
      {message ? (
        <p className="text-body-sm" role="status">
          {message}
        </p>
      ) : null}

      {/* ── 冻结条：这一版的处境一眼可见 ───────────────────────────────── */}
      {detail && plan ? (
        <Section
          aria-label={t("list.status")}
          level={2}
          icon="lock"
          title={t("list.status")}
        >
          <PanelList>
            <PanelItem
              main={t("list.status")}
              trail={
                <span className="inline-flex flex-wrap items-center justify-end gap-2xs">
                  <Badge
                    variant="outline"
                    className={tierBadgeClass(plan.tier)}
                  >
                    {tierLabel(plan.tier)}
                  </Badge>
                  <StatusBadge tone={detail.isCurrent ? "success" : "neutral"}>
                    {detail.isCurrent
                      ? t("lifecycle.current")
                      : detail.subscriptionCount > 0
                        ? t("lifecycle.serving")
                        : t("lifecycle.retiredVersion")}
                  </StatusBadge>
                  <span className="text-body-sm text-muted-foreground">
                    {t("readonly.frozen", {
                      date: formatDate(detail.createdAt, locale),
                    })}
                  </span>
                </span>
              }
            />
            <PanelItem
              main={t("list.subscriptions")}
              trail={
                detail.subscriptionCount > 0
                  ? t("lifecycle.subscribed", {
                      n: formatNumber(detail.subscriptionCount),
                    })
                  : t("lifecycle.neverSold")
              }
            />
          </PanelList>
        </Section>
      ) : null}

      {/* ── 价格与计价：α 与价格并排，标「计价」 ───────────────────────── */}
      {detail ? (
        <Section
          aria-label={t("editorV2.priceHeading")}
          level={2}
          icon="coins"
          title={t("editorV2.priceHeading")}
          description={t("editorV2.alphaHint")}
        >
          <PanelList>
            <PanelItem
              main={t("editorV2.priceMonth")}
              trail={
                <span className="font-mono">
                  {detail.prices.find((p) => p.cycleUnit === "month")?.price ??
                    t("price.none")}
                </span>
              }
            />
            <PanelItem
              main={t("editorV2.priceYear")}
              trail={
                <span className="font-mono">
                  {detail.prices.find((p) => p.cycleUnit === "year")?.price ??
                    t("price.none")}
                </span>
              }
            />
            <PanelItem
              main={
                <span className="inline-flex items-center gap-2xs">
                  {t("editorV2.alpha")}
                  <StatusBadge tone="warning">
                    {t("editorV2.alphaTag")}
                  </StatusBadge>
                </span>
              }
              trail={
                <span className="font-mono">
                  {typeof pricing.pricing.consumable_share === "number"
                    ? String(pricing.pricing.consumable_share)
                    : "—"}
                </span>
              }
            />
          </PanelList>
        </Section>
      ) : null}

      {/* ── 配额：与编辑器右栏同一份数据，这边是只读表 ─────────────────── */}
      <Section
        aria-label={t("editorV2.quotaHeading")}
        level={2}
        icon="list-checks"
        title={t("readonly.quotaHeading", {
          n: formatNumber(quotaRows.length),
        })}
      >
        <DataTable
          labels={tableLabels}
          columns={quotaColumns}
          rows={quotaRows}
          rowKey={(row) => row.key}
          loading={loading}
          empty={<EmptyState title={t("editorV2.chosen")} />}
        />
      </Section>

      {/* ── 绑定产品：priority 是消耗次序，显式写出来 ──────────────────── */}
      {bundled.length > 0 ? (
        <Section
          aria-label={t("editorV2.bundleHeading")}
          level={2}
          icon="plugs-connected"
          title={t("readonly.bundleHeading", {
            n: formatNumber(bundled.length),
          })}
          description={t("editorV2.priorityHint")}
        >
          <PanelList>
            {bundled.map((component: PlanVersionComponent) => (
              <PanelItem
                key={component.productCode}
                main={
                  <span className="inline-flex flex-wrap items-center gap-2xs">
                    <span>{component.productName}</span>
                    <span className="font-mono text-body-sm text-muted-foreground">
                      {component.productCode}
                    </span>
                  </span>
                }
                trail={
                  <span className="inline-flex flex-wrap items-center justify-end gap-2xs">
                    <StatusBadge tone="brand">
                      {t("editorV2.priority", { n: component.priority })}
                    </StatusBadge>
                    <span className="font-mono text-body-sm text-muted-foreground">
                      {Object.keys(component.quota).length}
                    </span>
                  </span>
                }
              />
            ))}
          </PanelList>
        </Section>
      ) : null}

      {/* ── 唯一的写操作：开新草稿 ─────────────────────────────────────── */}
      <Section
        aria-label={t("readonly.openNextDraft")}
        level={2}
        icon="git-branch"
        title={t("readonly.openNextDraft")}
        description={t("readonly.openNextDraftHint")}
      >
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || !plan}
          onClick={() => void openNextDraft()}
        >
          {t("readonly.openNextDraft")}
        </Button>
      </Section>
    </DetailPageTemplate>
  );
}
