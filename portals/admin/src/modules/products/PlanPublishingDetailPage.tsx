"use client";

/**
 * PlanPublishingDetailPage.tsx —— 某个产品的套餐（二级页，只读 + 生命周期动作）。
 *
 * @package  @vxture/admin
 * @layer    Presentation
 * @category module
 *
 * ── 存储两态，呈现四态 ────────────────────────────────────────────────────
 * `plan_versions.status` 的值域只有 `draft` 与 `published`，而且是**有意**只有两个：
 * 被新版取代的旧版仍是 published，因为钉在它上面的订阅还要照常解析；「当前在售」
 * 交给 `plans.current_version_id` 这个指针，不另立第三个状态。
 *
 * 但一个「不是当前」的已发布版本还有两种截然不同的处境：**它还在给人算钱**，和
 * **它谁都没碰过**。两者的处置完全相反，所以这一屏把它们分开呈现：
 *
 *   draft                                   → 草稿
 *   isCurrent                               → 当前在售
 *   published · 非当前 · subscriptionCount>0 → 仍在服务（绝不可删）
 *   published · 非当前 · subscriptionCount=0 → 已停用
 *
 * 四个标签**一个新字段都不用加**：判据本来就在库里，`is_current` 早就在算，剩下
 * 的是「这个版本有几个订阅」，那本来就得现算。加第三个存储态的代价写在
 * `90-plan-publishing.md`——会让「谁在售」同时由指针和状态两处回答。
 *
 * ── 历史版本折叠，不删 ────────────────────────────────────────────────────
 * 默认只展开**当前版本 + 有订阅的版本 + 草稿**，其余收进「展开历史版本」。
 * 一个从未售出的历史版本，只要它所属的套餐还在卖，它就不是垃圾——它是「这一档
 * 曾经定过什么价」的证据。视觉噪音用呈现解决，别动数据。
 *
 * ── 「可清理」是判据的投影，不是开关 ──────────────────────────────────────
 * 它由 `GET /plans/:planId/deletable` 的三条查询推导（无在订阅、无订阅历史、无订单
 * 引用）。**按钮只在判据成立时才渲染**，而不是让人点下去才被 409 拒绝。
 *
 * ── 两道门，不是一道 ──────────────────────────────────────────────────────
 * 危险动作 = `DestructiveButton` 的确认框（意图）**＋** `runWithStepUp`（身份）。
 * step-up 凭据在有效期内会被复用，拿它兼任确认，第二次起就会一声不响地执行。
 *
 * @author AI-Generated
 * @date 2026-09-18
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import {
  Badge,
  Button,
  DataTable,
  DestructiveButton,
  DetailPageTemplate,
  EmptyState,
  ListCardGrid,
  PanelCard,
  PanelItem,
  PanelList,
  Section,
  StatusBadge,
} from "@vxture/design-system";
import type { DataTableColumn, StatusBadgeTone } from "@vxture/design-system";
import {
  deletePlan,
  deletePlanVersion,
  deprecatePlan,
  fetchPlanDeletable,
  fetchPlanMatrix,
  fetchPlanVersions,
  type PlanDeletionImpact,
  type PlanMatrixPlan,
  type PlanMatrixProduct,
  type PlanVersionSummary,
} from "@/api/admin-bff";
import { PageHeader } from "@/modules/shared/PageHeader";
import { useConfirmLabels } from "@/modules/shared/destructive";
import { useTableLabels } from "@/modules/shared/table";
import { tierBadgeClass, tierLabel } from "@/modules/shared/tier-level";
import { formatDate, formatNumber } from "@/modules/tenants/tenant-utils";
import { isStepUpCancelled, useStepUp } from "@/providers/StepUpProvider";

type VersionState = "draft" | "current" | "serving" | "retiredVersion";

/** 四态判据。库里只有前两格的依据，后两格靠订阅数现算。 */
function versionState(version: PlanVersionSummary): VersionState {
  if (version.status === "draft") return "draft";
  if (version.isCurrent) return "current";
  return version.subscriptionCount > 0 ? "serving" : "retiredVersion";
}

const VERSION_STATE_TONE: Record<VersionState, StatusBadgeTone> = {
  draft: "warning",
  current: "success",
  serving: "brand",
  retiredVersion: "neutral",
};

/** 默认就展开的版本：当前、有订阅的、以及草稿——其余收进历史。 */
function isAlwaysVisible(version: PlanVersionSummary): boolean {
  const state = versionState(version);
  return state !== "retiredVersion";
}

