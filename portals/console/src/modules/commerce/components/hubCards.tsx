"use client";

/**
 * hubCards.tsx — 产品订阅总览页的三类卡片（product_330 定稿）。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 1) HubStatCards：概览条三格——数值与小字同一行；卡面走 DS Card soft veil
 *    叠层（与 /billing 同款修饰），右上角 aside 淡图标。
 * 2) SubscriptionProductCard：「我的订阅」卡。卡内分割线一律虚线；★ = 收藏
 *    （排序优先）；操作区规则：管理常驻，free/starter 追加升级，剩余 ≤5 天
 *    或已过期追加续订（主按钮）；「最新版 vX.Y.Z」纯文本（版本页未建）——
 *    平台只有一套最新实例，版本恒为当前发布号（products.release_version），
 *    随产品更新自动跟进，展示它是为了传达「持续创新」，不随订阅冻结。
 * 3) RecommendedProductCard：「新品推荐」卡，CTA 外链 website 产品详情页，
 *    订阅动作由详情页承接。
 */

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Icon,
  StatusBadge,
  cn,
} from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";
import { formatCurrency, type Locale } from "@vxture/shared";
import { Link } from "@/lib/i18n/navigation";
import { buildWebsiteProductUrl } from "@/lib/website-entry";
import type { RecommendedProduct, SubscribedProduct } from "@/api/console-bff";
import {
  SUB_STATUS_TONES,
  TIER_AUDIENCE,
  cyclePercent,
  daysLeft,
  fmtDate,
  productInitials,
  type PlanAudience,
} from "./hubModel";

/** 卡内虚线分隔（与 DS CardFooter 的 hairline.field 同款）。 */
const DASHED_TOP =
  "border-t border-dashed border-primary/10 dark:border-primary/20";

const AUDIENCE_ICON: Record<PlanAudience, IconName> = {
  person: "user",
  team: "users",
  private: "buildings",
};

/** 到期临界：剩余 ≤5 天出续订主按钮（owner 定稿）。 */
const RENEW_THRESHOLD_DAYS = 5;

// ============================================================================
// 概览条
// ============================================================================

export interface HubStat {
  key: string;
  icon: IconName;
  label: string;
  value: string;
  /** 数值同行的小字（可含 ReactNode，如倒计时着色段）。 */
  hint: ReactNode;
  /** 数值警示色（如待付订单 >0）。 */
  warn?: boolean;
}

export function HubStatCards({ items }: { items: HubStat[] }) {
  return (
    <div className="grid gap-md sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <Card key={item.key} surface="soft" className="gap-sm py-lg">
          <CardContent className="relative flex flex-col gap-2xs">
            <span
              aria-hidden="true"
              className="absolute right-xl top-0 text-primary opacity-55"
            >
              <Icon name={item.icon} size="sm" />
            </span>
            <span className="text-label-sm text-muted-foreground">
              {item.label}
            </span>
            <span className="flex flex-wrap items-baseline gap-sm">
              <strong
                className={cn(
                  "text-title-lg tabular-nums",
                  item.warn ? "text-warning-text" : "text-foreground",
                )}
              >
                {item.value}
              </strong>
              <span className="text-body-sm text-muted-foreground">
                {item.hint}
              </span>
            </span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================================================
// 收藏 ★
// ============================================================================

function FavoriteStar({
  active,
  busy,
  onToggle,
  labelOn,
  labelOff,
}: {
  active: boolean;
  busy: boolean;
  onToggle: () => void;
  labelOn: string;
  labelOff: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={busy}
      aria-pressed={active}
      aria-label={active ? labelOn : labelOff}
      onClick={onToggle}
      className={cn(
        "shrink-0",
        active ? "text-warning-text" : "text-muted-foreground",
      )}
    >
      <Icon name="star" size="sm" />
    </Button>
  );
}

/** 产品字母牌（icon_url 未接入前的缺省底板）。 */
function ProductGlyph({
  name,
  code,
  size = "md",
}: {
  name: string | null;
  code: string | null;
  size?: "md" | "sm";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg bg-primary-muted-hover font-semibold text-primary-hover",
        size === "md"
          ? "size-control-md text-label-sm"
          : "size-control-sm text-label-sm",
      )}
    >
      {productInitials(name, code)}
    </span>
  );
}

