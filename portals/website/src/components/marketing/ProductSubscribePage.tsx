"use client";

/**
 * ProductSubscribePage — /pricing 通用订阅页。
 * 从产品中心卡片「订阅」进入，?product= 选定产品（默认 arda）；
 * 页面结构参照 figma.com/pricing 简化为两个板块：
 *   1. 选择套餐与席位（居中头部 + 胶囊计费切换 + 档位卡片，推荐档强调）
 *   2. 对比所有功能（DS DataTable 分组对比表，推荐列淡色高亮）
 * 数据按产品 code 组织在 products.subscription.products 下，
 * 后续产品/套餐/解决方案开放订阅时只需补充对应 code 的数据。
 * 档位 CTA 深链 console /subscribe（携带 product/intent/target_tier）。
 */

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Card,
  CardContent,
  DataTable,
  Icon,
  StatusBadge,
} from "@vxture/design-system";
import type { DataTableColumn } from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";
import { buildConsoleSubscribeUrl } from "@/lib/console-entry";

type Plan = {
  tier: string;
  name: string;
  monthly: string | null; // null = 联系销售（企业版）
  yearly: string | null;
  save?: string;
  seats: string;
  features: string[];
  highlight?: boolean;
};

type ComparisonRow = {
  label: string;
  /** 每档一列：true=✓，false=不含，字符串=具体额度 */
  values: (string | boolean)[];
};

type ComparisonGroup = { title: string; rows: ComparisonRow[] };

type SubscribableProduct = {
  name: string;
  contactSubject: string;
  plans: Plan[];
  comparison: { groups: ComparisonGroup[] };
};

type Cycle = "monthly" | "yearly";

const DEFAULT_PRODUCT = "arda";

/**
 * 档位卡片列数按产品实际发布的档位数动态取值，宽屏保持一行；
 * Tailwind 类名需编译期字面量，故用映射表而非模板拼接。
 */
const PLAN_GRID_COLS: Record<number, string> = {
  1: "xl:grid-cols-1",
  2: "xl:grid-cols-2",
  3: "xl:grid-cols-3",
  4: "xl:grid-cols-4",
  5: "xl:grid-cols-5",
};

/** 推荐档位在对比表中的整列淡色高亮。 */
const HIGHLIGHT_COL = "bg-vx-brand-50/50 dark:bg-vx-brand-950/25";

/** 对比表行模型：分组标题行 + 功能行，扁平化后交给 DS DataTable 渲染。 */
type CompareTableRow =
  | { kind: "group"; title: string }
  | ({ kind: "feature" } & ComparisonRow);

/** 首列=功能名（分组行渲染分组标题），其余列=各档位取值。 */
function buildCompareColumns(
  product: SubscribableProduct,
  featureHeader: string,
): DataTableColumn<CompareTableRow>[] {
  return [
    {
      id: "feature",
      /* 宽度落在内容上而不是列上：DataTable 删掉了列级 className（列的对齐由
       * `align` 表达，其余交给单元格内容）。`block w-56` 让这一列的内容撑出固定
       * 宽度，效果与原先的列宽一致。 */
      header: (
        <span className="block w-56 text-xs uppercase tracking-wide text-vx-gray-500 dark:text-vx-gray-400">
          {featureHeader}
        </span>
      ),
      cell: (row) =>
        row.kind === "group" ? (
          <span className="text-xs font-semibold uppercase tracking-wide text-vx-brand-600 dark:text-vx-brand-300">
            {row.title}
          </span>
        ) : (
          <span className="text-vx-gray-700 dark:text-vx-gray-200">
            {row.label}
          </span>
        ),
    },
    ...product.plans.map(
      (plan, planIndex): DataTableColumn<CompareTableRow> => ({
        id: plan.tier,
        align: "center",
        /* 推荐列的底色画在**内容**上。原先走 headerClassName / cellClassName，
         * 那两个口子随 DataTable 收窄一起没了——但它们藏在条件展开里，TypeScript
         * 不对展开做多余属性检查，于是编译通过、样式静默失效：推荐列一直没有底色，
         * 也没有任何东西报错（2026-08-05 排查 #24 时发现）。 */
        header: (
          <span
            className={
              plan.highlight
                ? `block ${HIGHLIGHT_COL} font-bold text-vx-brand-600 dark:text-vx-brand-300`
                : "block text-vx-gray-900 dark:text-vx-white"
            }
          >
            {plan.name}
          </span>
        ),
        cell: (row) =>
          row.kind === "group" ? null : (
            <span
              className={plan.highlight ? `block ${HIGHLIGHT_COL}` : undefined}
            >
              <ComparisonCell value={row.values[planIndex] ?? false} />
            </span>
          ),
      }),
    ),
  ];
}

