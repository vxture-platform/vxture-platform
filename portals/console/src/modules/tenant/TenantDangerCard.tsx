"use client";

/**
 * TenantDangerCard — 租户信息页的危险操作(批 5c)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 与账号信息页的危险操作卡同一形状:整卡红(描边 + 淡红底 + 面头图标 / 标题着色),
 * 条件以 danger 标签排在面头说明里。
 *
 * 组织租户:转让所有权(可用)· 注销租户(只画入口 + 条件,后端另起一批,决策 5)。
 * 个人租户:转为组织租户(可用,批 5c-2)——不可回退,走三屏仪式。
 */

import { useTranslations } from "next-intl";
import {
  Button,
  DetailList,
  DetailRow,
  Icon,
  Section,
  StatusBadge,
} from "@vxture/design-system";
import {
  CardRows,
  DETAIL_LIST_CLASS,
} from "@/modules/account/profile/CardRows";

const DANGER_SECTION_CLASS =
  "ring-destructive-border/60 bg-destructive-muted/30 [&>div:first-child>span:first-child]:text-destructive-text [&_h2]:text-destructive-text";

const CLOSE_CONDITIONS = [
  "noBills",
  "noBalance",
  "noInProgress",
  "noPaidOrder",
  "membersCleared",
] as const;

export function TenantDangerCard({
  isPersonal,
  isOwner,
  transferReady,
  onTransfer,
  onConvert,
}: {
  readonly isPersonal: boolean;
  readonly isOwner: boolean;
  /** 有可接收的活跃成员时才可点(只有自己一个人时无处可转)。 */
  readonly transferReady: boolean;
  readonly onTransfer: () => void;
  readonly onConvert: () => void;
}) {
  const t = useTranslations("tenantInfoPage");

  return (
    <Section
      tone="raised"
      level={2}
      icon="warning"
      className={DANGER_SECTION_CLASS}
      title={t("cards.danger.title")}
      description={
        isPersonal ? (
          t("danger.personalDescription")
        ) : (
          <span className="flex flex-wrap items-center gap-sm">
            <strong className="font-semibold text-destructive-text">
              {t("danger.closeConditionsLabel")}
            </strong>
            {CLOSE_CONDITIONS.map((c) => (
              <StatusBadge key={c} tone="danger" icon={false}>
                {t(`danger.closeConditions.${c}`)}
              </StatusBadge>
            ))}
          </span>
        )
      }
    >
      <CardRows>
        <DetailList className={DETAIL_LIST_CLASS}>
          {isPersonal ? (
            <DetailRow
              label={t("danger.convert.label")}
              actions={
                <Button
                  variant="outline"
                  size="sm"
                  className="border-destructive-border text-destructive-text"
                  onClick={onConvert}
                  disabled={!isOwner}
                >
                  <Icon
                    name="building-library"
                    size="xs"
                    fallback="placeholder"
                  />
                  <span>{t("danger.convert.action")}</span>
                </Button>
              }
            >
              <span className="text-body-sm text-muted-foreground">
                {t("danger.convert.summary")}
              </span>
            </DetailRow>
          ) : null}
          {isPersonal ? null : (
            <DetailRow
              label={t("danger.transfer.label")}
              actions={
                <Button
                  variant="outline"
                  size="sm"
                  className="border-destructive-border text-destructive-text"
                  onClick={onTransfer}
                  disabled={!isOwner || !transferReady}
                >
                  <Icon
                    name="arrow-left-right"
                    size="xs"
                    fallback="placeholder"
                  />
                  <span>{t("danger.transfer.action")}</span>
                </Button>
              }
            >
              <span className="text-body-sm text-muted-foreground">
                {isOwner
                  ? transferReady
                    ? t("danger.transfer.summary")
                    : t("danger.transfer.noCandidate")
                  : t("danger.transfer.ownerOnly")}
              </span>
            </DetailRow>
          )}

          {isPersonal ? null : (
            <DetailRow
              label={t("danger.close.label")}
              actions={
                <Button
                  variant="outline"
                  size="sm"
                  className="border-destructive-border text-destructive-text"
                  disabled
                >
                  <Icon name="trash" size="xs" fallback="placeholder" />
                  <span>{t("danger.close.action")}</span>
                </Button>
              }
            >
              <span className="text-body-sm text-muted-foreground">
                {t("danger.close.summary")}
              </span>
            </DetailRow>
          )}
        </DetailList>
      </CardRows>
    </Section>
  );
}
