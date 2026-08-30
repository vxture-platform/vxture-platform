"use client";

/**
 * PlanVersionsPage.tsx - the plan publishing desk (product × tier matrix)
 * @package  @vxture/admin
 * @layer    Presentation
 * @category module
 * @description
 *   Full redesign of the plan publishing surface (90-plan-publishing.md).
 *   The platform publishes plans for MANY products, each on a ladder of at
 *   most five commercial tiers — so the entry point is a product × tier
 *   matrix, not a plan dropdown: every sellable product is a row, every tier
 *   a slot, and an empty slot is an explicit "nothing published here yet"
 *   with a create action. Selecting a plan opens its full plan_version
 *   timeline (v1…vN with status, current pointer, prices and dates); drafts
 *   are edited and published from there, published versions stay read-only.
 *   All copy lives in the `planVersionsPage` message namespace (i18n ratchet).
 *
 * @author AI-Generated
 * @date 2026-09-01
 */

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Badge,
  Button,
  DialogForm,
  Input,
  Label,
  NativeSelect,
  PanelItem,
  PanelList,
  StatusBadge,
  TableTitleCell,
  Textarea,
  ViewLayout,
} from "@vxture/design-system";
import { TIERS } from "@vxture-platform/shared";
import {
  createPlanDraftVersion,
  createProductPlan,
  fetchPlanMatrix,
  fetchPlanVersion,
  fetchPlanVersions,
  fetchProductCapabilities,
  publishPlanVersion,
  replacePlanVersionBundledComponents,
  updateDraftPlanVersion,
  type PlanMatrixPlan,
  type PlanMatrixProduct,
  type PlanVersionBundledComponentInput,
  type PlanVersionComponent,
  type PlanVersionDetail,
  type PlanVersionSummary,
} from "@/api/admin-bff";
import type { ProductCapabilityRecord } from "@/entities/console";
import { PageHeader } from "@/modules/shared/PageHeader";
import { tierBadgeClass, tierLabel } from "@/modules/shared/tier-level";
import { formatDate } from "@/modules/tenants/tenant-utils";
import { isStepUpCancelled, useStepUp } from "@/providers/StepUpProvider";

// ============================================================================
// Local editor state
// ============================================================================

/** next-intl translator scoped to the `planVersionsPage` namespace. */
type Translator = ReturnType<typeof useTranslations<"planVersionsPage">>;

/** Editor row for one bundled component (quota edited as JSON text). */
interface BundledDraft {
  productCode: string;
  productName: string;
  quotaText: string;
  features: string[];
  priority: number | null;
}

function toBundledDrafts(components: PlanVersionComponent[]): BundledDraft[] {
  return components
    .filter((component) => component.componentRole === "bundled")
    .map((component) => ({
      productCode: component.productCode,
      productName: component.productName,
      quotaText: JSON.stringify(component.quota, null, 2),
      features: component.features,
      priority: component.priority,
    }));
}

/** The matrix slot an operator is creating a plan into. */
interface CreateTarget {
  productCode: string;
  productName: string;
  tier: string;
}

function statusBadge(t: Translator, status: string, isCurrent: boolean) {
  if (status === "published") {
    return (
      <StatusBadge tone={isCurrent ? "success" : "neutral"}>
        {isCurrent ? t("badge.publishedCurrent") : t("badge.published")}
      </StatusBadge>
    );
  }
  return <StatusBadge tone="warning">{t("badge.draft")}</StatusBadge>;
}

// The BFF serializes prices at fixed 2dp; the guard keeps a legacy 6dp string
// out of the money input.
function normalizePrice(raw: string | undefined): string {
  if (!raw) return "";
  const n = Number(raw);
  return Number.isFinite(n) ? n.toFixed(2) : "";
}

function priceLine(
  t: Translator,
  prices: { cycleUnit: string; price: string }[],
): string {
  if (prices.length === 0) return t("price.none");
  return prices
    .map((p) => {
      const cycle =
        p.cycleUnit === "month"
          ? t("price.month")
          : p.cycleUnit === "year"
            ? t("price.year")
            : p.cycleUnit;
      return `¥${Number(p.price).toFixed(2)}/${cycle}`;
    })
    .join(" · ");
}

// ============================================================================
// Page
// ============================================================================

