"use client";

/**
 * PlanDraftEditorPage.tsx —— 草稿版本编辑器（设计稿第三屏）。
 *
 * @package  @vxture/admin
 * @layer    Presentation
 * @category module
 *
 * ── 只有草稿进得来 ────────────────────────────────────────────────────────
 * 已发布版本 `is_locked=true`，本就不可改。旧版把它和草稿画在同一个表单里，只能
 * 靠禁用控件来表达——那正是「展示与编辑混在一起」的病根。这一屏对非草稿直接给
 * 一句说明 + 去只读屏的入口，不渲染任何输入控件。
 *
 * ── 三条承接自旧编辑器、不能丢的语义 ──────────────────────────────────────
 * 1. **发布 = 先存表单、再冻结**。只发服务端草稿会静默丢掉未保存的价格/配额/绑定
 *    改动（owner 2026-09-02 报过），发布出去的版本带着旧值且不报错。
 * 2. **α 合回 `_pricing`**：配额本体与 α 分开编辑，保存时合回，且**其余 `_pricing`
 *    键原样保留**。穿梭器替换文本域之后这条更要守住——运营再也看不见那个对象了。
 * 3. **bundled 是整组 PUT**：右栏是一次提交的整体，移除一项也是重发整组；且它自带
 *    step-up 门，所以只在**脏**时才发。
 *
 * ── 配额两组分开标，是库强制的边界 ────────────────────────────────────────
 * `trg_product_metrics_no_platform_shadow` 不许产品在自己的 `product_metrics` 里
 * 声明平台已有的键（直接 RAISE）。所以「WS 共享 / 本产品」不是界面分类习惯，是一条
 * 触发器画的线。服务端已按 `scope ASC, metric_key ASC` 排序，前端不再排。
 *
 * ── 额度原样存，本批不做单位换算 ──────────────────────────────────────────
 * 输入框收库里的原值，旁边显示单位与千分位预览（`53687091200` → `53,687,091,200`），
 * 让人当场看出量级。`-1` 是 max 型的无限哨兵，**原样显示、原样存**，不翻译成「不限」
 * ——翻译过就对不上库里的值了。输 50 GB 自动换算是下一批的事（owner 2026-09-18 定）。
 *
 * ── 绑定候选按层过滤 ──────────────────────────────────────────────────────
 * 只有 `layer === "L2"` 可绑：L1 是底座能力（额度走平台级度量键，不经套餐分配），
 * L3 卖的就是那套界面（抽掉前端什么都不剩）。L1/L3/未分层仍然列出来但置灰并写明
 * 理由——藏起来会让人以为产品不存在，转头去别处找。写侧也拦（批 A 已收口），界面
 * 这一层是体验不是保证。
 *
 * ── 顺序是消耗次序，不是排版 ──────────────────────────────────────────────
 * 右栏顺序写回 `plan_components.priority`，库里有触发器盯着：所有绑定件的 priority
 * 必须小于主组件（主组件 100，绑定件默认 50）——先烧绑进来的额度，再烧主产品自己的
 * 池。所以 priority 数值**显式写出来**，用上移/下移调整（DS 无拖拽件，全平台也无
 * 先例，owner 2026-09-18 定用按钮）。
 *
 * @author AI-Generated
 * @date 2026-09-18
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  ActionButton,
  Badge,
  Button,
  DestructiveButton,
  DetailPageTemplate,
  EmptyState,
  Input,
  PanelItem,
  PanelList,
  Section,
  StatusBadge,
} from "@vxture/design-system";
import {
  deletePlanVersion,
  fetchMetricOptions,
  fetchPlanMatrix,
  fetchPlanVersion,
  fetchPlanVersions,
  fetchProductCapabilities,
  publishPlanVersion,
  replacePlanVersionBundledComponents,
  updateDraftPlanVersion,
  type MetricOption,
  type PlanMatrixPlan,
  type PlanVersionBundledComponentInput,
  type PlanVersionDetail,
} from "@/api/admin-bff";
import type { ProductCapabilityRecord } from "@/entities/console";
import { PageHeader } from "@/modules/shared/PageHeader";
import { useConfirmLabels } from "@/modules/shared/destructive";
import { tierBadgeClass, tierLabel } from "@/modules/shared/tier-level";
import { formatNumber } from "@/modules/tenants/tenant-utils";
import { isStepUpCancelled, useStepUp } from "@/providers/StepUpProvider";

/** 主组件 quota = 配额本体 + `_pricing`（计价参数，α 在此）。 */
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