function priceLine(
  prices: { cycleUnit: string; price: string }[],
  monthLabel: string,
  yearLabel: string,
  noneLabel: string,
): string {
  if (prices.length === 0) return noneLabel;
  return prices
    .map((p) => {
      const cycle =
        p.cycleUnit === "month"
          ? monthLabel
          : p.cycleUnit === "year"
            ? yearLabel
            : p.cycleUnit;
      return `¥${Number(p.price).toFixed(2)}/${cycle}`;
    })
    .join(" · ");
}

function editorHref(planId: string, versionId?: string): string {
  const query = versionId
    ? `?plan=${encodeURIComponent(planId)}&version=${encodeURIComponent(versionId)}`
    : `?plan=${encodeURIComponent(planId)}`;
  return `/plan-versions/editor${query}`;
}

export function PlanPublishingDetailPage({
  productCode,
}: {
  productCode: string;
}) {
  const t = useTranslations("planVersionsPage");
  const locale = useLocale();
  const tableLabels = useTableLabels();
  const withLabels = useConfirmLabels();
  const { runWithStepUp } = useStepUp();

  const [product, setProduct] = useState<PlanMatrixProduct | null>(null);
  const [versionsByPlan, setVersionsByPlan] = useState<
    Record<string, PlanVersionSummary[]>
  >({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [retiredOpen, setRetiredOpen] = useState(false);
  const [deletableByPlan, setDeletableByPlan] = useState<
    Record<string, PlanDeletionImpact>
  >({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 带出已退役：这一屏的「已退役」分区正是要展示它们，而一级列表默认收起。
      const all = await fetchPlanMatrix(true);
      const found =
        all.find((item) => item.productCode === productCode) ?? null;
      setProduct(found);
      if (found) {
        const entries = await Promise.all(
          found.plans.map(
            async (plan) =>
              [plan.planId, await fetchPlanVersions(plan.planId)] as const,
          ),
        );
        setVersionsByPlan(Object.fromEntries(entries));
      }
    } finally {
      setLoading(false);
    }
  }, [productCode]);

  useEffect(() => {
    void load();
  }, [load]);

  const activePlans = useMemo(
    () => (product?.plans ?? []).filter((p) => p.planStatus !== "deprecated"),
    [product],
  );
  const retiredPlans = useMemo(
    () => (product?.plans ?? []).filter((p) => p.planStatus === "deprecated"),
    [product],
  );

  // 可删性预检只在展开「已退役」时才发——它是每个套餐一次查询，列表默认收起时
  // 没人看得见，提前发等于白花往返。
  useEffect(() => {
    if (!retiredOpen || retiredPlans.length === 0) return;
    let cancelled = false;
    void (async () => {
      const results = await Promise.all(
        retiredPlans.map(async (plan) => {
          try {
            return [
              plan.planId,
              await fetchPlanDeletable(plan.planId),
            ] as const;
          } catch {
            // 读不到就不给「可清理」——判据看不见时**不放行**，而不是当作成立。
            return [plan.planId, null] as const;
          }
        }),
      );
      if (cancelled) return;
      const next: Record<string, PlanDeletionImpact> = {};
      for (const [planId, impact] of results) {
        if (impact) next[planId] = impact;
      }
      setDeletableByPlan(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [retiredOpen, retiredPlans]);

  const runWrite = useCallback(
    async (action: () => Promise<unknown>, done: string) => {
      setBusy(true);
      setMessage(null);
      try {
        await runWithStepUp(action);
        setMessage(done);
        await load();
      } catch (err) {
        if (isStepUpCancelled(err)) return;
        setMessage(err instanceof Error ? err.message : t("actions.failed"));
      } finally {
        setBusy(false);
      }
    },
    [load, runWithStepUp, t],
  );

  const versionColumns = useCallback(
    (plan: PlanMatrixPlan): DataTableColumn<PlanVersionSummary>[] => [
      {
        id: "version",
        header: t("list.versions"),
        cell: (version) => <strong>v{version.versionNo}</strong>,
      },
      {
        id: "state",
        header: t("list.status"),
        align: "center",
        cell: (version) => {
          const state = versionState(version);
          return (
            <StatusBadge tone={VERSION_STATE_TONE[state]}>
              {t(`lifecycle.${state}`)}
            </StatusBadge>
          );
        },
      },
      {
        id: "price",
        header: t("price.month"),
        cell: (version) =>
          priceLine(
            version.prices,
            t("price.month"),
            t("price.year"),
            t("price.none"),
          ),
      },
      {
        id: "subs",
        header: t("list.subscriptions"),
        align: "center",
        // 0 与「从未售出」要分开：现在为 0 但卖过，和从头没卖过，处置完全不同。
        cell: (version) =>
          version.subscriptionCount > 0
            ? t("lifecycle.subscribed", {
                n: formatNumber(version.subscriptionCount),
              })
            : t("lifecycle.neverSold"),
      },
      {
        id: "created",
        header: t("retired.versions"),
        cell: (version) => formatDate(version.createdAt, locale),
      },
      {
        id: "go",
        header: "",
        align: "center",
        cell: (version) => (
          <Button variant="outline" size="sm" asChild>
            <Link href={editorHref(plan.planId, version.id)}>
              {t("list.enter")}
            </Link>
          </Button>
        ),
      },
    ],
    [locale, t],
  );

  const header = (
    <PageHeader
      icon="table"
      title={product ? product.productName : productCode}
      description={t("lifecycle.note")}
      action={
        <Button variant="outline" size="sm" asChild>
          <Link href="/plan-versions">{t("title")}</Link>
        </Button>
      }
    />
  );

  if (!loading && !product) {
    return (
      <DetailPageTemplate className="min-w-0" header={header}>
        <EmptyState
          title={t("list.empty")}
          description={t("list.loadFailed")}
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

      {/* ── 档位区：挂了的档各一张卡，没挂的不占位 ─────────────────────── */}
      <Section
        aria-label={t("list.sellingTiers")}
        level={2}
        icon="cube"
        title={t("list.sellingTiers")}
        description={t("stats.sellingProductsHelp")}
      >
        {activePlans.length === 0 ? (
          <EmptyState title={t("list.statusNone")} />
        ) : (
          <ListCardGrid>
            {activePlans.map((plan) => {
              const versions = versionsByPlan[plan.planId] ?? [];
              const draft = versions.find(
                (v) => v.status === "draft" && !v.isLocked,
              );
              return (
                <PanelCard
                  key={plan.planId}
                  title={tierLabel(plan.tier)}
                  titleSuffix={
                    <span className="inline-flex flex-wrap items-center gap-2xs">
                      <Badge
                        variant="outline"
                        className={tierBadgeClass(plan.tier)}
                      >
                        {plan.planCode}
                      </Badge>
                      {plan.currentVersion ? (
                        <StatusBadge tone="success">
                          {`v${plan.currentVersion.versionNo} · ${t("lifecycle.current")}`}
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">
                          {t("list.statusNone")}
                        </StatusBadge>
                      )}
                      {draft ? (
                        <StatusBadge tone="warning">
                          {t("matrix.draftShort", { n: draft.versionNo })}
                        </StatusBadge>
                      ) : null}
                    </span>
                  }
                  action={
                    <span className="inline-flex flex-wrap items-center gap-2xs">
                      {draft ? (
                        <Button variant="secondary" size="sm" asChild>
                          <Link href={editorHref(plan.planId, draft.id)}>
                            {t("timeline.openDraft")}
                          </Link>
                        </Button>
                      ) : null}
                      {/* 退役是套餐级动作：整档不卖了，版本跟着走。 */}
                      <DestructiveButton
                        size="sm"
                        icon="stop"
                        disabled={busy}
                        confirm={withLabels({
                          verb: t("actions.deprecateVerb"),
                          target: t("actions.deprecateTarget", {
                            name: plan.planName,
                          }),
                          consequence: t("actions.deprecateConsequence"),
                          onConfirm: () =>
                            runWrite(
                              () => deprecatePlan(plan.planId),
                              t("actions.deprecateDone", {
                                name: plan.planName,
                              }),
                            ),
                        })}
                      >
                        {t("actions.deprecate")}
                      </DestructiveButton>
                    </span>
                  }
                >
                  <PanelList>
                    <PanelItem
                      main={t("price.month")}
                      trail={priceLine(
                        plan.currentVersion?.prices ?? [],
                        t("price.month"),
                        t("price.year"),
                        t("price.none"),
                      )}
                    />
                    <PanelItem
                      main={t("list.subscriptions")}
                      trail={formatNumber(plan.subscriptionCount)}
                    />
                    <PanelItem
                      main={t("list.versions")}
                      trail={formatNumber(plan.versionCount)}
                    />
                  </PanelList>
                </PanelCard>
              );
            })}
          </ListCardGrid>
        )}
      </Section>

      {/* ── 版本史：每档一张表，四态现算，历史默认折叠 ─────────────────── */}
      {activePlans.map((plan) => {
        const versions = versionsByPlan[plan.planId] ?? [];
        const ordered = [...versions].reverse();
        const hidden = ordered.filter((v) => !isAlwaysVisible(v));
        const open = expanded[plan.planId] ?? false;
        const shown = open ? ordered : ordered.filter(isAlwaysVisible);
        return (
          <Section
            key={`history-${plan.planId}`}
            aria-label={`${plan.planName} ${t("timeline.heading", { name: plan.planName, code: plan.planCode })}`}
            level={3}
            icon="clock"
            title={`${tierLabel(plan.tier)} · ${plan.planName}`}
            description={plan.planCode}
            action={
              hidden.length > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setExpanded((prev) => ({
                      ...prev,
                      [plan.planId]: !open,
                    }))
                  }
                >
                  {open
                    ? t("retired.collapse")
                    : `${t("retired.expand")} · ${formatNumber(hidden.length)}`}
                </Button>
              ) : null
            }
          >
            <DataTable
              labels={tableLabels}
              columns={versionColumns(plan)}
              rows={shown}
              rowKey={(version) => version.id}
              loading={loading}
              rowActions={(version) =>
                version.status === "draft" && !version.isLocked ? (
                  <DestructiveButton
                    size="sm"
                    icon="trash"
                    disabled={busy}
                    confirm={withLabels({
                      verb: t("actions.deleteDraftVerb"),
                      target: t("actions.deleteDraftTarget", {
                        n: version.versionNo,
                      }),
                      consequence: t("actions.deleteDraftConsequence"),
                      onConfirm: () =>
                        runWrite(
                          () => deletePlanVersion(version.id),
                          t("actions.deleteDraftDone", {
                            n: version.versionNo,
                          }),
                        ),
                    })}
                  >
                    {t("actions.deleteDraft")}
                  </DestructiveButton>
                ) : null
              }
              empty={<EmptyState title={t("timeline.none")} />}
            />
          </Section>
        );
      })}

      {/* ── 已退役：默认收起，不是消失 ─────────────────────────────────── */}
      <Section
        aria-label={t("retired.title")}
        level={2}
        icon="stop"
        title={t("retired.title")}
        description={t("retired.description")}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRetiredOpen((on) => !on)}
          >
            {`${retiredOpen ? t("retired.collapse") : t("retired.expand")} · ${t(
              "retired.count",
              { n: formatNumber(retiredPlans.length) },
            )}`}
          </Button>
        }
      >
        {!retiredOpen ? null : retiredPlans.length === 0 ? (
          <EmptyState title={t("retired.empty")} />
        ) : (
          <PanelList>
            {retiredPlans.map((plan) => {
              const impact = deletableByPlan[plan.planId];
              return (
                <PanelItem
                  key={plan.planId}
                  main={
                    <span className="inline-flex flex-wrap items-center gap-2xs">
                      <Badge
                        variant="outline"
                        className={tierBadgeClass(plan.tier)}
                      >
                        {tierLabel(plan.tier)}
                      </Badge>
                      <span>{plan.planName}</span>
                      <span className="text-body-sm text-muted-foreground">
                        {plan.planCode}
                      </span>
                    </span>
                  }
                  trail={
                    <span className="inline-flex flex-wrap items-center justify-end gap-2xs">
                      <span className="text-body-sm text-muted-foreground">
                        {impact && impact.subscriptions > 0
                          ? t("retired.hadSubs", {
                              n: formatNumber(impact.subscriptions),
                            })
                          : t("lifecycle.neverSold")}
                      </span>
                      {/* 判据成立才出按钮；不成立就明说「保留」，不给一个点下去会被拒的钮。 */}
                      {impact?.deletable ? (
                        <DestructiveButton
                          size="sm"
                          icon="trash"
                          disabled={busy}
                          confirm={withLabels({
                            verb: t("actions.softDeleteVerb"),
                            target: t("actions.softDeleteTarget", {
                              name: plan.planName,
                            }),
                            consequence: t("actions.softDeleteConsequence"),
                            onConfirm: () =>
                              runWrite(
                                () => deletePlan(plan.planId),
                                t("actions.softDeleteDone", {
                                  name: plan.planName,
                                }),
                              ),
                          })}
                        >
                          {t("actions.softDelete")}
                        </DestructiveButton>
                      ) : (
                        <StatusBadge tone="neutral">
                          {t("retired.keep")}
                        </StatusBadge>
                      )}
                    </span>
                  }
                />
              );
            })}
          </PanelList>
        )}
      </Section>
    </DetailPageTemplate>
  );
}
