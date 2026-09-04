"use client";

/**
 * PreferencesCard — 个人偏好:语言 / 时区(下拉)+ 主题 / 密度 / 文字大小(按钮组)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 五个控件统一宽度(不全宽)、从同一竖线起;主题 / 密度 / 字号即时预览(调用方接
 * useTheme),放弃回滚、保存才持久化;语言与时区随页底保存。
 */

import { useTranslations } from "next-intl";
import {
  DetailList,
  DetailRow,
  NativeSelect,
  Section,
  SegmentedControl,
} from "@vxture/design-system";
import { TIMEZONE_OPTIONS, formatTimezone } from "./format";
import { CardRows, DETAIL_LIST_CLASS } from "./CardRows";

export type ThemeChoice = "system" | "light" | "dark";
export type DensityChoice = "compact" | "default" | "comfortable";
export type FontSizeChoice = "small" | "default" | "large";

export interface PreferencesDraft {
  language: string;
  timezone: string;
  theme: ThemeChoice;
  density: DensityChoice;
  fontSize: FontSizeChoice;
}

/**
 * 五个控件同宽同高:宽度 media-3xl(12rem ≈ 200px,owner 2026-09-04 二次走查定),
 * 高度全走 h-control-md——NativeSelect 固定 md,按钮组因此也用 md 档而不是 sm。
 * 按钮组去掉槽内边距(p-0):分段上下填满外框、但不越过外框描边。
 */
const CONTROL_CLASS = "w-full max-w-media-3xl";
const SEGMENTED_CLASS = `${CONTROL_CLASS} p-0`;

export function PreferencesCard({
  draft,
  onChange,
  loading,
}: {
  readonly draft: PreferencesDraft;
  readonly onChange: (patch: Partial<PreferencesDraft>) => void;
  readonly loading: boolean;
}) {
  const t = useTranslations("profilePage");
  const tShell = useTranslations("shell");

  return (
    <Section
      tone="raised"
      level={2}
      icon="faders"
      title={t("cards.prefs.title")}
      description={t("cards.prefs.description")}
    >
      <CardRows>
        <DetailList className={DETAIL_LIST_CLASS}>
          <DetailRow label={t("fields.language")}>
            <NativeSelect
              wrapperClassName={CONTROL_CLASS}
              value={draft.language}
              disabled={loading}
              onChange={(event) => onChange({ language: event.target.value })}
              aria-label={t("fields.language")}
            >
              <option value="zh-CN">{t("language.zhCN")}</option>
              <option value="en-US">{t("language.enUS")}</option>
            </NativeSelect>
          </DetailRow>
          <DetailRow label={t("fields.timezone")}>
            <NativeSelect
              wrapperClassName={CONTROL_CLASS}
              value={draft.timezone}
              disabled={loading}
              onChange={(event) => onChange({ timezone: event.target.value })}
              aria-label={t("fields.timezone")}
            >
              <option value="">{t("prefs.timezoneUnset")}</option>
              {draft.timezone && !TIMEZONE_OPTIONS.includes(draft.timezone) ? (
                <option value={draft.timezone}>
                  {formatTimezone(draft.timezone, draft.timezone)}
                </option>
              ) : null}
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz} value={tz}>
                  {formatTimezone(tz, tz)}
                </option>
              ))}
            </NativeSelect>
          </DetailRow>
          <DetailRow label={t("prefs.theme")}>
            <SegmentedControl<ThemeChoice>
              size="md"
              fill
              className={SEGMENTED_CLASS}
              ariaLabel={t("prefs.theme")}
              value={draft.theme}
              onChange={(theme) => onChange({ theme })}
              items={[
                { value: "system", label: tShell("themeSystem") },
                { value: "light", label: tShell("themeLight") },
                { value: "dark", label: tShell("themeDark") },
              ]}
            />
          </DetailRow>
          <DetailRow label={t("prefs.density")}>
            <SegmentedControl<DensityChoice>
              size="md"
              fill
              className={SEGMENTED_CLASS}
              ariaLabel={t("prefs.density")}
              value={draft.density}
              onChange={(density) => onChange({ density })}
              items={[
                { value: "compact", label: tShell("densityCompact") },
                { value: "default", label: tShell("densityDefault") },
                { value: "comfortable", label: tShell("densityComfy") },
              ]}
            />
          </DetailRow>
          <DetailRow label={t("prefs.fontSize")}>
            <SegmentedControl<FontSizeChoice>
              size="md"
              fill
              className={SEGMENTED_CLASS}
              ariaLabel={t("prefs.fontSize")}
              value={draft.fontSize}
              onChange={(fontSize) => onChange({ fontSize })}
              items={[
                { value: "small", label: tShell("fontSmall") },
                { value: "default", label: tShell("fontDefault") },
                { value: "large", label: tShell("fontLarge") },
              ]}
            />
          </DetailRow>
        </DetailList>
      </CardRows>
    </Section>
  );
}