/** 右栏一行：键 + 额度文本（原值，不换算）。 */
interface QuotaEntry {
  key: string;
  amount: string;
}

/** 绑定右栏一行：产品 + 配额 + priority（顺序即消耗次序）。 */
interface BundleEntry {
  productCode: string;
  productName: string;
  quota: Record<string, unknown>;
  features: string[];
}

const LAYER_ORDER = ["L2", "L1", "L3", "none"] as const;
type LayerKey = (typeof LAYER_ORDER)[number];

function layerKeyOf(record: ProductCapabilityRecord): LayerKey {
  if (record.layer === "L2") return "L2";
  if (record.layer === "L1") return "L1";
  if (record.layer === "L3") return "L3";
  return "none";
}

export function PlanDraftEditorPage({
  productCode,
  planCode,
  versionNo,
}: {
  productCode: string;
  planCode: string;
  versionNo: number;
}) {
  const t = useTranslations("planVersionsPage");
  const router = useRouter();
  const withLabels = useConfirmLabels();
  const { runWithStepUp } = useStepUp();

  const [plan, setPlan] = useState<PlanMatrixPlan | null>(null);
  const [detail, setDetail] = useState<PlanVersionDetail | null>(null);
  const [metrics, setMetrics] = useState<MetricOption[]>([]);
  const [catalog, setCatalog] = useState<ProductCapabilityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const [priceMonth, setPriceMonth] = useState("");
  const [priceYear, setPriceYear] = useState("");
  const [alpha, setAlpha] = useState("");
  const [entries, setEntries] = useState<QuotaEntry[]>([]);
  const [bundle, setBundle] = useState<BundleEntry[]>([]);

  const versionPath = `/plan-versions/${encodeURIComponent(productCode)}/${encodeURIComponent(planCode)}/${versionNo}`;

  /** 把服务端返回的版本灌进表单。保存/发布后也走这条，保证两者同源。 */
  const hydrate = useCallback((d: PlanVersionDetail) => {
    setDetail(d);
    setPriceMonth(d.prices.find((p) => p.cycleUnit === "month")?.price ?? "");
    setPriceYear(d.prices.find((p) => p.cycleUnit === "year")?.price ?? "");
    const { body, pricing } = splitPricing(d.quota);
    setAlpha(
      typeof pricing.consumable_share === "number"
        ? String(pricing.consumable_share)
        : "",
    );
    setEntries(
      Object.entries(body).map(([key, value]) => ({
        key,
        amount: typeof value === "number" ? String(value) : String(value ?? ""),
      })),
    );
    setBundle(
      d.components
        .filter((c) => c.componentRole === "bundled")
        .map((c) => ({
          productCode: c.productCode,
          productName: c.productName,
          quota: c.quota,
          features: c.features,
        })),
    );
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await fetchPlanMatrix(true);
      const product = all.find((item) => item.productCode === productCode);
      const found = product?.plans.find((p) => p.planCode === planCode) ?? null;
      setPlan(found);
      if (!found) return;
      const versions = await fetchPlanVersions(found.planId);
      const target = versions.find((v) => v.versionNo === versionNo);
      if (!target) return;
      const d = await fetchPlanVersion(target.id);
      if (d) hydrate(d);
      setMetrics(await fetchMetricOptions(productCode));
      setCatalog(await fetchProductCapabilities());
    } finally {
      setLoading(false);
    }
  }, [productCode, planCode, versionNo, hydrate]);

  useEffect(() => {
    void load();
  }, [load]);

  const editable = detail?.status === "draft" && !detail.isLocked;

  const chosenKeys = useMemo(
    () => new Set(entries.map((e) => e.key)),
    [entries],
  );
  const candidates = useMemo(
    () => metrics.filter((m) => !chosenKeys.has(m.metricKey)),
    [metrics, chosenKeys],
  );
  const metricOf = useCallback(
    (key: string) => metrics.find((m) => m.metricKey === key) ?? null,
    [metrics],
  );

  const bundleChosen = useMemo(
    () => new Set(bundle.map((b) => b.productCode)),
    [bundle],
  );
  const bundleCandidates = useMemo(
    () =>
      catalog.filter(
        (item) =>
          item.productCode !== productCode &&
          !bundleChosen.has(item.productCode),
      ),
    [catalog, productCode, bundleChosen],
  );

  /** 落库预览：与保存时组装的 quota 完全同源，否则预览就失去核对价值。 */
  const composedQuota = useMemo((): Record<string, unknown> => {
    const body: Record<string, unknown> = {};
    for (const entry of entries) {
      const n = Number(entry.amount);
      body[entry.key] =
        entry.amount.trim() === "" || !Number.isFinite(n) ? entry.amount : n;
    }
    const rest = Object.fromEntries(
      Object.entries(splitPricing(detail?.quota ?? {}).pricing).filter(
        ([k]) => k !== "consumable_share",
      ),
    );
    const pricing =
      alpha.trim() === "" ? rest : { ...rest, consumable_share: Number(alpha) };
    return Object.keys(pricing).length > 0
      ? { ...body, _pricing: pricing }
      : body;
  }, [entries, alpha, detail]);

  const bundleIsDirty = useCallback((): boolean => {
    if (!detail) return false;
    const now = bundle.map((b) => b.productCode).join("|");
    const was = detail.components
      .filter((c) => c.componentRole === "bundled")
      .map((c) => c.productCode)
      .join("|");
    return now !== was;
  }, [bundle, detail]);

  const bundlePayload = useCallback(
    (): PlanVersionBundledComponentInput[] =>
      bundle.map((b, index) => ({
        productCode: b.productCode,
        quota: b.quota,
        features: b.features,
        // 顺序即消耗次序：越靠前越先烧。主组件是 100，绑定件必须小于它。
        priority: 50 - index,
      })),
    [bundle],
  );

  const validate = useCallback((): string | null => {
    if (alpha.trim() !== "") {
      const n = Number(alpha);
      if (!Number.isFinite(n) || n < 0 || n > 1)
        return t("editorV2.alphaInvalid");
    }
    for (const entry of entries) {
      if (entry.amount.trim() === "" || !Number.isFinite(Number(entry.amount)))
        return t("editorV2.amountInvalid", { key: entry.key });
    }
    return null;
  }, [alpha, entries, t]);

  const draftBody = useCallback(() => {
    const prices: { cycleUnit: string; price: number }[] = [];
    if (priceMonth !== "")
      prices.push({ cycleUnit: "month", price: Number(priceMonth) });
    if (priceYear !== "")
      prices.push({ cycleUnit: "year", price: Number(priceYear) });
    return { prices, quota: composedQuota };
  }, [priceMonth, priceYear, composedQuota]);

  const save = useCallback(async () => {
    if (!detail) return;
    const bad = validate();
    if (bad) {
      setMessage(bad);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      hydrate(await updateDraftPlanVersion(detail.id, draftBody()));
      setMessage(t("editorV2.saved"));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t("editorV2.saveFailed"));
    } finally {
      setBusy(false);
    }
  }, [detail, validate, draftBody, hydrate, t]);

  /**
   * 发布 = 先存表单、再冻结。顺序不能反：只发服务端草稿会把未保存的改动静默丢掉，
   * 而发布出去的版本带着旧值、不报错。绑定件仅在脏时才发（整组 PUT + 自带 step-up）。
   */
  const publish = useCallback(async () => {
    if (!detail) return;
    const bad = validate();
    if (bad) {
      setMessage(bad);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await updateDraftPlanVersion(detail.id, draftBody());
      if (bundleIsDirty()) {
        await runWithStepUp(() =>
          replacePlanVersionBundledComponents(detail.id, bundlePayload()),
        );
      }
      await runWithStepUp(() => publishPlanVersion(detail.id));
      setMessage(t("editorV2.published"));
      router.push(versionPath);
    } catch (err) {
      if (isStepUpCancelled(err)) return;
      setMessage(
        err instanceof Error ? err.message : t("editorV2.publishFailed"),
      );
    } finally {
      setBusy(false);
    }
  }, [
    detail,
    validate,
    draftBody,
    bundleIsDirty,
    bundlePayload,
    runWithStepUp,
    router,
    versionPath,
    t,
  ]);

  const header = (
    <PageHeader
      icon="edit"
      title={t("editorV2.title", { n: versionNo })}
      description={
        plan
          ? t("editorV2.subtitle", {
              tier: tierLabel(plan.tier),
              plan: plan.planName,
            })
          : planCode
      }
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            router.push(`/plan-versions/${encodeURIComponent(productCode)}`)
          }
        >
          {t("detail.backToList")}
        </Button>
      }
    />
  );

  if (!loading && !detail) {
    return (
      <DetailPageTemplate className="min-w-0" header={header}>
        <EmptyState title={t("readonly.empty")} />
      </DetailPageTemplate>
    );
  }

  if (!loading && !editable) {
    return (
      <DetailPageTemplate className="min-w-0" header={header}>
        <EmptyState
          title={t("editorV2.notDraft")}
          action={
            <ActionButton
              variant="outline"
              icon="file-text"
              onClick={() => router.push(versionPath)}
            >
              {t("detail.view")}
            </ActionButton>
          }
        />
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

      {/* ── 版本条：删除草稿在这里，不在底部按钮排 ─────────────────────── */}
      <Section
        aria-label={t("lifecycle.draft")}
        level={2}
        icon="clock"
        title={t("lifecycle.draft")}
        description={t("lifecycle.draftHelp")}
        action={
          detail ? (
            <DestructiveButton
              size="sm"
              icon="trash"
              disabled={busy}
              confirm={withLabels({
                verb: t("actions.deleteDraftVerb"),
                target: t("actions.deleteDraftTarget", { n: versionNo }),
                consequence: t("actions.deleteDraftConsequence"),
                onConfirm: async () => {
                  try {
                    await runWithStepUp(() => deletePlanVersion(detail.id));
                    router.push(
                      `/plan-versions/${encodeURIComponent(productCode)}`,
                    );
                  } catch (err) {
                    if (isStepUpCancelled(err)) return;
                    setMessage(
                      err instanceof Error ? err.message : t("actions.failed"),
                    );
                  }
                },
              })}
            >
              {t("actions.deleteDraft")}
            </DestructiveButton>
          ) : null
        }
      >
        <PanelList>
          <PanelItem
            main={t("list.status")}
            trail={
              <span className="inline-flex flex-wrap items-center justify-end gap-2xs">
                {plan ? (
                  <Badge
                    variant="outline"
                    className={tierBadgeClass(plan.tier)}
                  >
                    {tierLabel(plan.tier)}
                  </Badge>
                ) : null}
                <StatusBadge tone="warning">{t("lifecycle.draft")}</StatusBadge>
                <StatusBadge tone="neutral">
                  {t("editorV2.neverSold")}
                </StatusBadge>
              </span>
            }
          />
        </PanelList>
      </Section>

      {/* ── 价格与计价：α 与价格并排，标「计价」 ───────────────────────── */}
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
              <Input
                type="number"
                min="0"
                step="0.01"
                value={priceMonth}
                disabled={busy}
                onChange={(e) => setPriceMonth(e.target.value)}
                aria-label={t("editorV2.priceMonth")}
                className="w-panel-2xs text-right font-mono"
              />
            }
          />
          <PanelItem
            main={t("editorV2.priceYear")}
            trail={
              <Input
                type="number"
                min="0"
                step="0.01"
                value={priceYear}
                disabled={busy}
                onChange={(e) => setPriceYear(e.target.value)}
                aria-label={t("editorV2.priceYear")}
                className="w-panel-2xs text-right font-mono"
              />
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
              <Input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={alpha}
                disabled={busy}
                onChange={(e) => setAlpha(e.target.value)}
                aria-label={t("editorV2.alpha")}
                className="w-panel-2xs text-right font-mono"
              />
            }
          />
        </PanelList>
      </Section>

      {/* ── 配额：左候选（两组，库强制的边界）→ 右已选 ─────────────────── */}
      <Section
        aria-label={t("editorV2.quotaHeading")}
        level={2}
        icon="list-checks"
        title={t("editorV2.quotaHeading")}
        description={t("editorV2.quotaHint")}
      >
        <div className="grid min-w-0 gap-md lg:grid-cols-2">
          <div className="grid min-w-0 gap-2xs">
            <h4 className="text-body-sm text-muted-foreground">
              {t("editorV2.candidates")}
            </h4>
            {(["platform", "product"] as const).map((scope) => {
              const group = candidates.filter((m) => m.scope === scope);
              if (group.length === 0) return null;
              return (
                <PanelList key={scope}>
                  <PanelItem
                    main={
                      <span className="inline-flex flex-wrap items-center gap-2xs">
                        <StatusBadge
                          tone={scope === "platform" ? "brand" : "neutral"}
                        >
                          {scope === "platform"
                            ? t("editorV2.groupPlatform")
                            : t("editorV2.groupProduct")}
                        </StatusBadge>
                        <span className="text-body-sm text-muted-foreground">
                          {scope === "platform"
                            ? t("editorV2.groupPlatformHint")
                            : t("editorV2.groupProductHint")}
                        </span>
                      </span>
                    }
                  />
                  {group.map((m) => (
                    <PanelItem
                      key={m.metricKey}
                      main={
                        <span className="inline-flex flex-wrap items-center gap-2xs">
                          <span className="font-mono">{m.metricKey}</span>
                          {m.kind ? <Badge>{m.kind}</Badge> : null}
                          {m.mergeStrategy ? (
                            <Badge>{m.mergeStrategy}</Badge>
                          ) : null}
                          {m.resetPeriod && m.resetPeriod !== "none" ? (
                            <Badge>{m.resetPeriod}</Badge>
                          ) : null}
                          {m.reserved ? (
                            <StatusBadge tone="warning">
                              {t("editorV2.reserved")}
                            </StatusBadge>
                          ) : null}
                        </span>
                      }
                      trail={
                        <ActionButton
                          variant="outline"
                          icon="plus"
                          disabled={busy}
                          onClick={() =>
                            setEntries((old) => [
                              ...old,
                              { key: m.metricKey, amount: "" },
                            ])
                          }
                        >
                          {t("editorV2.add")}
                        </ActionButton>
                      }
                    />
                  ))}
                </PanelList>
              );
            })}
            {candidates.length === 0 ? (
              <EmptyState title={t("editorV2.candidates")} />
            ) : null}
          </div>

          <div className="grid min-w-0 gap-2xs">
            <h4 className="text-body-sm text-muted-foreground">
              {t("editorV2.chosen")}
            </h4>
            {entries.length === 0 ? (
              <EmptyState title={t("editorV2.chosenEmpty")} />
            ) : (
              <PanelList>
                {entries.map((entry, index) => {
                  const meta = metricOf(entry.key);
                  const n = Number(entry.amount);
                  return (
                    <PanelItem
                      key={entry.key}
                      main={
                        <span className="inline-flex flex-wrap items-center gap-2xs">
                          <span className="font-mono">{entry.key}</span>
                          <span className="font-mono text-body-sm text-muted-foreground">
                            {meta?.metricUnit ?? "—"}
                          </span>
                          {/* 千分位预览：十一位的字节数不分组根本读不出量级。 */}
                          {Number.isFinite(n) && entry.amount.trim() !== "" ? (
                            <span className="text-body-sm text-muted-foreground">
                              {n === -1 ? "-1" : formatNumber(n)}
                            </span>
                          ) : null}
                        </span>
                      }
                      trail={
                        <span className="inline-flex items-center justify-end gap-2xs">
                          <Input
                            type="number"
                            value={entry.amount}
                            disabled={busy}
                            onChange={(e) =>
                              setEntries((old) =>
                                old.map((it, i) =>
                                  i === index
                                    ? { ...it, amount: e.target.value }
                                    : it,
                                ),
                              )
                            }
                            aria-label={`${entry.key} ${t("editorV2.amount")}`}
                            className="w-panel-2xs text-right font-mono"
                          />
                          <ActionButton
                            variant="outline"
                            icon="minus"
                            disabled={busy}
                            onClick={() =>
                              setEntries((old) =>
                                old.filter((_, i) => i !== index),
                              )
                            }
                          >
                            {t("editorV2.remove")}
                          </ActionButton>
                        </span>
                      }
                    />
                  );
                })}
              </PanelList>
            )}
          </div>
        </div>
      </Section>

      {/* ── 绑定产品：只 L2 可选，L1/L3/未分层列出但置灰并说明 ─────────── */}
      <Section
        aria-label={t("editorV2.bundleHeading")}
        level={2}
        icon="plugs-connected"
        title={t("editorV2.bundleHeading")}
        description={t("editorV2.bundleHint")}
      >
        <div className="grid min-w-0 gap-md lg:grid-cols-2">
          <div className="grid min-w-0 gap-2xs">
            <h4 className="text-body-sm text-muted-foreground">
              {t("editorV2.bundleCandidates")}
            </h4>
            {LAYER_ORDER.map((layer) => {
              const group = bundleCandidates.filter(
                (item) => layerKeyOf(item) === layer,
              );
              if (group.length === 0) return null;
              const allowed = layer === "L2";
              return (
                <PanelList key={layer}>
                  <PanelItem
                    main={
                      <span className="inline-flex flex-wrap items-center gap-2xs">
                        <StatusBadge tone={allowed ? "brand" : "neutral"}>
                          {t(
                            `editorV2.layer${layer === "none" ? "None" : layer}`,
                          )}
                        </StatusBadge>
                        <span className="text-body-sm text-muted-foreground">
                          {t(
                            `editorV2.layer${layer === "none" ? "None" : layer}Hint`,
                          )}
                        </span>
                      </span>
                    }
                  />
                  {group.map((item) => (
                    <PanelItem
                      key={item.productCode}
                      main={
                        <span className="inline-flex flex-wrap items-center gap-2xs">
                          <span>{item.productName}</span>
                          <span className="font-mono text-body-sm text-muted-foreground">
                            {item.productCode}
                          </span>
                        </span>
                      }
                      trail={
                        <ActionButton
                          variant="outline"
                          icon="plus"
                          disabled={busy || !allowed}
                          onClick={() =>
                            setBundle((old) => [
                              ...old,
                              {
                                productCode: item.productCode,
                                productName: item.productName,
                                quota: {},
                                features: [],
                              },
                            ])
                          }
                        >
                          {t("editorV2.add")}
                        </ActionButton>
                      }
                    />
                  ))}
                </PanelList>
              );
            })}
          </div>

          <div className="grid min-w-0 gap-2xs">
            <h4 className="text-body-sm text-muted-foreground">
              {t("editorV2.bundleChosen")}
            </h4>
            {bundle.length === 0 ? (
              <EmptyState title={t("editorV2.bundleChosenEmpty")} />
            ) : (
              <PanelList>
                {bundle.map((item, index) => (
                  <PanelItem
                    key={item.productCode}
                    main={
                      <span className="inline-flex flex-wrap items-center gap-2xs">
                        <span>{item.productName}</span>
                        <StatusBadge tone="brand">
                          {t("editorV2.priority", { n: 50 - index })}
                        </StatusBadge>
                      </span>
                    }
                    trail={
                      <span className="inline-flex items-center justify-end gap-2xs">
                        <ActionButton
                          variant="outline"
                          icon="arrow-up"
                          disabled={busy || index === 0}
                          onClick={() =>
                            setBundle((old) => {
                              const next = [...old];
                              const prev = next[index - 1];
                              const cur = next[index];
                              if (!prev || !cur) return old;
                              next[index - 1] = cur;
                              next[index] = prev;
                              return next;
                            })
                          }
                        >
                          {t("editorV2.moveUp")}
                        </ActionButton>
                        <ActionButton
                          variant="outline"
                          icon="arrow-down"
                          disabled={busy || index === bundle.length - 1}
                          onClick={() =>
                            setBundle((old) => {
                              const next = [...old];
                              const after = next[index + 1];
                              const cur = next[index];
                              if (!after || !cur) return old;
                              next[index + 1] = cur;
                              next[index] = after;
                              return next;
                            })
                          }
                        >
                          {t("editorV2.moveDown")}
                        </ActionButton>
                        <ActionButton
                          variant="outline"
                          icon="minus"
                          disabled={busy}
                          onClick={() =>
                            setBundle((old) =>
                              old.filter((_, i) => i !== index),
                            )
                          }
                        >
                          {t("editorV2.remove")}
                        </ActionButton>
                      </span>
                    }
                  />
                ))}
              </PanelList>
            )}
            <p className="text-body-sm text-muted-foreground">
              {t("editorV2.priorityHint")}
            </p>
          </div>
        </div>
      </Section>

      {/* ── 落库预览：默认收起，只为「怀疑组装错了」时能当场核对 ───────── */}
      <Section
        aria-label={t("editorV2.previewTitle")}
        level={3}
        icon="code"
        title={t("editorV2.previewTitle")}
        description={t("editorV2.previewHint")}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPreviewOpen((on) => !on)}
          >
            {previewOpen ? t("retired.collapse") : t("retired.expand")}
          </Button>
        }
      >
        {previewOpen ? (
          <pre className="overflow-x-auto rounded-md bg-muted p-sm font-mono text-body-sm">
            {JSON.stringify(composedQuota, null, 2)}
          </pre>
        ) : null}
      </Section>

      {/* ── 动作：左可逆、右不可逆 ─────────────────────────────────────── */}
      <Section aria-label={t("editorV2.save")} level={3} icon="check">
        <div className="flex flex-wrap items-center justify-between gap-sm">
          <span className="inline-flex flex-wrap items-center gap-2xs">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => void save()}
            >
              {t("editorV2.save")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !detail}
              onClick={() => {
                if (detail) hydrate(detail);
                setMessage(t("editorV2.discarded"));
              }}
            >
              {t("editorV2.discard")}
            </Button>
            <span className="text-body-sm text-muted-foreground">
              {t("editorV2.actionsLeftHint")}
            </span>
          </span>
          <span className="inline-flex flex-wrap items-center justify-end gap-2xs">
            <span className="text-body-sm text-muted-foreground">
              {t("editorV2.actionsRightHint")}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => void publish()}
            >
              {t("editorV2.publish")}
            </Button>
          </span>
        </div>
      </Section>
    </DetailPageTemplate>
  );
}
