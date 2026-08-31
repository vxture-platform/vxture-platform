"use client";

/**
 * ProductSolutionDetailPage —— 方案详情：字段编辑 · 状态迁移 · 产品清单 · 五档套餐绑定。
 *
 * 2026-08-31 去 mock（TD-029）：全部读写走 `/api/products/solutions/*`。写路径每次都
 * 回一份最新详情，页面直接替换本地态，不再二次拉取。
 *
 * 三个对话框各管一件事：改字段（PUT）、配产品（PUT products，整体替换）、绑套餐
 * （PUT plans/:tier）。解绑与退役是破坏性动作，走 `ActionMenu` 的 `confirm` 契约。
 */

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import {
  ActionButton,
  ActionMenu,
  Badge,
  Banner,
  Button,
  Checkbox,
  DetailList,
  DetailPageTemplate,
  DetailRow,
  DialogForm,
  EmptyState,
  Icon,
  Input,
  Label,
  MetricGrid,
  NativeSelect,
  PanelItem,
  PanelList,
  SHELL_PANEL_HAIRLINE,
  StatusBadge,
  TableTitleCell,
  Textarea,
  useToast,
} from "@vxture/design-system";
import type { ActionMenuItem } from "@vxture/design-system";
import { TIERS } from "@vxture-platform/shared";
import { orUnset } from "@/modules/shared/display";
import {
  bindProductSolutionPlan,
  fetchProductCapabilities,
  fetchProductPlans,
  fetchProductSolution,
  replaceProductSolutionProducts,
  setProductSolutionState,
  unbindProductSolutionPlan,
  updateProductSolution,
} from "@/api/admin-bff";
import { isStepUpCancelled, useStepUp } from "@/providers/StepUpProvider";
import type {
  ProductCapabilityRecord,
  ProductPlanRecord,
  ProductSolutionDetailRecord,
  ProductSolutionStatus,
  ProductSolutionTier,
  ProductSolutionTierCode,
  ProductSolutionWriteInput,
} from "@/entities/console";
import {
  SOLUTION_STATUS_TONE,
  VISIBILITY_TONE,
} from "@/modules/shared/publish-tone";
import { tierBadgeClass } from "@/modules/shared/tier-level";
import { PageHeader } from "@/modules/shared/PageHeader";
import { DetailSummaryHeader } from "@/modules/shared/DetailSummaryHeader";
import { DetailSectionHeading } from "@/modules/shared/DetailSectionHeading";
import { useConfirmLabels } from "@/modules/shared/destructive";
import {
  formatDate,
  formatMoney,
  formatNumber,
} from "@/modules/tenants/tenant-utils";
import {
  SOLUTION_STATE_TRANSITIONS,
  capabilityTypeIcon,
  useSolutionLabels,
} from "./solution-labels";

// ─── 表单形状 ──────────────────────────────────────────────────────────────

interface EditForm {
  solutionName: string;
  industry: string;
  scenario: string;
  customerSegment: string;
  ownerTeam: string;
  description: string;
  /** 逗号 / 顿号分隔；提交时拆成数组。 */
  tags: string;
  deliveryMode: string;
  /** 一行一条。 */
  deliveryBoundaries: string;
  isPublic: boolean;
}

function formFromSolution(solution: ProductSolutionDetailRecord): EditForm {
  return {
    solutionName: solution.solutionName,
    industry: solution.industry,
    scenario: solution.scenario,
    customerSegment: solution.customerSegment,
    ownerTeam: solution.ownerTeam,
    description: solution.description,
    tags: solution.tags.join(", "),
    deliveryMode: solution.deliveryMode,
    deliveryBoundaries: solution.deliveryBoundaries.join("\n"),
    isPublic: solution.visibility === "public",
  };
}