// ============================================================================
// 「我的订阅」产品卡
// ============================================================================

export function SubscriptionProductCard({
  item,
  favoriteBusy,
  onToggleFavorite,
}: {
  item: SubscribedProduct;
  favoriteBusy: boolean;
  onToggleFavorite: (productCode: string, next: boolean) => void;
}) {
  const t = useTranslations("subscriptionHub");
  const locale = useLocale();

  const audience = item.tier ? TIER_AUDIENCE[item.tier] : undefined;
  const left = daysLeft(item.endAt);
  const expired = item.status === "expired";
  const percent = cyclePercent(item.startAt, item.endAt);
  const nearExpiry = !expired && left != null && left <= RENEW_THRESHOLD_DAYS;
  const isFree = item.kind === "free" || item.tier === "free";
  const showUpgrade =
    !expired && (item.tier === "free" || item.tier === "starter");
  const showRenew = expired || nearExpiry;
  const productCode = item.productCode ?? "";

  return (
    <Card surface="base" className="gap-md py-lg">
      <CardContent className="flex flex-col gap-md px-lg">
        {/* 产品名 + ★ */}
        <div className="flex items-center gap-md">
          <ProductGlyph name={item.productName} code={item.productCode} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-label-md text-foreground">
              {item.productName ?? item.planName}
            </span>
            <span className="block truncate text-body-sm text-muted-foreground">
              {item.productNick ?? item.planName}
            </span>
          </span>
          <FavoriteStar
            active={item.favorite}
            busy={favoriteBusy || !productCode}
            onToggle={() => onToggleFavorite(productCode, !item.favorite)}
            labelOn={t("favorite.remove")}
            labelOff={t("favorite.add")}
          />
        </div>

        {/* 档位 / 受众·席位 / 周期 / 状态 */}
        <div className="flex flex-wrap items-center gap-xs">
          {item.tier ? (
            <Badge variant="secondary">{t(`tier.${item.tier}`)}</Badge>
          ) : null}
          {audience ? (
            <Badge variant="outline" className="gap-2xs">
              <Icon name={AUDIENCE_ICON[audience]} size="xs" aria-hidden />
              {item.seats != null
                ? t(`audienceSeats.${audience}`, { seats: item.seats })
                : t(`audience.${audience}`)}
            </Badge>
          ) : null}
          <Badge variant="outline">
            {isFree
              ? t("cycle.free")
              : item.cycleUnit === "year"
                ? t("cycle.year")
                : t("cycle.month")}
          </Badge>
          <StatusBadge tone={SUB_STATUS_TONES[item.status] ?? "neutral"}>
            {t(`subStatus.${item.status}`)}
          </StatusBadge>
        </div>

        {/* 有效期 + 进度 */}
        <div className="flex flex-col gap-2xs">
          <div className="flex items-baseline justify-between gap-sm text-body-sm">
            <span className="text-muted-foreground tabular-nums">
              {item.endAt
                ? `${fmtDate(item.startAt)} ~ ${fmtDate(item.endAt)}`
                : t("term.perpetual")}
            </span>
            <span
              className={cn(
                "tabular-nums",
                nearExpiry || expired
                  ? "font-medium text-warning-text"
                  : "text-muted-foreground",
              )}
            >
              {expired
                ? t("term.expired")
                : left != null
                  ? t("term.daysLeft", { days: left })
                  : isFree
                    ? t("term.freeNote")
                    : ""}
            </span>
          </div>
          <div className="h-2xs overflow-hidden rounded-full bg-muted">
            {percent != null && !expired ? (
              <div
                className={cn(
                  "h-full rounded-full",
                  nearExpiry ? "bg-warning" : "bg-primary",
                )}
                style={{ width: `${percent}%` }}
              />
            ) : null}
          </div>
        </div>

        {/* 卡底：虚线上方留白，下方 = 链接/版本 | 操作 */}
        <div
          className={cn(
            "flex items-center gap-md pt-md text-body-sm",
            DASHED_TOP,
          )}
        >
          {productCode ? (
            <a
              href={buildWebsiteProductUrl(locale, productCode)}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-primary-text hover:underline"
            >
              {t("card.productDetail")}
            </a>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-muted-foreground tabular-nums">
            {item.releaseVersion
              ? t("card.version", { version: item.releaseVersion })
              : ""}
          </span>
          <span className="flex shrink-0 items-center gap-xs">
            <Button asChild variant="outline" size="sm">
              <Link href={`/subscribe?product=${productCode}`}>
                {t("card.manage")}
              </Link>
            </Button>
            {showUpgrade ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/subscribe?product=${productCode}&intent=upgrade`}>
                  {t("card.upgrade")}
                </Link>
              </Button>
            ) : null}
            {showRenew ? (
              <Button asChild size="sm">
                <Link href={`/subscribe?product=${productCode}&intent=renew`}>
                  {t("card.renew")}
                </Link>
              </Button>
            ) : null}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// 「新品推荐」卡
// ============================================================================

export function RecommendedProductCard({
  item,
  favoriteBusy,
  onToggleFavorite,
}: {
  item: RecommendedProduct;
  favoriteBusy: boolean;
  onToggleFavorite: (productCode: string, next: boolean) => void;
}) {
  const t = useTranslations("subscriptionHub");
  const locale = useLocale();
  const appLocale = locale as Locale;
  const free = Number.parseFloat(item.minPrice) === 0;

  return (
    <Card surface="base" className="gap-md py-lg">
      <CardContent className="flex flex-1 flex-col gap-md px-lg">
        <div className="flex items-center gap-md">
          <ProductGlyph name={item.productName} code={item.productCode} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-label-md text-foreground">
              {item.productName}
            </span>
            <span className="block truncate text-body-sm text-muted-foreground">
              {item.productNick ?? item.productCode}
            </span>
          </span>
          <FavoriteStar
            active={item.favorite}
            busy={favoriteBusy}
            onToggle={() => onToggleFavorite(item.productCode, !item.favorite)}
            labelOn={t("favorite.remove")}
            labelOff={t("favorite.add")}
          />
        </div>

        {item.description ? (
          <p className="line-clamp-2 text-body-sm text-muted-foreground">
            {item.description}
          </p>
        ) : null}

        {item.tags.length > 0 ? (
          <div className="flex flex-wrap gap-xs">
            {item.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}

        <div className="mt-auto flex items-baseline gap-xs pt-sm">
          <strong className="text-title-sm text-foreground tabular-nums">
            {free
              ? t("reco.free")
              : formatCurrency(
                  Number.parseFloat(item.minPrice),
                  appLocale,
                  item.currency,
                )}
          </strong>
          {!free ? (
            <span className="text-body-sm text-muted-foreground">
              {t("reco.fromPerMonth")}
            </span>
          ) : (
            <span className="text-body-sm text-muted-foreground">
              {t("reco.freeNote")}
            </span>
          )}
        </div>

        <div
          className={cn(
            "flex items-center justify-between gap-md pt-md text-body-sm",
            DASHED_TOP,
          )}
        >
          <a
            href={buildWebsiteProductUrl(locale, item.productCode)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2xs text-primary-text hover:underline"
          >
            {t("reco.learnMore")}
            <Icon name="external-link" size="xs" aria-hidden />
          </a>
          {item.releaseVersion ? (
            <span className="text-muted-foreground tabular-nums">
              {t("card.version", { version: item.releaseVersion })}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
