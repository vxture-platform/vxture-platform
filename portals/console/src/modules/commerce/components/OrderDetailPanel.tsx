"use client";

/**
 * OrderDetailPanel.tsx — 订单行展开区（product_330 定稿）。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 严格 DS 组合件拼装（owner 2026-08-20：本页表格特殊性下允许组合、不造基础
 * 组件）：卡体 = Card surface="soft"（veil 底纹自带）+ CardContent；卡底行 =
 * CardFooter（自带虚线 hairline + mt-auto 下对齐）。三卡等高（grid stretch）：
 * 归属卡底行 = 订阅人（小头像 + 常规字重姓名 + owner 标签，无手机号）；
 * 内容卡金额三段：原价（常规）→ 抵扣总额（常规）→ 订单支付金额（加粗贴底）；
 * 第三卡为订单进度时间线（完整六态叙事只在这里展开）。
 * 操作不进本区（去支付/取消收在行操作列），纯展示。
 */

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  Icon,
  cn,
} from "@vxture/design-system";
import { formatCurrency, type Locale } from "@vxture-platform/shared";
import type { MyOrder } from "@/api/console-bff";
import { infoRow, infoRowGlyph, infoRowText } from "./sectionKit";
import { fmtStamp, groupVisibleCode } from "./hubModel";

interface Step {
  key: string;
  /** ISO 或 null；null = 未达。 */
  at: string | null;
  /** 当前停留步（着重显示）。 */
  now?: boolean;
  /** 附注（如剩余倒计时）。 */
  note?: string;
}

/** 六态 → 进度时间线（0 元单收款步改写为「自动结清（¥0）」）。 */
function buildSteps(order: MyOrder, countdown: string | null): Step[] {
  const zero = Number.parseFloat(order.amount) === 0;
  const submitted: Step = { key: "submitted", at: order.createdAt };
  switch (order.orderStatus) {
    case "cancelled":
      return [submitted, { key: "cancelled", at: null, now: true }];
    case "expired":
      return [submitted, { key: "expiredClosed", at: order.expireAt }];
    case "pending_payment":
      return [
        submitted,
        {
          key: "pay",
          at: null,
          now: true,
          ...(countdown ? { note: countdown } : {}),
        },
        { key: zero ? "settleZero" : "confirm", at: null },
        { key: "provision", at: null },
      ];
    case "paid_pending_verify":
      return [
        submitted,
        { key: "declared", at: order.declaredAt },
        { key: "confirm", at: null, now: true },
        { key: "provision", at: null },
      ];
    case "activating":
      return [
        submitted,
        { key: "declared", at: order.declaredAt },
        { key: zero ? "settleZero" : "confirm", at: order.confirmedAt },
        { key: "provision", at: null, now: true },
      ];
    case "completed":
      return zero
        ? [
            submitted,
            { key: "settleZero", at: order.confirmedAt ?? order.createdAt },
            { key: "provision", at: order.activatedAt },
          ]
        : [
            submitted,
            { key: "declared", at: order.declaredAt },
            { key: "confirm", at: order.confirmedAt },
            { key: "provision", at: order.activatedAt },
          ];
  }
}

/** 展开区小卡：DS Card 组合（soft veil），标题走 CardHeader/CardDescription，
 *  卡底行走 CardFooter（虚线 + 下对齐），三卡因 grid stretch 等高。 */
function DetailCard({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card surface="soft" className="h-full gap-sm py-md">
      <CardHeader>
        <CardDescription>{title}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-sm">
        {children}
      </CardContent>
      {footer ? (
        <CardFooter className="text-body-sm">{footer}</CardFooter>
      ) : null}
    </Card>
  );
}