function splitList(value: string, separator: RegExp): string[] {
  return Array.from(
    new Set(
      value
        .split(separator)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function buildEditPayload(form: EditForm): ProductSolutionWriteInput {
  return {
    solutionName: form.solutionName.trim(),
    industry: form.industry.trim() || null,
    scenario: form.scenario.trim() || null,
    customerSegment: form.customerSegment.trim() || null,
    ownerTeam: form.ownerTeam.trim() || null,
    description: form.description.trim() || null,
    tags: splitList(form.tags, /[,，、]/),
    deliveryMode: form.deliveryMode.trim() || null,
    deliveryBoundaries: splitList(form.deliveryBoundaries, /\r?\n/),
    isPublic: form.isPublic,
  };
}

interface ProductPick {
  productCode: string;
  included: boolean;
  role: string;
}

type DialogState =
  | { kind: "edit" }
  | { kind: "products" }
  | {
      kind: "bind";
      tier: ProductSolutionTierCode;
      current: ProductSolutionTier | null;
    }
  | null;

/** Spread into `toast()` — `exactOptionalPropertyTypes` forbids an explicit undefined description. */
function describeError(error: unknown): { description?: string } {
  return error instanceof Error && error.message
    ? { description: error.message }
    : {};
}

function errorMessage(error: unknown): string | undefined {
  return describeError(error).description;
}

// ─── 概要 ──────────────────────────────────────────────────────────────────

function ProductSolutionSummary({
  solution,
}: {
  solution: ProductSolutionDetailRecord;
}) {
  const t = useTranslations("productSolutionDetailPage");
  const labels = useSolutionLabels();
  return (
    <DetailSummaryHeader
      icon="workflow"
      title={solution.solutionName}
      subtitle={solution.solutionCode}
      badges={
        <>
          <StatusBadge tone={SOLUTION_STATUS_TONE[solution.status]}>
            {labels.status(solution.status)}
          </StatusBadge>
          <StatusBadge tone={VISIBILITY_TONE[solution.visibility]}>
            {labels.visibility(solution.visibility)}
          </StatusBadge>
        </>
      }
      aside={
        <MetricGrid
          items={[
            {
              id: "products",
              help: t("summary.productsHelp"),
              label: t("summary.products"),
              value: formatNumber(solution.products.length),
              tags: [
                t("summary.partnerTag", {
                  count: solution.products.filter(
                    (item) => item.source === "partner",
                  ).length,
                }),
              ],
            },
            {
              id: "tiers",
              help: t("summary.tiersHelp"),
              label: t("summary.tiers"),
              value: `${formatNumber(solution.tiers.length)} / ${formatNumber(TIERS.length)}`,
              tags: [
                solution.tiers.length
                  ? solution.tiers
                      .map((tier) => labels.tier(tier.tierCode))
                      .join(" | ")
                  : t("summary.noTiers"),
              ],
            },
            {
              id: "subscriptions",
              help: t("summary.subscriptionsHelp"),
              label: t("summary.subscriptions"),
              value: formatNumber(solution.subscriptionCount),
              tags: [
                t("summary.tenantsTag", { count: solution.activeTenantCount }),
              ],
            },
            {
              id: "revenue",
              help: t("summary.revenueHelp"),
              label: t("summary.revenue"),
              value: formatMoney(solution.monthlyRevenue),
              tags: [t("summary.revenueTag")],
            },
          ]}
        />
      }
    />
  );
}

// ─── 详情分区 ──────────────────────────────────────────────────────────────

function ProductSolutionDetails({
  solution,
  busy,
  onEditProducts,
  onBindTier,
  onUnbindTier,
}: {
  solution: ProductSolutionDetailRecord;
  busy: boolean;
  onEditProducts: () => void;
  onBindTier: (tier: ProductSolutionTierCode) => void;
  onUnbindTier: (tier: ProductSolutionTier) => Promise<void>;
}) {
  const t = useTranslations("productSolutionDetailPage");
  const tShared = useTranslations();
  const labels = useSolutionLabels();
  const locale = useLocale();
  const withLabels = useConfirmLabels();
  const tierByCode = useMemo(
    () => new Map(solution.tiers.map((tier) => [tier.tierCode, tier])),
    [solution.tiers],
  );

  function tierActions(
    tierCode: ProductSolutionTierCode,
    bound: ProductSolutionTier | undefined,
  ): ActionMenuItem[] {
    if (!bound) {
      return [
        {
          id: "bind",
          label: t("tiers.bind"),
          icon: "plus",
          disabled: busy,
          onSelect: () => onBindTier(tierCode),
        },
      ];
    }
    return [
      {
        id: "details",
        label: tShared("actions.viewDetail"),
        icon: "arrow-right",
        onSelect: () => {
          window.location.assign(
            `/service-plans/${encodeURIComponent(solution.solutionCode)}/${encodeURIComponent(tierCode)}`,
          );
        },
      },
      {
        id: "rebind",
        label: t("tiers.rebind"),
        icon: "edit",
        disabled: busy,
        onSelect: () => onBindTier(tierCode),
      },
      {
        id: "unbind",
        label: t("tiers.unbind"),
        icon: "x",
        danger: true,
        disabled: busy,
        separatorBefore: true,
        confirm: withLabels({
          verb: t("tiers.unbind"),
          target: t("tiers.unbindTarget", {
            tier: labels.tier(tierCode),
            plan: bound.tierName,
          }),
          consequence: t("tiers.unbindConsequence"),
          onConfirm: () => onUnbindTier(bound),
        }),
      },
    ];
  }

  return (
    <section className="grid min-w-0 gap-xl" aria-label={solution.solutionName}>
      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading icon="database" title={t("sections.basics")} />
        <DetailList columns={3}>
          <DetailRow label={t("fields.solutionCode")}>
            {orUnset(solution.solutionCode)}
          </DetailRow>
          <DetailRow label={t("fields.solutionName")}>
            {orUnset(solution.solutionName)}
          </DetailRow>
          <DetailRow label={t("fields.status")}>
            {labels.status(solution.status)}
          </DetailRow>
          <DetailRow label={t("fields.visibility")}>
            {labels.visibility(solution.visibility)}
          </DetailRow>
          <DetailRow label={t("fields.ownerTeam")}>
            {orUnset(solution.ownerTeam)}
          </DetailRow>
          <DetailRow label={t("fields.createdAt")}>
            {orUnset(formatDate(solution.createdAt, locale))}
          </DetailRow>
          <DetailRow label={tShared("columns.updatedAt")}>
            {orUnset(formatDate(solution.updatedAt, locale))}
          </DetailRow>
        </DetailList>
      </section>

      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading icon="map-pin" title={t("sections.scope")} />
        <DetailList columns={3}>
          <DetailRow label={t("fields.industry")}>
            {orUnset(solution.industry)}
          </DetailRow>
          <DetailRow label={t("fields.scenario")}>
            {orUnset(solution.scenario)}
          </DetailRow>
          <DetailRow label={t("fields.customerSegment")}>
            {orUnset(solution.customerSegment)}
          </DetailRow>
          <DetailRow label={t("fields.deliveryMode")}>
            {orUnset(solution.deliveryMode)}
          </DetailRow>
        </DetailList>
        {solution.description ? (
          <div className="grid min-w-0 gap-xs">
            <strong className="text-body-md leading-relaxed font-semibold text-foreground">
              {solution.description}
            </strong>
          </div>
        ) : null}
        {solution.tags.length ? (
          <div className="flex min-w-0 flex-wrap items-center gap-xs">
            {solution.tags.map((tag) => (
              <StatusBadge key={tag} tone="neutral" icon={false}>
                {tag}
              </StatusBadge>
            ))}
          </div>
        ) : null}
      </section>

      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading
          icon="cube"
          title={t("sections.products")}
          action={
            <ActionButton
              variant="outline"
              icon="edit"
              disabled={busy}
              onClick={onEditProducts}
            >
              {t("products.configure")}
            </ActionButton>
          }
        />
        {solution.products.length ? (
          <PanelList>
            {solution.products.map((product) => (
              <PanelItem
                key={product.productCode}
                className="relative rounded-md transition-colors hover:bg-primary-muted/40"
                lead={
                  <Icon
                    name={capabilityTypeIcon(product.productType)}
                    size="sm"
                    fallback="placeholder"
                  />
                }
                main={
                  <Link
                    href={`/products/${encodeURIComponent(product.productCode)}`}
                    className="no-underline after:absolute after:inset-0 after:content-['']"
                  >
                    <TableTitleCell
                      title={product.productName}
                      description={product.productCode}
                    />
                  </Link>
                }
                trail={
                  <span className="grid justify-items-end gap-2xs">
                    <span className="text-body-md font-semibold text-foreground">
                      {labels.capabilityType(product.productType)} |{" "}
                      {labels.source(product.source)}
                    </span>
                    <span className="truncate text-body-sm text-muted-foreground">
                      {product.role || t("products.noRole")}
                    </span>
                  </span>
                }
              />
            ))}
          </PanelList>
        ) : (
          <EmptyState
            title={t("products.emptyTitle")}
            description={t("products.emptyDescription")}
            action={
              <ActionButton
                icon="plus"
                disabled={busy}
                onClick={onEditProducts}
              >
                {t("products.configure")}
              </ActionButton>
            }
          />
        )}
      </section>

      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading
          icon="shield-check"
          title={t("sections.boundaries")}
        />
        {solution.deliveryBoundaries.length ? (
          <PanelList>
            {solution.deliveryBoundaries.map((item) => (
              <PanelItem
                key={item}
                lead={<Icon name="check" size="xs" fallback="placeholder" />}
                main={
                  <span className="text-body-sm text-foreground">{item}</span>
                }
              />
            ))}
          </PanelList>
        ) : (
          <p className="m-0 text-body-sm text-muted-foreground">
            {t("boundaries.empty")}
          </p>
        )}
      </section>

      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading
          icon="star"
          title={t("sections.tiers")}
          description={t("tiers.description")}
        />
        <PanelList>
          {TIERS.map((tierCode) => {
            const bound = tierByCode.get(tierCode);
            return (
              <PanelItem
                key={tierCode}
                className="rounded-md transition-colors hover:bg-primary-muted/40"
                lead={<Icon name="star" size="sm" fallback="placeholder" />}
                main={
                  <TableTitleCell
                    title={
                      <span className="inline-flex items-center gap-xs">
                        <Badge className={tierBadgeClass(tierCode)}>
                          {labels.tier(tierCode)}
                        </Badge>
                        {bound ? bound.tierName : t("tiers.unbound")}
                      </span>
                    }
                    description={
                      bound ? bound.planCode : t("tiers.unboundHint")
                    }
                  />
                }
                trail={
                  <span className="flex items-center gap-md">
                    {bound ? (
                      <>
                        <StatusBadge tone={SOLUTION_STATUS_TONE[bound.status]}>
                          {labels.status(bound.status)}
                        </StatusBadge>
                        <span className="grid max-w-panel-sm gap-2xs text-right">
                          <span className="truncate text-body-md font-semibold text-foreground">
                            {bound.priceLabel}
                          </span>
                          <span
                            title={bound.summary}
                            className="truncate text-body-sm text-muted-foreground"
                          >
                            {bound.summary || labels.priceKind(bound.priceKind)}
                          </span>
                        </span>
                      </>
                    ) : null}
                    <div
                      className="relative z-[1] inline-flex justify-self-end"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <ActionMenu
                        label={t("tiers.menuLabel", {
                          tier: labels.tier(tierCode),
                        })}
                        items={tierActions(tierCode, bound)}
                      />
                    </div>
                  </span>
                }
              />
            );
          })}
        </PanelList>
      </section>
    </section>
  );
}

// ─── 页面 ──────────────────────────────────────────────────────────────────

export function ProductSolutionDetailPage({
  solutionCode,
}: {
  solutionCode: string;
}) {
  const t = useTranslations("productSolutionDetailPage");
  const tShared = useTranslations();
  const labels = useSolutionLabels();
  const { toast } = useToast();
  /* 方案写操作走 step-up（与套餐版本发布同一风险级，70-product-solutions.md §7）。 */
  const { runWithStepUp } = useStepUp();
  const withLabels = useConfirmLabels();
  const [solution, setSolution] = useState<ProductSolutionDetailRecord | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [catalog, setCatalog] = useState<ProductCapabilityRecord[] | null>(
    null,
  );
  const [picks, setPicks] = useState<ProductPick[]>([]);
  const [plans, setPlans] = useState<ProductPlanRecord[] | null>(null);
  const [planPick, setPlanPick] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);

    fetchProductSolution(solutionCode)
      .then((record) => {
        if (!active) return;
        setSolution(record);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [solutionCode]);

  function openEdit() {
    if (!solution) return;
    setEditForm(formFromSolution(solution));
    setDialogError(null);
    setDialog({ kind: "edit" });
  }

  async function openProducts() {
    if (!solution) return;
    setDialogError(null);
    setDialog({ kind: "products" });
    if (!catalog) {
      const records = await fetchProductCapabilities();
      setCatalog(records);
    }
    const roleByCode = new Map(
      solution.products.map((item) => [item.productCode, item.role]),
    );
    const included = new Set(solution.products.map((item) => item.productCode));
    // 已选的按方案里的顺序排前面，其余按目录顺序；勾选顺序就是提交的 sort。
    const ordered = [
      ...solution.products.map((item) => item.productCode),
      ...(catalog ?? (await fetchProductCapabilities()))
        .map((item) => item.productCode)
        .filter((code) => !included.has(code)),
    ];
    setPicks(
      Array.from(new Set(ordered)).map((productCode) => ({
        productCode,
        included: included.has(productCode),
        role: roleByCode.get(productCode) ?? "",
      })),
    );
  }

  async function openBind(tier: ProductSolutionTierCode) {
    if (!solution) return;
    const current =
      solution.tiers.find((item) => item.tierCode === tier) ?? null;
    setPlanPick(current?.planId ?? "");
    setDialogError(null);
    setDialog({ kind: "bind", tier, current });
    if (!plans) {
      setPlans(await fetchProductPlans());
    }
  }

  function closeDialog() {
    setDialog(null);
    setDialogError(null);
  }

  function applyUpdated(updated: ProductSolutionDetailRecord, title: string) {
    setSolution(updated);
    toast({ tone: "success", title });
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!solution || !editForm || !editForm.solutionName.trim()) return;
    setSubmitting(true);
    setDialogError(null);
    try {
      const updated = await runWithStepUp(() =>
        updateProductSolution(
          solution.solutionCode,
          buildEditPayload(editForm),
        ),
      );
      applyUpdated(updated, t("feedback.updated"));
      closeDialog();
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      setDialogError(errorMessage(error) ?? t("feedback.updateFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitProducts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!solution) return;
    setSubmitting(true);
    setDialogError(null);
    try {
      const updated = await runWithStepUp(() =>
        replaceProductSolutionProducts(
          solution.solutionCode,
          picks
            .filter((pick) => pick.included)
            .map((pick, index) => ({
              productCode: pick.productCode,
              role: pick.role.trim() || null,
              sort: index,
            })),
        ),
      );
      applyUpdated(updated, t("feedback.productsSaved"));
      closeDialog();
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      setDialogError(errorMessage(error) ?? t("feedback.productsFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitBind(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!solution || dialog?.kind !== "bind" || !planPick) return;
    setSubmitting(true);
    setDialogError(null);
    try {
      const updated = await runWithStepUp(() =>
        bindProductSolutionPlan(solution.solutionCode, dialog.tier, {
          planId: planPick,
        }),
      );
      applyUpdated(
        updated,
        t("feedback.bound", { tier: labels.tier(dialog.tier) }),
      );
      closeDialog();
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      setDialogError(errorMessage(error) ?? t("feedback.bindFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function unbind(tier: ProductSolutionTier) {
    if (!solution) return;
    setBusy(true);
    try {
      const updated = await runWithStepUp(() =>
        unbindProductSolutionPlan(solution.solutionCode, tier.tierCode),
      );
      applyUpdated(
        updated,
        t("feedback.unbound", { tier: labels.tier(tier.tierCode) }),
      );
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      toast({
        tone: "danger",
        title: t("feedback.unbindFailed"),
        ...describeError(error),
      });
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function transition(next: ProductSolutionStatus) {
    if (!solution) return;
    setBusy(true);
    try {
      const updated = await runWithStepUp(() =>
        setProductSolutionState(solution.solutionCode, next),
      );
      applyUpdated(
        updated,
        t("feedback.stateChanged", { state: labels.status(updated.status) }),
      );
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      toast({
        tone: "danger",
        title: t("feedback.stateFailed"),
        ...describeError(error),
      });
      throw error;
    } finally {
      setBusy(false);
    }
  }

  const stateActions: ActionMenuItem[] = solution
    ? SOLUTION_STATE_TRANSITIONS[solution.status].map((next) =>
        next === "deprecated"
          ? {
              id: "deprecate",
              label: labels.transition("deprecated"),
              icon: "trash",
              danger: true,
              disabled: busy,
              separatorBefore: true,
              confirm: withLabels({
                verb: labels.transition("deprecated"),
                target: t("confirm.target", { name: solution.solutionName }),
                consequence: t("confirm.deprecateConsequence"),
                onConfirm: () => transition("deprecated"),
              }),
            }
          : {
              id: `to-${next}`,
              label: labels.transition(next),
              icon: next === "active" ? "check" : "x",
              disabled: busy,
              onSelect: () => void transition(next).catch(() => {}),
            },
      )
    : [];

  if (!loading && !solution) {
    return (
      <DetailPageTemplate
        className="min-w-0"
        header={
          <PageHeader
            icon="workflow"
            title={t("header.fallbackTitle")}
            description={t("header.notFoundDescription")}
            action={
              <Button asChild variant="outline">
                <Link href="/product-solutions">
                  <Icon name="arrow-left" size="xs" fallback="placeholder" />
                  {tShared("actions.backToList")}
                </Link>
              </Button>
            }
          />
        }
      >
        <EmptyState
          title={t("empty.notFoundTitle")}
          description={t("empty.notFoundDescription")}
        />
      </DetailPageTemplate>
    );
  }

  const availablePlans = (plans ?? []).filter((plan) => {
    // 已绑在本方案别的档位上的 plan 不再列出；绑在别的方案上的由 BFF 拒绝（409）。
    const boundElsewhereHere = solution?.tiers.some(
      (tier) =>
        tier.planId === plan.id &&
        (dialog?.kind !== "bind" || tier.tierCode !== dialog.tier),
    );
    return !boundElsewhereHere;
  });

  return (
    <DetailPageTemplate
      className="min-w-0"
      header={
        <PageHeader
          icon="workflow"
          title={solution?.solutionName ?? t("header.fallbackTitle")}
          description={solution?.description || t("header.loadingDescription")}
          action={
            <div className="inline-flex flex-wrap items-center justify-end gap-sm">
              <Button asChild variant="outline">
                <Link href="/product-solutions">
                  <Icon name="arrow-left" size="xs" fallback="placeholder" />
                  {tShared("actions.backToList")}
                </Link>
              </Button>
              {solution ? (
                <>
                  <Button variant="outline" disabled={busy} onClick={openEdit}>
                    <Icon name="edit" size="xs" fallback="placeholder" />
                    {t("actions.edit")}
                  </Button>
                  {stateActions.length ? (
                    <ActionMenu
                      label={t("actions.stateMenu")}
                      items={stateActions}
                    />
                  ) : null}
                </>
              ) : null}
            </div>
          }
        />
      }
    >
      {solution ? (
        <>
          <ProductSolutionSummary solution={solution} />
          <ProductSolutionDetails
            solution={solution}
            busy={busy}
            onEditProducts={() => void openProducts()}
            onBindTier={(tier) => void openBind(tier)}
            onUnbindTier={unbind}
          />
        </>
      ) : (
        <section className="flex min-h-0 items-center justify-end gap-sm text-body-sm font-normal text-muted-foreground">
          <span>{tShared("common.loading")}</span>
        </section>
      )}

      {dialog?.kind === "edit" && editForm ? (
        <DialogForm
          open
          size="xl"
          title={t("editDialog.title")}
          description={t("editDialog.description")}
          submitLabel={t("editDialog.submit")}
          cancelLabel={tShared("actions.cancel")}
          submitting={submitting}
          submitDisabled={!editForm.solutionName.trim()}
          onOpenChange={(open) => {
            if (!open) closeDialog();
          }}
          onSubmit={(event) => void submitEdit(event)}
        >
          {dialogError ? <Banner tone="danger" title={dialogError} /> : null}
          {/* 字段一律竖排(标签在上)——同创建页,避免 <Label> 嵌控件在窄格里
              把中文标签逐字竖排。 */}
          <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
            <div className="flex flex-col gap-xs">
              <Label>
                {t("fields.solutionName")}
                <span className="text-destructive-text"> *</span>
              </Label>
              <Input
                value={editForm.solutionName}
                maxLength={128}
                onChange={(event) =>
                  setEditForm((old) =>
                    old ? { ...old, solutionName: event.target.value } : old,
                  )
                }
                required
              />
            </div>
            <div className="flex flex-col gap-xs">
              <Label>{t("fields.ownerTeam")}</Label>
              <Input
                value={editForm.ownerTeam}
                maxLength={128}
                onChange={(event) =>
                  setEditForm((old) =>
                    old ? { ...old, ownerTeam: event.target.value } : old,
                  )
                }
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
            <div className="flex flex-col gap-xs">
              <Label>{t("fields.industry")}</Label>
              <Input
                value={editForm.industry}
                maxLength={128}
                onChange={(event) =>
                  setEditForm((old) =>
                    old ? { ...old, industry: event.target.value } : old,
                  )
                }
              />
            </div>
            <div className="flex flex-col gap-xs">
              <Label>{t("editDialog.tags")}</Label>
              <Input
                value={editForm.tags}
                placeholder={t("editDialog.tagsPlaceholder")}
                onChange={(event) =>
                  setEditForm((old) =>
                    old ? { ...old, tags: event.target.value } : old,
                  )
                }
              />
            </div>
          </div>
          <div className="flex flex-col gap-xs">
            <Label>{t("fields.scenario")}</Label>
            <Textarea
              value={editForm.scenario}
              rows={2}
              maxLength={128}
              onChange={(event) =>
                setEditForm((old) =>
                  old ? { ...old, scenario: event.target.value } : old,
                )
              }
            />
          </div>
          <div className="flex flex-col gap-xs">
            <Label>{t("fields.customerSegment")}</Label>
            <Textarea
              value={editForm.customerSegment}
              rows={2}
              maxLength={255}
              onChange={(event) =>
                setEditForm((old) =>
                  old ? { ...old, customerSegment: event.target.value } : old,
                )
              }
            />
          </div>
          <div className="flex flex-col gap-xs">
            <Label>{t("editDialog.descriptionField")}</Label>
            <Textarea
              value={editForm.description}
              rows={3}
              onChange={(event) =>
                setEditForm((old) =>
                  old ? { ...old, description: event.target.value } : old,
                )
              }
            />
          </div>
          <div className="flex flex-col gap-xs">
            <Label>{t("fields.deliveryMode")}</Label>
            <Textarea
              value={editForm.deliveryMode}
              rows={2}
              maxLength={1000}
              placeholder={t("editDialog.deliveryModePlaceholder")}
              onChange={(event) =>
                setEditForm((old) =>
                  old ? { ...old, deliveryMode: event.target.value } : old,
                )
              }
            />
          </div>
          <div className="flex flex-col gap-xs">
            <Label>{t("editDialog.boundaries")}</Label>
            <Textarea
              value={editForm.deliveryBoundaries}
              rows={4}
              placeholder={t("editDialog.boundariesPlaceholder")}
              onChange={(event) =>
                setEditForm((old) =>
                  old
                    ? { ...old, deliveryBoundaries: event.target.value }
                    : old,
                )
              }
            />
          </div>
          <label className="inline-flex items-center gap-xs text-body-sm text-foreground">
            <Checkbox
              checked={editForm.isPublic}
              onCheckedChange={(checked) =>
                setEditForm((old) =>
                  old ? { ...old, isPublic: checked === true } : old,
                )
              }
            />
            {t("editDialog.isPublic")}
          </label>
        </DialogForm>
      ) : null}

      {dialog?.kind === "products" ? (
        <DialogForm
          open
          title={t("productsDialog.title")}
          description={t("productsDialog.description")}
          submitLabel={t("productsDialog.submit")}
          cancelLabel={tShared("actions.cancel")}
          submitting={submitting}
          submitDisabled={catalog === null}
          onOpenChange={(open) => {
            if (!open) closeDialog();
          }}
          onSubmit={(event) => void submitProducts(event)}
        >
          {dialogError ? <Banner tone="danger" title={dialogError} /> : null}
          {catalog === null ? (
            <p className="m-0 text-body-sm text-muted-foreground">
              {tShared("common.loading")}
            </p>
          ) : catalog.length === 0 ? (
            <EmptyState
              title={t("productsDialog.emptyTitle")}
              description={t("productsDialog.emptyDescription")}
            />
          ) : (
            <PanelList>
              {picks.map((pick) => {
                const product = catalog.find(
                  (item) => item.productCode === pick.productCode,
                );
                if (!product) return null;
                return (
                  <PanelItem
                    key={pick.productCode}
                    lead={
                      <Checkbox
                        checked={pick.included}
                        aria-label={product.productName}
                        onCheckedChange={(checked) =>
                          setPicks((old) =>
                            old.map((item) =>
                              item.productCode === pick.productCode
                                ? { ...item, included: checked === true }
                                : item,
                            ),
                          )
                        }
                      />
                    }
                    main={
                      <TableTitleCell
                        title={product.productName}
                        description={`${product.productCode} · ${labels.capabilityType(product.productType)} | ${labels.source(product.source)}`}
                      />
                    }
                    trail={
                      <Input
                        value={pick.role}
                        disabled={!pick.included}
                        maxLength={128}
                        placeholder={t("productsDialog.rolePlaceholder")}
                        aria-label={t("productsDialog.roleLabel", {
                          name: product.productName,
                        })}
                        onChange={(event) =>
                          setPicks((old) =>
                            old.map((item) =>
                              item.productCode === pick.productCode
                                ? { ...item, role: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    }
                  />
                );
              })}
            </PanelList>
          )}
        </DialogForm>
      ) : null}

      {dialog?.kind === "bind" ? (
        <DialogForm
          open
          title={t("bindDialog.title", { tier: labels.tier(dialog.tier) })}
          description={t("bindDialog.description")}
          submitLabel={t("bindDialog.submit")}
          cancelLabel={tShared("actions.cancel")}
          submitting={submitting}
          submitDisabled={!planPick || plans === null}
          onOpenChange={(open) => {
            if (!open) closeDialog();
          }}
          onSubmit={(event) => void submitBind(event)}
        >
          {dialogError ? <Banner tone="danger" title={dialogError} /> : null}
          {dialog.current ? (
            <Banner
              tone="info"
              title={t("bindDialog.currentHint", {
                plan: dialog.current.tierName,
                code: dialog.current.planCode,
              })}
            />
          ) : null}
          <Label>
            {t("bindDialog.plan")}
            <span className="text-destructive-text"> *</span>
            <NativeSelect
              value={planPick}
              disabled={plans === null}
              onChange={(event) => setPlanPick(event.target.value)}
              required
            >
              <option value="">
                {plans === null
                  ? tShared("common.loading")
                  : t("bindDialog.planPlaceholder")}
              </option>
              {availablePlans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.planName} · {plan.planCode}
                  {plan.isActive ? "" : ` · ${labels.status("inactive")}`}
                </option>
              ))}
            </NativeSelect>
          </Label>
          <p className="m-0 text-body-sm text-muted-foreground">
            {t("bindDialog.hint")}
          </p>
        </DialogForm>
      ) : null}
    </DetailPageTemplate>
  );
}
