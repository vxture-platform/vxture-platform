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

function statusBadge(status: string, isCurrent: boolean) {
  if (status === "published") {
    return (
      <StatusBadge tone={isCurrent ? "success" : "neutral"}>
        {isCurrent ? "已发布 · 当前" : "已发布"}
      </StatusBadge>
    );
  }
  return <StatusBadge tone="warning">草稿 · 待发布</StatusBadge>;
}

// The BFF serializes prices at fixed 2dp; the guard keeps a legacy 6dp string
// out of the money input.
function normalizePrice(raw: string | undefined): string {
  if (!raw) return "";
  const n = Number(raw);
  return Number.isFinite(n) ? n.toFixed(2) : "";
}

function priceLine(prices: { cycleUnit: string; price: string }[]): string {
  if (prices.length === 0) return "未定价";
  return prices
    .map((p) => {
      const cycle =
        p.cycleUnit === "month"
          ? "月"
          : p.cycleUnit === "year"
            ? "年"
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
          setMessage("配额 JSON 格式错误，无法保存。");
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
      setMessage("草稿已保存。");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存失败。");
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
      setMessage("已发布：该版本已冻结并设为当前版本。");
    } catch (err) {
      if (isStepUpCancelled(err)) {
        setBusy(false);
        return;
      }
      setMessage(err instanceof Error ? err.message : "发布失败。");
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
      setMessage(`已开出草稿 v${draft.versionNo}（自当前版本克隆）。`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "开草稿失败。");
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
      <PageHeader
        title="套餐发布"
        description="平台面向多个产品发布套餐：每个产品在五档商业阶梯（free / starter / pro / business / enterprise）内各发布至多一条套餐，可少不可多。点选套餐查看完整版本史（plan_version），草稿在此编辑与发布，已发布版本冻结只读。"
      />

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
                  已发布 {publishedTiers.size} / {TIERS.length} 档
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
                          <StatusBadge tone="warning">同档多套餐</StatusBadge>
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
                                ? `v${plan.currentVersion.versionNo} · ${priceLine(plan.currentVersion.prices)}`
                                : "未发布"}
                              {plan.draftVersion
                                ? ` · 草稿 v${plan.draftVersion.versionNo}`
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
                          + 新建套餐
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
          <p className="text-sm text-vx-gray-500">
            暂无可独立订阅的产品——基础设施产品（如 atlas /
            runos）不直接售卖套餐，只作为捆绑组件进入其他产品的版本。
          </p>
        ) : null}
      </div>

      {/* ── version timeline + editor ─────────────────────────────────────── */}
      {selectedPlan ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">
                {selectedPlan.planName}（{selectedPlan.planCode}）版本史
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
              <p className="text-sm text-vx-gray-500">尚无版本。</p>
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
                          {statusBadge(v.status, v.isCurrent)}
                        </span>
                        <span className="text-xs text-vx-gray-500">
                          {priceLine(v.prices)} ·{" "}
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
                开新草稿版本（自当前版本克隆）
              </Button>
            ) : null}
          </div>

          {detail ? (
            <div className="flex flex-col gap-4">
              <h3 className="text-sm font-semibold">
                v{detail.versionNo} · {detail.planName}{" "}
                {statusBadge(detail.status, detail.isCurrent)}
              </h3>
              {!editable ? (
                <p className="text-sm text-vx-gray-500">
                  已发布版本为只读（受锁保护）；要改动请开新草稿版本。
                </p>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">月付价（¥）</label>
                  <Input
                    type="number"
                    value={priceMonth}
                    disabled={!editable}
                    onChange={(e) => setPriceMonth(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">年付价（¥）</label>
                  <Input
                    type="number"
                    value={priceYear}
                    disabled={!editable}
                    onChange={(e) => setPriceYear(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">配额（JSON）</label>
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
                  保存草稿
                </Button>
                <Button onClick={publish} disabled={!editable || busy}>
                  发布该版本
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
              从左侧版本史选择一个版本查看或编辑。
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-vx-gray-500">
          从上方矩阵点选一条套餐查看版本史，或在空档新建套餐。
        </p>
      )}

      {createTarget ? (
        <PlanCreateDialog
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
            setMessage(
              `套餐 ${created.planCode} 已创建（v1 草稿）——补上价格与配额后发布。`,
            );
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
  target,
  busy,
  onClose,
  onCreated,
}: {
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
      setError(err instanceof Error ? err.message : "创建失败。");
      setSubmitting(false);
    }
  }

  return (
    <DialogForm
      open
      title={`新建套餐 · ${target.productName} · ${tierLabel(target.tier)}`}
      description="创建套餐骨架（v1 草稿 + 主组件档位），价格与配额在草稿里补，发布前不可售。"
      submitLabel="创建套餐"
      submitting={submitting || busy}
      submitDisabled={!planCode.trim() || !planName.trim()}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onSubmit={submit}
    >
      {error ? <p className="text-sm text-vx-danger">{error}</p> : null}
      <Label>
        套餐编码
        <Input
          value={planCode}
          onChange={(e) => setPlanCode(e.target.value)}
          placeholder="如 karda-starter（小写字母 / 数字 / 连字符）"
          required
        />
      </Label>
      <Label>
        套餐名称
        <Input
          value={planName}
          onChange={(e) => setPlanName(e.target.value)}
          placeholder="如 Karda 入门版"
          required
        />
      </Label>
      <Label>
        描述
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="选填：这档套餐卖给谁、含什么"
          rows={3}
        />
      </Label>
    </DialogForm>
  );
}
