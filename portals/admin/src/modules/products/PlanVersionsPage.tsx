"use client";

/**
 * PlanVersionsPage — 套餐版本生命周期管理（product_320）。
 *
 * 运营在此选择方案 → 查看其 plan_version（草稿/发布态）→ 编辑草稿的价格与配额 →
 * 发布（draft→published：冻结 + 设为当前版本，危操作走 step-up）。发布态版本只读。
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  StatusBadge,
  Button,
  Input,
  NativeSelect,
  PanelItem,
  PanelList,
  TableTitleCell,
  Textarea,
  ViewLayout,
} from "@vxture/design-system";
import {
  fetchPlanVersion,
  fetchPlanVersions,
  fetchProductCapabilities,
  fetchProductPlans,
  publishPlanVersion,
  replacePlanVersionBundledComponents,
  updateDraftPlanVersion,
  type PlanVersionBundledComponentInput,
  type PlanVersionComponent,
  type PlanVersionDetail,
  type PlanVersionSummary,
} from "@/api/admin-bff";
import type {
  ProductCapabilityRecord,
  ProductPlanRecord,
} from "@/entities/console";
import { PageHeader } from "@/modules/shared/PageHeader";
import { isStepUpCancelled, useStepUp } from "@/providers/StepUpProvider";

/**
 * Editor row for one bundled component. Quota is edited as JSON text (same
 * control as the primary quota above it); features / priority are carried
 * through untouched so a re-save never drops what seed or an earlier edit set.
 */
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

/**
 * 这三个徽章原本挂的是 `vx-badge-positive` / `-neutral` / `-warning`——那三个类
 * **哪儿都没定义**（admin 样式表没有，DS 也没有），所以语气色一直没生效，
 * 三种状态渲染成同一个默认徽章。换成 `StatusBadge` 的 `tone`：语气是它的
 * 契约，不靠调用方拼类名。
 */
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

// Money-input prefill: the BFF now serializes prices at fixed 2dp, but keep
// the guard so a legacy 6dp string never reaches the editor input.
function normalizePrice(raw: string | undefined): string {
  if (!raw) return "";
  const n = Number(raw);
  return Number.isFinite(n) ? n.toFixed(2) : "";
}

export function PlanVersionsPage() {
  const tShared = useTranslations();
  const t = useTranslations("planVersionsPage");
  const { runWithStepUp } = useStepUp();
  const [plans, setPlans] = useState<ProductPlanRecord[]>([]);
  // Full catalog (every non-deleted product, active first) — bundled picks must
  // reach infrastructure products such as atlas / runos, which have no plans.
  const [catalog, setCatalog] = useState<ProductCapabilityRecord[]>([]);
  const [planId, setPlanId] = useState("");
  const [versions, setVersions] = useState<PlanVersionSummary[]>([]);
  const [detail, setDetail] = useState<PlanVersionDetail | null>(null);
  const [priceMonth, setPriceMonth] = useState("");
  const [priceYear, setPriceYear] = useState("");
  const [quotaText, setQuotaText] = useState("");
  const [bundled, setBundled] = useState<BundledDraft[]>([]);
  const [bundledPick, setBundledPick] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchProductPlans().then(setPlans);
    void fetchProductCapabilities().then(setCatalog);
  }, []);

  const loadVersions = useCallback((id: string) => {
    if (!id) {
      setVersions([]);
      return;
    }
    void fetchPlanVersions(id).then(setVersions);
  }, []);

  useEffect(() => {
    setDetail(null);
    setMessage(null);
    loadVersions(planId);
  }, [planId, loadVersions]);

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

  const editable = detail?.status === "draft" && !detail.isLocked;

  // Products still available to bundle: not the version's own primary product
  // and not already on the list. Catalog order (active first) is kept.
  const bundledCandidates = catalog.filter(
    (product) =>
      product.productCode !== detail?.productCode &&
      !bundled.some((item) => item.productCode === product.productCode),
  );

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
      loadVersions(planId);
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
      loadVersions(planId);
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

  function updateBundledQuota(productCode: string, quotaText: string) {
    setBundled((old) =>
      old.map((item) =>
        item.productCode === productCode ? { ...item, quotaText } : item,
      ),
    );
  }

  // PUT = full replace: the whole list goes every time, so a removed row is
  // simply absent from the body. Step-up gated like publish.
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

  return (
    <ViewLayout>
      <PageHeader
        title="套餐版本"
        description="管理 plan_version 的草稿与发布：编辑草稿的价格与配额，发布后版本冻结并成为当前版本。"
      />

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">选择方案</label>
        <NativeSelect
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
        >
          <option value="">— 请选择方案 —</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.planName}（{p.planCode}）
            </option>
          ))}
        </NativeSelect>
      </div>

      {message ? <p className="text-sm">{message}</p> : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">版本列表</h3>
          {versions.length === 0 ? (
            <p className="text-sm text-vx-gray-500">尚无版本或未选择方案。</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {versions.map((v) => (
                <li key={v.id}>
                  <Button
                    variant="outline"
                    onClick={() => openVersion(v.id)}
                    className="w-full justify-between"
                  >
                    <span className="flex items-center gap-2">
                      <strong>v{v.versionNo}</strong>
                      {statusBadge(v.status, v.isCurrent)}
                    </span>
                    <span className="text-sm text-vx-gray-500">
                      {v.prices.length > 0
                        ? v.prices
                            .map(
                              (p) =>
                                `${p.cycleUnit} ¥${Number(p.price).toFixed(2)}`,
                            )
                            .join(" · ")
                        : "无价格"}
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {detail ? (
          <div className="flex flex-col gap-4">
            <h3 className="text-sm font-semibold">
              编辑 v{detail.versionNo} · {detail.planName}{" "}
              {statusBadge(detail.status, detail.isCurrent)}
            </h3>
            {!editable ? (
              <p className="text-sm text-vx-gray-500">
                已发布版本为只读（受锁保护，不可编辑）。
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
                <h4 className="text-sm font-semibold">{t("bundled.title")}</h4>
                <p className="text-sm text-vx-gray-500">
                  {t("bundled.description")}
                </p>
              </div>

              {bundled.length === 0 ? (
                <p className="text-sm text-vx-gray-500">{t("bundled.empty")}</p>
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
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{tShared("actions.edit")}</h3>
            <p className="text-sm text-vx-gray-500">
              从左侧选择一个版本进行查看/编辑。
            </p>
          </div>
        )}
      </div>
    </ViewLayout>
  );
}
