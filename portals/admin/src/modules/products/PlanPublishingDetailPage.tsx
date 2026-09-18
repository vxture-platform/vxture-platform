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
 * ── 卡片的主语是套餐，不是档位（2026-09-18 订正）──────────────────────────
 * 初版把卡片标题写成档位名，于是**同一档挂两条套餐时会渲出两张同名卡**，看起来
 * 像多出一个档位（arda 的 `pro` 档实际挂着 `arda-pro` 与 `arda-beta-trial`）。
 * 库里不禁止同档多套餐——`plan_components.tier` 的唯一键落在版本上，不是产品上。
 * 所以标题回到**套餐名**，档位退为徽标，并对同档多于一条的卡加「同档多套餐」标。
 *
 * ── 动作全进菜单 ──────────────────────────────────────────────────────────
 * 行与卡片的动作一律收进 `ActionMenu`，不外放按钮。初版把长标签按钮塞进
 * `PanelCard` 的 `action` 槽，标题被挤到只剩首字母——头部是一行不换行的布局，
 * 塞不下就压掉别人。危险项用 `danger: true` + `confirm`：件的类型是判别联合，
 * **红色与确认框绑定**，写不出「红了但不问」。分隔线不用手插，件会在末尾那段
 * 连续 danger 项之前自动画一条，所以危险动作排在最后。
 *
 * 「按状态显隐」分两种：**结构上不适用**的项不进数组（已发布版本没有「删除草稿」
 * 这回事）；**此刻做不了**的项保留、置灰并给 `hint` 说明理由——`hint` 的设计用途
 * 就是这个，禁用项不说理由，用户只能猜。
 *
 * ── 「可清理」是判据的投影，不是开关 ──────────────────────────────────────
 * 它由 `GET /plans/:planId/deletable` 的三条查询推导（无在订阅、无订阅历史、无订单
 * 引用）。判据不成立时项是灰的并写明原因；**读不到判据时同样不放行**，而不是当作
 * 成立。
 *
 * ── 两道门，不是一道 ──────────────────────────────────────────────────────
 * 危险动作 = 菜单项自带的确认框（意图）**＋** `runWithStepUp`（身份）。step-up
 * 凭据在有效期内会被复用，拿它兼任确认，第二次起就会一声不响地执行。
 *
 * @author AI-Generated
 * @date 2026-09-18
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  ActionMenu,
  Badge,
  Button,
  DataTable,
  DetailPageTemplate,
  EmptyState,
  ListCardGrid,
  PanelCard,
  PanelItem,
  PanelList,
  Section,
  StatusBadge,
} from "@vxture/design-system";
import type {
  ActionMenuItem,
  DataTableColumn,
  StatusBadgeTone,
} from "@vxture/design-system";
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
  return versionState(version) !== "retiredVersion";
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

/** 行操作菜单的外壳：`justify-self-end` 负责居右，与账号/产品列表同一写法。 */
function RowMenu({
  label,
  items,
  disabled,
}: {
  label: string;
  items: readonly ActionMenuItem[];
  disabled: boolean;
}) {
  return (
    <div
      className="relative z-[1] inline-flex justify-self-end"
      onClick={(event) => event.stopPropagation()}
    >
      <ActionMenu label={label} disabled={disabled} items={items} />
    </div>
  );
}

