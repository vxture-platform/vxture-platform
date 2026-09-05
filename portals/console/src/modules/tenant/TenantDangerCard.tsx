"use client";

/**
 * TenantDangerCard — 租户信息页的危险操作:只有「注销租户」(走查 2026-09-05)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 与账号信息页的危险操作卡同一形状:整卡红(描边 + 淡红底 + 面头图标 / 标题着色),
 * 注销条件以 danger 标签一排放在面头说明里,入口按钮是 outline 档——它只打开资格
 * 清单 + 知悉确认的对话框,落锤在对话框的提交按钮。
 *
 * 转让所有权已搬到身份卡的所有者一行,转为组织租户搬到身份卡认证按钮之后;
 * 个人租户不显示本卡(个人租户随账号删除,见账号信息页)。
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

/** 注销条件标签,与 BFF 资格判定的阻断项一一对应(账号页同一写法)。 */
const CLOSE_CONDITIONS = [
  "ownerOnly",
  "noMembers",
  "noBills",
  "noBalance",
  "noInProgress",
  "noPaidOrder",
] as const;

export function TenantDangerCard({
  disabled,
  onCloseTenant,
}: {
  readonly disabled: boolean;
  readonly onCloseTenant: () => void;
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
      }
    >
      <CardRows>
        <DetailList className={DETAIL_LIST_CLASS}>
          <DetailRow
            label={t("danger.close.label")}
            actions={
              <Button
                variant="outline"
                size="sm"
                className="border-destructive-border text-destructive-text"
                onClick={onCloseTenant}
                disabled={disabled}
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
        </DetailList>
      </CardRows>
    </Section>
  );
}
