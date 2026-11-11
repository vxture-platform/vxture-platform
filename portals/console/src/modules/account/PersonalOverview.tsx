"use client";

/**
 * PersonalOverview.tsx - Account identity and verified platform participation.
 * @package @vxture/console
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-11
 */
import { useLocale, useTranslations } from "next-intl";
import {
  Button,
  Card,
  CardContent,
  Icon,
  StatusBadge,
  UserAvatar,
  type IconName,
} from "@vxture/design-system";
import type { ConsoleUser } from "@/entities/console";
import { accountCenterUrl } from "@/lib/account-center";
import { PageSection } from "@/layout/shell";
import { IdentityCard } from "@/components/detail/IdentityCard";

// ===== Personal identity =====
/**
 * Display shared identity without duplicating account editing in the console.
 * @param props - Current authenticated account.
 * @returns Identity summary with an account-center entry.
 */
export function PersonalOverview({ user }: { user: ConsoleUser | null }) {
  const t = useTranslations("membershipsPage.personal");
  const locale = useLocale();
  const name = user?.displayName || user?.name || user?.username || "—";
  return (
    <IdentityCard
      avatar={
        <UserAvatar
          src={user?.picture ?? null}
          alt={name}
          className="size-full"
        />
      }
      name={name}
      meta={
        <span className="flex flex-wrap gap-x-md gap-y-xs">
          {user?.username ? (
            <span>{t("username", { name: user.username })}</span>
          ) : null}
          {user?.email ? <span className="break-all">{user.email}</span> : null}
          {user?.phone ? <span>{user.phone}</span> : null}
          <span>{t("description")}</span>
        </span>
      }
      actions={
        <Button asChild variant="outline" size="sm">
          <a href={accountCenterUrl(locale)} target="_blank" rel="noreferrer">
            {t("manageAccount")}
            <Icon name="arrow-right" size="xs" aria-hidden />
          </a>
        </Button>
      }
    />
  );
}

// ===== Platform growth =====
const PLANNED_ITEMS: readonly {
  key: "level" | "points" | "rewards";
  icon: IconName;
}[] = [
  { key: "level", icon: "star" },
  { key: "points", icon: "coins" },
  { key: "rewards", icon: "gift" },
];

/**
 * Render only achievements supported by real membership data.
 * @param props - Whether memberships loaded and contain an active relationship.
 * @returns Compact growth overview with explicit planned states.
 */
export function PersonalGrowth({
  membershipState,
}: {
  membershipState: "loading" | "failed" | "member" | "empty";
}) {
  const t = useTranslations("membershipsPage.growth");
  return (
    <PageSection title={t("title")} description={t("description")} icon="medal">
      <div className="grid min-w-0 grid-cols-1 gap-md sm:grid-cols-2 xl:grid-cols-4">
        {PLANNED_ITEMS.map(({ key, icon }) => (
          <Card key={key} className="min-w-0">
            <CardContent className="flex flex-col gap-sm">
              <div className="flex items-center gap-sm">
                <Icon name={icon} size="sm" aria-hidden />
                <span className="flex-1 text-label-md">
                  {t(`${key}.title`)}
                </span>
                <StatusBadge tone="neutral">{t("planned")}</StatusBadge>
              </div>
              <p className="text-body-sm text-muted-foreground">
                {t(`${key}.description`)}
              </p>
            </CardContent>
          </Card>
        ))}
        <Card className="min-w-0">
          <CardContent className="flex flex-col gap-sm">
            <span className="text-label-md">{t("badges.title")}</span>
            {membershipState === "member" ? (
              <StatusBadge tone="brand" icon="medal">
                {t("badges.member")}
              </StatusBadge>
            ) : (
              <span className="text-body-sm text-muted-foreground">
                {t(`badges.${membershipState}`)}
              </span>
            )}
            <p className="text-body-sm text-muted-foreground">
              {t("badges.description")}
            </p>
          </CardContent>
        </Card>
      </div>
    </PageSection>
  );
}
