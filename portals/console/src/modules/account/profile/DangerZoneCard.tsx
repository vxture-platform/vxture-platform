"use client";

/**
 * DangerZoneCard — 危险操作:删除账号(批 5b,050-account §7)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 入口按钮不是 destructive 档:它只打开两步流程的第一屏(资格清单 + 知悉确认),
 * 落锤在对话框的提交按钮(`DialogForm danger`)。末行「删除条件」说明与面头**标题
 * 文字**左对齐——照 SectionHeader 的骨架留一个 icon 宽的占位,而不是顶到卡片边
 * (owner 2026-09-04)。
 */

import { useTranslations } from "next-intl";
import {
  Button,
  DetailList,
  DetailRow,
  Icon,
  Section,
} from "@vxture/design-system";

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
      title={t("cards.danger.title")}
      description={t("cards.danger.description")}
    >
      <div className="pl-md">
        <DetailList>
          <DetailRow
            label={t("deletion.label")}
            actions={
              <Button
                variant="outline"
                size="sm"
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
      </div>

      {/* 删除条件:与面头标题文字对齐(icon lg 宽 + gap-lg 的占位) */}
      <div className="flex gap-lg">
        <span aria-hidden="true" className="w-icon-lg shrink-0" />
        <p className="text-body-sm text-muted-foreground">
          <span className="text-foreground">
            {t("deletion.conditionsLabel")}
          </span>
          {t("deletion.conditions")}
        </p>
      </div>
    </Section>
  );
}