export function PlanVersionsPage() {
  const t = useTranslations("planVersionsPage");
  const locale = useLocale();
  const { runWithStepUp } = useStepUp();

  const [matrix, setMatrix] = useState<PlanMatrixProduct[]>([]);
  // Full catalog for bundled picks — must reach infrastructure products such
  // as atlas / runos, which sell no plans of their own.
  const [catalog, setCatalog] = useState<ProductCapabilityRecord[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<
    (PlanMatrixPlan & { productCode: string; productName: string }) | null
  >(null);
  const [versions, setVersions] = useState<PlanVersionSummary[]>([]);
  const [detail, setDetail] = useState<PlanVersionDetail | null>(null);
  const [priceMonth, setPriceMonth] = useState("");
  const [priceYear, setPriceYear] = useState("");
  const [quotaText, setQuotaText] = useState("");
  const [bundled, setBundled] = useState<BundledDraft[]>([]);
  const [bundledPick, setBundledPick] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createTarget, setCreateTarget] = useState<CreateTarget | null>(null);

  const loadMatrix = useCallback(async () => {
    setMatrix(await fetchPlanMatrix());
  }, []);

  useEffect(() => {
    void loadMatrix();
    void fetchProductCapabilities().then(setCatalog);
  }, [loadMatrix]);

  async function openVersion(versionId: string) {
    setMessage(null);
    const d = await fetchPlanVersion(versionId);
    setDetail(d);
    if (d) {
      setPriceMonth(
        normalizePrice(d.prices.find((p) => p.cycleUnit === "month")?.price),
      );
      setPriceYear(
        normalizePrice(d.prices.find((p) => p.cycleUnit === "year")?.price),
      );
      setQuotaText(JSON.stringify(d.quota, null, 2));
      setBundled(toBundledDrafts(d.components));
      setBundledPick("");
    }
  }

  /** Select a plan from the matrix and land on its most actionable version. */
  const selectPlan = useCallback(
    async (
      plan: PlanMatrixPlan,
      product: Pick<PlanMatrixProduct, "productCode" | "productName">,
    ) => {
      setSelectedPlan({
        ...plan,
        productCode: product.productCode,
        productName: product.productName,
      });
      setDetail(null);
      setMessage(null);
      const list = await fetchPlanVersions(plan.planId);
      setVersions(list);
      // The draft (if any) is what an operator came to work on; otherwise the
      // current published version is the truth worth reading first.
      const target =
        list.find((v) => v.status === "draft" && !v.isLocked) ??
        list.find((v) => v.isCurrent) ??
        list[list.length - 1];
      if (target) await openVersion(target.id);
    },
    [],
  );

  /** Refresh matrix + version list after a write, keeping the selection. */
  async function refreshAfterWrite(planId: string) {
    await loadMatrix();
    setVersions(await fetchPlanVersions(planId));
  }

  const editable = detail?.status === "draft" && !detail.isLocked;

  const bundledCandidates = catalog.filter(
    (product) =>
      product.productCode !== detail?.productCode &&
      !bundled.some((item) => item.productCode === product.productCode),
  );

  // ── draft editing ─────────────────────────────────────────────────────────

  async function saveDraft() {
    if (!detail) return;
    setBusy(true);
    setMessage(null);
    try {
      let quota: Record<string, unknown> | undefined;
      if (quotaText.trim()) {
        try {
          quota = JSON.parse(quotaText) as Record<string, unknown>;
        } catch {
          setMessage(t("editor.quotaInvalid"));
          setBusy(false);
          return;
        }
      }
      const prices: { cycleUnit: string; price: number }[] = [];
      if (priceMonth !== "")
        prices.push({ cycleUnit: "month", price: Number(priceMonth) });
      if (priceYear !== "")
        prices.push({ cycleUnit: "year", price: Number(priceYear) });
      const body: {
        prices?: { cycleUnit: string; price: number }[];
        quota?: Record<string, unknown>;
      } = { prices };
      if (quota !== undefined) body.quota = quota;
      const updated = await updateDraftPlanVersion(detail.id, body);
      setDetail(updated);
      await refreshAfterWrite(updated.planId);
      setMessage(t("editor.saved"));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t("editor.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!detail) return;
    setBusy(true);
    setMessage(null);
    try {
      await runWithStepUp(() => publishPlanVersion(detail.id));
      await openVersion(detail.id);
      await refreshAfterWrite(detail.planId);
      setMessage(t("editor.published"));
    } catch (err) {
      if (isStepUpCancelled(err)) {
        setBusy(false);
        return;
      }
      setMessage(
        err instanceof Error ? err.message : t("editor.publishFailed"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function openNextDraft() {
    if (!selectedPlan) return;
    setBusy(true);
    setMessage(null);
    try {
      const draft = await createPlanDraftVersion(selectedPlan.planId);
      await refreshAfterWrite(selectedPlan.planId);
      setDetail(draft);
      setPriceMonth(
        normalizePrice(
          draft.prices.find((p) => p.cycleUnit === "month")?.price,
        ),
      );
      setPriceYear(
        normalizePrice(draft.prices.find((p) => p.cycleUnit === "year")?.price),
      );
      setQuotaText(JSON.stringify(draft.quota, null, 2));
      setBundled(toBundledDrafts(draft.components));
      setMessage(t("editor.draftOpened", { n: draft.versionNo }));
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : t("editor.draftOpenFailed"),
      );
    } finally {
      setBusy(false);
    }
  }

  // ── bundled components (unchanged contract: PUT = full replace) ───────────

  function addBundled() {
    const product = bundledCandidates.find(
      (item) => item.productCode === bundledPick,
    );
    if (!product) return;
    setBundled((old) => [
      ...old,
      {
        productCode: product.productCode,
        productName: product.productName,
        quotaText: "{}",
        features: [],
        priority: null,
      },
    ]);
    setBundledPick("");
  }

  function removeBundled(productCode: string) {
    setBundled((old) => old.filter((item) => item.productCode !== productCode));
  }

  function updateBundledQuota(productCode: string, text: string) {
    setBundled((old) =>
      old.map((item) =>
        item.productCode === productCode ? { ...item, quotaText: text } : item,
      ),
    );
  }

  async function saveBundled() {
    if (!detail) return;
    setBusy(true);
    setMessage(null);
    try {
      const components: PlanVersionBundledComponentInput[] = [];
      for (const item of bundled) {
        let quota: Record<string, unknown>;
        try {
          quota = JSON.parse(item.quotaText || "{}") as Record<string, unknown>;
        } catch {
          setMessage(t("bundled.quotaInvalid", { name: item.productName }));
          setBusy(false);
          return;
        }
        components.push({
          productCode: item.productCode,
          quota,
          features: item.features,
          ...(item.priority === null ? {} : { priority: item.priority }),
        });
      }
      const updated = await runWithStepUp(() =>
        replacePlanVersionBundledComponents(detail.id, components),
      );
      setDetail(updated);
      setBundled(toBundledDrafts(updated.components));
      setMessage(t("bundled.saved"));
    } catch (err) {
      if (isStepUpCancelled(err)) {
        setBusy(false);
        return;
      }
      setMessage(err instanceof Error ? err.message : t("bundled.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <ViewLayout>
      <PageHeader title={t("title")} description={t("pageDescription")} />

      {message ? (
        <p className="text-sm" role="status">
          {message}
        </p>
      ) : null}

      {/* ── product × tier matrix ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-6">
        {matrix.map((product) => {
          const publishedTiers = new Set(
            product.plans
              .filter((plan) => plan.currentVersion)
              .map((plan) => plan.tier),
          );
          return (
            <section key={product.productCode} className="flex flex-col gap-2">
              <div className="flex items-baseline gap-2">
                <h3 className="text-sm font-semibold">{product.productName}</h3>
                <span className="text-xs text-vx-gray-500">
                  {product.productCode}
                </span>
                {product.productStatus !== "active" ? (
                  <StatusBadge tone="neutral">
                    {product.productStatus}
                  </StatusBadge>
                ) : null}
                <span className="ml-auto text-xs text-vx-gray-500">
                  {t("matrix.publishedCount", {
                    n: publishedTiers.size,
                    total: TIERS.length,
                  })}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
                {TIERS.map((tier) => {
                  const plans = product.plans.filter((p) => p.tier === tier);
                  const crowded = plans.length > 1;
                  return (
                    <div
                      key={tier}
                      className="flex min-h-24 flex-col gap-2 rounded-md border border-vx-gray-200 p-2"
                    >
                      <div className="flex items-center gap-1">
                        <Badge
                          variant="outline"
                          className={tierBadgeClass(tier)}
                        >
                          {tierLabel(tier)}
                        </Badge>
                        {crowded ? (
                          <StatusBadge tone="warning">
                            {t("matrix.crowded")}
                          </StatusBadge>
                        ) : null}
                      </div>
                      {plans.map((plan) => {
                        const active = selectedPlan?.planId === plan.planId;
                        return (
                          <Button
                            key={plan.planId}
                            variant="ghost"
                            onClick={() => void selectPlan(plan, product)}
                            className={`h-auto w-full flex-col items-start gap-0.5 border p-2 text-left text-sm ${
                              active
                                ? "border-vx-primary bg-vx-primary/5"
                                : "border-transparent hover:border-vx-gray-300"
                            }`}
                          >
                            <span className="font-medium">{plan.planName}</span>
                            <span className="text-xs text-vx-gray-500">
                              {plan.planCode}
                            </span>
                            <span className="text-xs text-vx-gray-500">
                              {plan.currentVersion
                                ? `v${plan.currentVersion.versionNo} · ${priceLine(t, plan.currentVersion.prices)}`
                                : t("matrix.unpublished")}
                              {plan.draftVersion
                                ? ` · ${t("matrix.draftShort", { n: plan.draftVersion.versionNo })}`
                                : ""}
                            </span>
                          </Button>
                        );
                      })}
                      {plans.length === 0 ? (
                        <Button
                          variant="ghost"
                          onClick={() =>
                            setCreateTarget({
                              productCode: product.productCode,
                              productName: product.productName,
                              tier,
                            })
                          }
                          className="h-auto flex-1 border border-dashed border-vx-gray-300 text-xs text-vx-gray-500 hover:border-vx-gray-400 hover:text-vx-gray-700"
                        >
                          {t("matrix.create")}
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
        {matrix.length === 0 ? (
          <p className="text-sm text-vx-gray-500">{t("matrix.empty")}</p>
        ) : null}
      </div>

      {/* ── version timeline + editor ─────────────────────────────────────── */}
      {selectedPlan ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">
                {t("timeline.heading", {
                  name: selectedPlan.planName,
                  code: selectedPlan.planCode,
                })}
              </h3>
              <Badge
                variant="outline"
                className={tierBadgeClass(selectedPlan.tier)}
              >
                {tierLabel(selectedPlan.tier)}
              </Badge>
              <span className="text-xs text-vx-gray-500">
                {selectedPlan.productName}
              </span>
            </div>
            {versions.length === 0 ? (
              <p className="text-sm text-vx-gray-500">{t("timeline.none")}</p>
            ) : (
              <PanelList>
                {[...versions].reverse().map((v) => (
                  <PanelItem
                    key={v.id}
                    main={
                      <Button
                        variant="ghost"
                        onClick={() => void openVersion(v.id)}
                        className={`h-auto w-full justify-between gap-2 p-1 text-left ${
                          detail?.id === v.id ? "bg-vx-primary/5" : ""
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <strong>v{v.versionNo}</strong>
                          {statusBadge(t, v.status, v.isCurrent)}
                        </span>
                        <span className="text-xs text-vx-gray-500">
                          {priceLine(t, v.prices)} ·{" "}
                          {formatDate(v.createdAt, locale)}
                        </span>
                      </Button>
                    }
                  />
                ))}
              </PanelList>
            )}
            {!versions.some((v) => v.status === "draft" && !v.isLocked) ? (
              <Button
                variant="outline"
                onClick={openNextDraft}
                disabled={busy}
                className="self-start"
              >
                {t("timeline.openDraft")}
              </Button>
            ) : null}
          </div>

          {detail ? (
            <div className="flex flex-col gap-4">
              <h3 className="text-sm font-semibold">
                {t("editor.versionHeading", {
                  n: detail.versionNo,
                  name: detail.planName,
                })}{" "}
                {statusBadge(t, detail.status, detail.isCurrent)}
              </h3>
              {!editable ? (
                <p className="text-sm text-vx-gray-500">
                  {t("timeline.readOnly")}
                </p>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">
                    {t("editor.priceMonth")}
                  </label>
                  <Input
                    type="number"
                    value={priceMonth}
                    disabled={!editable}
                    onChange={(e) => setPriceMonth(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">
                    {t("editor.priceYear")}
                  </label>
                  <Input
                    type="number"
                    value={priceYear}
                    disabled={!editable}
                    onChange={(e) => setPriceYear(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">
                  {t("editor.quotaJson")}
                </label>
                <Textarea
                  value={quotaText}
                  disabled={!editable}
                  onChange={(e) => setQuotaText(e.target.value)}
                  rows={12}
                  className="font-mono"
                />
              </div>

              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  onClick={saveDraft}
                  disabled={!editable || busy}
                >
                  {t("editor.saveDraft")}
                </Button>
                <Button onClick={publish} disabled={!editable || busy}>
                  {t("editor.publish")}
                </Button>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <h4 className="text-sm font-semibold">
                    {t("bundled.title")}
                  </h4>
                  <p className="text-sm text-vx-gray-500">
                    {t("bundled.description")}
                  </p>
                </div>

                {bundled.length === 0 ? (
                  <p className="text-sm text-vx-gray-500">
                    {t("bundled.empty")}
                  </p>
                ) : (
                  <PanelList>
                    {bundled.map((item) => (
                      <PanelItem
                        key={item.productCode}
                        main={
                          <div className="flex flex-col gap-1">
                            <TableTitleCell
                              title={item.productName}
                              description={item.productCode}
                            />
                            <Textarea
                              value={item.quotaText}
                              disabled={!editable}
                              aria-label={t("bundled.quotaLabel", {
                                name: item.productName,
                              })}
                              onChange={(e) =>
                                updateBundledQuota(
                                  item.productCode,
                                  e.target.value,
                                )
                              }
                              rows={4}
                              className="font-mono"
                            />
                          </div>
                        }
                        trail={
                          editable ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => removeBundled(item.productCode)}
                            >
                              {t("bundled.remove")}
                            </Button>
                          ) : null
                        }
                      />
                    ))}
                  </PanelList>
                )}

                {editable ? (
                  <div className="flex items-end gap-3">
                    <div className="flex flex-1 flex-col gap-1">
                      <label className="text-sm font-medium">
                        {t("bundled.pickLabel")}
                      </label>
                      <NativeSelect
                        value={bundledPick}
                        onChange={(e) => setBundledPick(e.target.value)}
                      >
                        <option value="">{t("bundled.pickPlaceholder")}</option>
                        {bundledCandidates.map((product) => (
                          <option
                            key={product.productCode}
                            value={product.productCode}
                          >
                            {product.productName} · {product.productCode}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    <Button
                      variant="outline"
                      onClick={addBundled}
                      disabled={!bundledPick || busy}
                    >
                      {t("bundled.add")}
                    </Button>
                    <Button onClick={saveBundled} disabled={busy}>
                      {t("bundled.save")}
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="text-sm text-vx-gray-500">
              {t("timeline.pickVersion")}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-vx-gray-500">{t("matrix.hint")}</p>
      )}

      {createTarget ? (
        <PlanCreateDialog
          t={t}
          target={createTarget}
          busy={busy}
          onClose={() => setCreateTarget(null)}
          onCreated={async (created) => {
            setCreateTarget(null);
            await loadMatrix();
            setSelectedPlan({
              planId: created.planId,
              planCode: created.planCode,
              planName: created.planName,
              planStatus: "active",
              tier: createTarget.tier,
              currentVersion: null,
              draftVersion: { id: created.id, versionNo: created.versionNo },
              versionCount: 1,
              productCode: createTarget.productCode,
              productName: createTarget.productName,
            });
            setVersions(await fetchPlanVersions(created.planId));
            await openVersion(created.id);
            setMessage(t("create.created", { code: created.planCode }));
          }}
        />
      ) : null}
    </ViewLayout>
  );
}

// ============================================================================
// Create dialog
// ============================================================================

function PlanCreateDialog({
  t,
  target,
  busy,
  onClose,
  onCreated,
}: {
  t: Translator;
  target: CreateTarget;
  busy: boolean;
  onClose: () => void;
  onCreated: (created: PlanVersionDetail) => Promise<void>;
}) {
  const [planCode, setPlanCode] = useState(
    `${target.productCode}-${target.tier}`,
  );
  const [planName, setPlanName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const created = await createProductPlan({
        planCode: planCode.trim(),
        planName: planName.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        productCode: target.productCode,
        tier: target.tier,
      });
      await onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("create.failed"));
      setSubmitting(false);
    }
  }

  return (
    <DialogForm
      open
      title={t("create.title", {
        product: target.productName,
        tier: tierLabel(target.tier),
      })}
      description={t("create.description")}
      submitLabel={t("create.submit")}
      submitting={submitting || busy}
      submitDisabled={!planCode.trim() || !planName.trim()}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onSubmit={submit}
    >
      {error ? <p className="text-sm text-vx-danger">{error}</p> : null}
      <Label>
        {t("create.codeLabel")}
        <Input
          value={planCode}
          onChange={(e) => setPlanCode(e.target.value)}
          placeholder={t("create.codePlaceholder")}
          required
        />
      </Label>
      <Label>
        {t("create.nameLabel")}
        <Input
          value={planName}
          onChange={(e) => setPlanName(e.target.value)}
          placeholder={t("create.namePlaceholder")}
          required
        />
      </Label>
      <Label>
        {t("create.descLabel")}
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("create.descPlaceholder")}
          rows={3}
        />
      </Label>
    </DialogForm>
  );
}