export function OrderDetailPanel({
  order,
  countdown,
  fmtLocale,
}: {
  order: MyOrder;
  /** 待付款单的剩余时间文案（页面级 ticker 供给），非待付为 null。 */
  countdown: string | null;
  fmtLocale: Locale;
}) {
  const t = useTranslations("subscriptionHub.detail");
  const money = (v: string) =>
    formatCurrency(Number.parseFloat(v || "0"), fmtLocale, order.currency);
  const steps = buildSteps(order, countdown);
  const subscriberInitials = (order.subscriberName ?? "?").slice(0, 2);

  return (
    <div className="grid items-stretch gap-sm p-sm lg:grid-cols-3">
      {/* 卡一：订阅归属；卡底行 = 订阅人 */}
      <DetailCard
        title={t("ownership")}
        footer={
          <span className="flex min-w-0 items-center gap-xs text-body-md text-foreground">
            <span className="shrink-0 text-body-sm text-muted-foreground">
              {t("subscriber")}
            </span>
            <span
              aria-hidden="true"
              className="flex size-control-xs shrink-0 items-center justify-center rounded-full bg-primary-muted-hover text-label-sm text-primary-hover"
            >
              {subscriberInitials}
            </span>
            <span className="truncate">{order.subscriberName ?? "—"}</span>
            {order.subscriberRole === "owner" ? (
              <Badge variant="secondary">{t("ownerTag")}</Badge>
            ) : null}
          </span>
        }
      >
        <div className={infoRow}>
          <span
            aria-hidden="true"
            className={cn(
              infoRowGlyph,
              "bg-primary-muted-hover text-primary-hover",
            )}
          >
            <Icon name="buildings" size="sm" />
          </span>
          <span className={infoRowText}>
            <b className="truncate text-label-md text-foreground">
              {[order.tenantName, order.workspaceName]
                .filter(Boolean)
                .join(" · ") || "—"}
            </b>
            <span className="text-body-sm text-muted-foreground tabular-nums">
              {groupVisibleCode(order.workspaceNo)}
            </span>
          </span>
        </div>
      </DetailCard>

      {/* 卡二：订单内容；卡底行 = 支付金额（加粗） */}
      <DetailCard
        title={t("content")}
        footer={
          <span className="flex w-full items-baseline justify-between gap-md text-body-md font-semibold text-foreground">
            <span>{t("payable")}</span>
            <span className="tabular-nums">{money(order.amount)}</span>
          </span>
        }
      >
        <div className={infoRow}>
          <span
            aria-hidden="true"
            className={cn(
              infoRowGlyph,
              "bg-primary-muted-hover text-primary-hover",
            )}
          >
            <Icon name="package" size="sm" />
          </span>
          <span className={infoRowText}>
            <b className="truncate text-label-md text-foreground">
              {order.productName ?? order.planName}
              {order.tier ? ` ${order.tier}` : ""} ·{" "}
              {order.cycleUnit === "year" ? t("cycleYear") : t("cycleMonth")} ×
              1
            </b>
            <span className="text-body-sm text-muted-foreground tabular-nums">
              {order.startAt && order.endAt
                ? `${fmtStamp(order.startAt)} ~ ${fmtStamp(order.endAt)}`
                : t("periodOnActivation")}
            </span>
          </span>
          <span className="shrink-0 text-body-sm text-muted-foreground tabular-nums">
            {t("listPrice", { amount: money(order.listPrice) })}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-md text-body-sm text-muted-foreground">
          <span>{t("discountTotal")}</span>
          <span className="tabular-nums">−{money(order.voucherOff)}</span>
        </div>
      </DetailCard>

      {/* 卡三：订单进度 */}
      <DetailCard title={t("progress")}>
        <ol className="flex flex-col gap-xs">
          {steps.map((step) => {
            const done = step.at != null && !step.now;
            return (
              <li
                key={step.key}
                className={cn(
                  "flex items-center gap-sm text-body-sm",
                  step.now
                    ? "font-medium text-warning-text"
                    : done
                      ? "text-foreground"
                      : "text-muted-foreground",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-2xs shrink-0 rounded-full border",
                    step.now
                      ? "border-warning bg-warning"
                      : done
                        ? "border-success bg-success"
                        : "border-border bg-muted",
                  )}
                />
                <span className="min-w-0 flex-1 truncate">
                  {t(`step.${step.key}`)}
                  {step.note ? (
                    <span className="tabular-nums"> · {step.note}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-body-sm text-muted-foreground tabular-nums">
                  {step.at ? fmtStamp(step.at) : "—"}
                </span>
              </li>
            );
          })}
        </ol>
      </DetailCard>
    </div>
  );
}