function ComparisonCell({ value }: { value: string | boolean }) {
  if (value === true) {
    return (
      <Icon
        name="check"
        className="mx-auto h-4 w-4 text-vx-brand-500"
        aria-hidden
      />
    );
  }
  if (value === false) {
    return <span className="text-vx-gray-300 dark:text-vx-gray-600">—</span>;
  }
  return (
    <span className="font-medium text-vx-gray-700 dark:text-vx-gray-200">
      {value}
    </span>
  );
}

export default function ProductSubscribePage() {
  const t = useTranslations("products.subscription");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const productCode = searchParams.get("product") ?? DEFAULT_PRODUCT;
  const productsMap = t.raw("products") as Record<string, SubscribableProduct>;
  const product = productsMap[productCode] ?? null;
  const [cycle, setCycle] = useState<Cycle>("yearly");

  return (
    <div className="vx-page-surface">
      <section className="vx-section-odd">
        <div className="mx-auto max-w-7xl px-6 pt-24 lg:px-8 xl:max-w-screen-2xl">
          {/* ── 居中页头：产品订阅统一入口 ─────────────────────────────── */}
          <div className="mx-auto max-w-website-3xl text-center">
            <p className="vx-website-hero-eyebrow text-sm font-semibold uppercase text-vx-brand-600 dark:text-vx-info-200">
              {t("eyebrow")}
            </p>
            <h1 className="font-brand mt-4 text-4xl font-bold leading-tight text-vx-gray-900 dark:text-vx-white md:text-5xl">
              {t("title")}
            </h1>
            <p className="mt-4 text-base leading-7 text-vx-gray-600 dark:text-vx-gray-300">
              {t("description")}
            </p>
          </div>

          {!product ? (
            <div className="mx-auto mt-12 max-w-website-xl rounded-lg border border-vx-gray-200 bg-vx-white p-8 text-center dark:border-vx-gray-800 dark:bg-vx-gray-900">
              <p className="text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
                {t("unavailable")}
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Button asChild variant="outline">
                  <a
                    href={`mailto:sales@vxture.com?subject=${encodeURIComponent(
                      `${productCode} ${t("contact")}`,
                    )}`}
                  >
                    {t("contact")}
                  </a>
                </Button>
                <Button asChild>
                  <Link href="/products">{t("back")}</Link>
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* ── 产品上下文 + 胶囊计费切换（居中） ───────────────────── */}
              <div className="mt-10 flex flex-col items-center gap-6">
                <span className="inline-flex items-center gap-2 rounded-full border border-vx-brand-200 bg-vx-brand-50/60 px-4 py-1.5 text-sm font-medium text-vx-brand-700 dark:border-vx-brand-500/30 dark:bg-vx-brand-950/30 dark:text-vx-brand-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-vx-brand-500" />
                  {product.name}
                </span>
                <div
                  role="group"
                  className="inline-flex items-center gap-1 rounded-full border border-vx-gray-200 bg-vx-white p-1 shadow-sm dark:border-vx-gray-700 dark:bg-vx-gray-900"
                >
                  {(["monthly", "yearly"] as Cycle[]).map((c) => (
                    <Button
                      key={c}
                      variant={cycle === c ? "default" : "ghost"}
                      size="md"
                      onClick={() => setCycle(c)}
                      className="rounded-full px-5"
                    >
                      {t(`cycle.${c}`)}
                    </Button>
                  ))}
                </div>
              </div>

              {/* ── 板块一：档位卡片（推荐档强调） ─────────────────────── */}
              <div
                className={`mt-12 grid items-stretch gap-4 md:grid-cols-2 ${
                  PLAN_GRID_COLS[product.plans.length] ?? "xl:grid-cols-5"
                }`}
              >
                {product.plans.map((plan) => {
                  const price =
                    cycle === "monthly" ? plan.monthly : plan.yearly;
                  const isContact = price === null;
                  return (
                    <Card
                      key={plan.tier}
                      className={`flex flex-col shadow-none ${
                        plan.highlight
                          ? "vx-card--accent"
                          : "transition hover:border-vx-brand-200 dark:hover:border-vx-brand-500/30"
                      }`}
                    >
                      <CardContent className="flex flex-1 flex-col gap-4 p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-vx-text-muted">
                              {plan.name}
                            </p>
                            <div className="mt-2 flex items-baseline gap-1">
                              <span className="text-2xl font-semibold leading-website-none text-vx-text-primary">
                                {isContact ? t("contact") : price}
                              </span>
                              {isContact ? null : (
                                <span className="text-xs text-vx-text-muted">
                                  / {t(`per.${cycle}`)}
                                </span>
                              )}
                            </div>
                            {/* 折扣槽位固定高度，保证各卡头部区等高、分隔线对齐 */}
                            <div className="mt-2 min-h-6">
                              {!isContact && cycle === "yearly" && plan.save ? (
                                <StatusBadge tone="success">
                                  {plan.save}
                                </StatusBadge>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex h-10 shrink-0 items-start">
                            {plan.highlight ? (
                              <Badge>{t("recommended")}</Badge>
                            ) : (
                              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-vx-primary-soft text-vx-primary-strong">
                                <Icon name="users" className="h-5 w-5" />
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="border-t border-vx-border pt-4">
                          <p className="text-sm font-medium text-vx-text-primary">
                            {plan.seats}
                          </p>
                          <ul className="mt-3 space-y-2.5">
                            {plan.features.map((feature) => (
                              <li
                                key={feature}
                                className="flex gap-2 text-sm leading-5 text-vx-text-muted"
                              >
                                <Icon
                                  name="check"
                                  className="mt-0.5 h-4 w-4 shrink-0 text-vx-primary"
                                />
                                <span>{feature}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="mt-auto pt-2">
                          {isContact ? (
                            <Button
                              asChild
                              variant="outline"
                              className="w-full"
                            >
                              <a
                                href={`mailto:sales@vxture.com?subject=${encodeURIComponent(
                                  product.contactSubject,
                                )}`}
                              >
                                {t("contact")}
                              </a>
                            </Button>
                          ) : (
                            <Button
                              asChild
                              variant={plan.highlight ? "default" : "outline"}
                              className="w-full"
                            >
                              <a
                                href={buildConsoleSubscribeUrl(
                                  locale,
                                  productCode,
                                  "subscribe",
                                  plan.tier,
                                  // 展示值域 monthly|yearly → wire 值域 month|year
                                  // （console 严格匹配 cycle_unit，直传必失配）
                                  cycle === "monthly" ? "month" : "year",
                                )}
                              >
                                {t("subscribe")}
                              </a>
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </section>

      {product ? (
        <section className="vx-section-even">
          <div className="mx-auto max-w-7xl px-6 lg:px-8 xl:max-w-screen-2xl">
            {/* ── 板块二：对比所有功能 ─────────────────────────────────── */}
            <div className="mx-auto max-w-website-2xl text-center">
              <h2 className="font-display text-2xl font-bold text-vx-gray-900 dark:text-vx-white md:text-3xl">
                {t("compare.title")}
              </h2>
              <p className="mt-3 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
                {t("compare.description")}
              </p>
            </div>
            <DataTable<CompareTableRow>
              className="vx-data-table--banded mt-10 shadow-none"
              columns={buildCompareColumns(product, t("compare.feature"))}
              rows={product.comparison.groups.flatMap((group) => [
                { kind: "group" as const, title: group.title },
                ...group.rows.map((row) => ({
                  kind: "feature" as const,
                  ...row,
                })),
              ])}
              rowKey={(row) =>
                row.kind === "group" ? `group:${row.title}` : row.label
              }
              /* 分组行不再靠底色区分：DataTable 删掉了 getRowClassName（按行改
               * 样式等于把行的视觉状态交回调用方）。分组行的文字本来就是
               * 品牌色 + 大写 + 加粗，与功能行明显不同，去掉底色仍分得清。 */
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
