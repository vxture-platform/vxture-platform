"use client";

/**
 * DangerZoneCard — 危险操作:删除账号(批 5b,050-account §7)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 整张卡红色警示(描边 + 底色 + 图标 / 标题着色),不只在文字上;「删除条件」作为
 * 语气标签一排放在标题下、前缀红色加粗(owner 2026-09-04 二次走查)。入口按钮不是
 * destructive 档:它只打开两步流程的第一屏(资格清单 + 知悉确认),落锤在对话框的
 * 提交按钮(`DialogForm danger`)。
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
import { CardRows, DETAIL_LIST_CLASS } from "./CardRows";

const CONDITION_TAGS = [
  "orgOwner",
  "unpaidBills",
  "paidBalance",
  "inProgress",
  "paidOrder",
] as const;

/**
 * 卡面红色警示:描边 + 淡红底;面头的 icon 与 h2 是 SectionHeader 的固定结构,
 * 这里用后代选择器把它们的颜色一起翻红(Section 没有 tone=danger 一档)。
 */
const DANGER_SECTION_CLASS =
  "ring-destructive-border/60 bg-destructive-muted/30 [&>div:first-child>span:first-child]:text-destructive-text [&_h2]:text-destructive-text";

export function DangerZoneCard({
  retentionDays,
  disabled,
  onDelete,
}: {
  readonly retentionDays: number;
  readonly disabled: boolean;
  readonly onDelete: () => void;
}) {
  const t = useTranslations("profilePage");

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
            {t("deletion.conditionsLabel")}
          </strong>
          {CONDITION_TAGS.map((tag) => (
            <StatusBadge key={tag} tone="danger" icon={false}>
              {t(`deletion.conditionTags.${tag}`)}
            </StatusBadge>
          ))}
        </span>
      }
    >
      <CardRows>
        <DetailList className={DETAIL_LIST_CLASS}>
          <DetailRow
            label={t("deletion.label")}
            actions={
              <Button
                variant="outline"
                size="sm"
                className="border-destructive-border text-destructive-text"
                onClick={onDelete}
                disabled={disabled}
              >
                <Icon name="trash" size="xs" fallback="placeholder" />
                <span>{t("deletion.action")}</span>
              </Button>
            }
          >
            <span className="text-body-sm text-muted-foreground">
              {t("deletion.summary", { days: retentionDays })}
            </span>
          </DetailRow>
        </DetailList>
      </CardRows>
    </Section>
  );
}
