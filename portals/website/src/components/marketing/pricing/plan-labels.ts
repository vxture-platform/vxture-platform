/**
 * plan-labels.ts — 套餐机器键 → 展示文案
 * @package @vxture/website
 * @layer Presentation
 * @category Marketing / Pricing
 *
 * features / quota 里的键是机器键（governance.quality、member.max…），展示文案
 * 走 products.subscription.{featureLabels,quotaLabels,quotaValues} 词典；
 * 未收录的键**如实展示键名**而不是隐藏——与 console PlanSummaryCard 的判据
 * 一致：字典缺词是文案债，不是数据缺失。next-intl 以 `.` 作路径分隔，键名先
 * 折成 `_` 再查。
 */

import { useTranslations } from "next-intl";

/** 机器键 → 词典键（`governance.quality` → `governance_quality`） */
function toDictKey(key: string): string {
  return key.replace(/[^A-Za-z0-9_]/g, "_");
}

export function usePlanLabels() {
  const t = useTranslations("products.subscription");
  return {
    feature: (key: string): string => {
      const dictKey = `featureLabels.${toDictKey(key)}`;
      return t.has(dictKey) ? t(dictKey) : key;
    },
    quota: (key: string): string => {
      const dictKey = `quotaLabels.${toDictKey(key)}`;
      return t.has(dictKey) ? t(dictKey) : key;
    },
    /** 枚举型配额值（如 sync.frequency 的 realtime）按键 + 值查词典 */
    quotaValue: (key: string, value: string): string => {
      const dictKey = `quotaValues.${toDictKey(key)}.${toDictKey(value)}`;
      return t.has(dictKey) ? t(dictKey) : value;
    },
  };
}