export function PlanPublishingDetailPage({
  productCode,
}: {
  productCode: string;
}) {
  const t = useTranslations("planVersionsPage");
  const locale = useLocale();
  const router = useRouter();
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

  /** 同一档挂了多少条在售套餐——库里允许，界面必须标出来。 */
  const tierCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const plan of activePlans) {
      counts.set(plan.tier, (counts.get(plan.tier) ?? 0) + 1);
    }
    return counts;
  }, [activePlans]);

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
    (): DataTableColumn<PlanVersionSummary>[] => [
      {
        // 平台列表通例的首列是序号；版本史里版本号本身就是序号，用它更有意义。
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
        header: t("detail.price"),
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
        header: t("detail.created"),
        cell: (version) => formatDate(version.createdAt, locale),
      },
    ],
    [locale, t],
  );

  /** 版本行的动作：常规在前，危险在后（件据此自动插分隔线）。 */
  const versionMenuItems = useCallback(
    (plan: PlanMatrixPlan, version: PlanVersionSummary): ActionMenuItem[] => {
      const items: ActionMenuItem[] = [
        {
          id: "view",
          label: t("detail.view"),
          icon: "arrow-right",
          disabled: busy,
          onSelect: () => router.push(editorHref(plan.planId, version.id)),
        },
      ];
      // 「删除草稿」只对草稿成立——已发布版本压根没有这回事，所以不进数组，
      // 而不是放一个永远灰着的项。
      if (version.status === "draft" && !version.isLocked) {
        items.push({
          id: "delete-draft",
          label: t("actions.deleteDraft"),
          icon: "trash",
          disabled: busy,
          danger: true,
          confirm: withLabels({
            verb: t("actions.deleteDraftVerb"),
            target: t("actions.deleteDraftTarget", { n: version.versionNo }),
            consequence: t("actions.deleteDraftConsequence"),
            onConfirm: () =>
              runWrite(
                () => deletePlanVersion(version.id),
                t("actions.deleteDraftDone", { n: version.versionNo }),
              ),
          }),
        });
      }
      return items;
    },
    [busy, router, runWrite, t, withLabels],
  );

  const header = (
    <PageHeader
      icon="table"
      title={product ? product.productName : productCode}
      description={t("lifecycle.note")}
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/plan-versions")}
        >
          {t("detail.backToList")}
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

      {/* ── 档位区：一条套餐一张卡，标题是套餐名 ───────────────────────── */}
      <Section
        aria-label={t("list.sellingTiers")}
        level={2}
        icon="cube"
        title={t("list.sellingTiers")}
        description={t("detail.tierDescription")}
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
              const crowded = (tierCount.get(plan.tier) ?? 0) > 1;
              const items: ActionMenuItem[] = [];
              if (draft) {
                items.push({
                  id: "edit-draft",
                  label: t("detail.editDraft", { n: draft.versionNo }),
                  icon: "edit",
                  disabled: busy,
                  onSelect: () =>
                    router.push(editorHref(plan.planId, draft.id)),
                });
              }
              items.push({
                id: "deprecate",
                label: t("actions.deprecate"),
                icon: "stop",
                disabled: busy,
                danger: true,
                confirm: withLabels({
                  verb: t("actions.deprecateVerb"),
                  target: t("actions.deprecateTarget", { name: plan.planName }),
                  consequence: t("actions.deprecateConsequence"),
                  onConfirm: () =>
                    runWrite(
                      () => deprecatePlan(plan.planId),
                      t("actions.deprecateDone", { name: plan.planName }),
                    ),
                }),
              });
              return (
                <PanelCard
                  key={plan.planId}
                  title={plan.planName}
                  titleSuffix={
                    <Badge
                      variant="outline"
                      className={tierBadgeClass(plan.tier)}
                    >
                      {tierLabel(plan.tier)}
                    </Badge>
                  }
                  action={
                    <RowMenu
                      label={t("detail.menuLabel", { name: plan.planName })}
                      items={items}
                      disabled={busy}
                    />
                  }
                >
                  <PanelList>
                    <PanelItem
                      main={t("list.status")}
                      trail={
                        <span className="inline-flex flex-wrap items-center justify-end gap-2xs">
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
                          {crowded ? (
                            <StatusBadge tone="warning">
                              {t("detail.crowded")}
                            </StatusBadge>
                          ) : null}
                        </span>
                      }
                    />
                    <PanelItem
                      main={t("detail.price")}
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

      {/* ── 版本史：每条套餐一张表，四态现算，历史默认折叠 ─────────────── */}
      {activePlans.map((plan) => {
        const versions = versionsByPlan[plan.planId] ?? [];
        const ordered = [...versions].reverse();
        const foldable = ordered.filter((v) => !isAlwaysVisible(v));
        const open = expanded[plan.planId] ?? false;
        const shown = open ? ordered : ordered.filter(isAlwaysVisible);
        return (
          <Section
            key={`history-${plan.planId}`}
            aria-label={t("detail.versionsOf", {
              tier: tierLabel(plan.tier),
              name: plan.planName,
            })}
            level={3}
            icon="clock"
            title={plan.planName}
            description={`${tierLabel(plan.tier)} · ${plan.planCode}`}
            action={
              foldable.length > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setExpanded((prev) => ({ ...prev, [plan.planId]: !open }))
                  }
                >
                  {open
                    ? t("retired.collapse")
                    : `${t("retired.expand")} · ${formatNumber(foldable.length)}`}
                </Button>
              ) : null
            }
          >
            <DataTable
              labels={tableLabels}
              columns={versionColumns()}
              rows={shown}
              rowKey={(version) => version.id}
              loading={loading}
              rowActions={(version) => (
                <RowMenu
                  label={t("detail.menuLabel", {
                    name: `v${version.versionNo}`,
                  })}
                  items={versionMenuItems(plan, version)}
                  disabled={busy}
                />
              )}
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
              // 判据成立→可点；不成立或读不到→保留该项但置灰，并把原因写进 hint。
              // 「灰着且说明白为什么」比「干脆不给」更可读，也比「点下去吃 409」诚实。
              const cleanable = impact?.deletable === true;
              const items: ActionMenuItem[] = [
                cleanable
                  ? {
                      id: "soft-delete",
                      label: t("actions.softDelete"),
                      icon: "trash",
                      disabled: busy,
                      danger: true,
                      confirm: withLabels({
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
                      }),
                    }
                  : {
                      id: "soft-delete",
                      label: t("actions.softDelete"),
                      icon: "trash",
                      disabled: true,
                      hint: impact
                        ? t("actions.blocked", {
                            reasons: impact.blockers.join(" / "),
                          })
                        : t("detail.blockedHint"),
                      danger: true,
                      confirmExempt:
                        "项处于禁用态，点不动，不存在需要拦截的落锤动作。",
                    },
              ];
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
                      <StatusBadge tone={cleanable ? "warning" : "neutral"}>
                        {cleanable
                          ? t("retired.canSoftDelete")
                          : t("retired.keep")}
                      </StatusBadge>
                      <RowMenu
                        label={t("detail.menuLabel", { name: plan.planName })}
                        items={items}
                        disabled={busy}
                      />
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
