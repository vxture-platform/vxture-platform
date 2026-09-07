/**
 * metric-label.ts — 计量指标键 → 展示名(配额页与用量页共用)。
 * @package @vxture/console
 * @layer Application
 * @category Lib
 *
 * 2026-09-07 走查发现:同一个 `ai.credit`,配额页照字典显示「AI Credits」,
 * 用量页的调用记录直接把**原始键**印在屏幕上。字典本来是 QuotasPage 里的私有
 * 常量,别的页看不见——所以第二个用它的页面自然就没用。收成一份放这儿,文案挪到
 * **顶层 `metric` 命名空间**(与 `role` 同法):两页读同一份,加一个指标改一处。
 *
 * 未知键回退原文:契约演进时新指标先出得来,不至于变成空白格。
 */

"use client";

import { useTranslations } from "next-intl";

/** 已知指标 → `metric` 命名空间下的键。 */
export const METRIC_LABEL_KEYS: Record<string, string> = {
  "storage.bytes": "storage",
  "ai.credit": "aiCredit",
  "service.api.call": "apiCall",
  "quality.check.run": "qualityCheck",
};

/** `(metric) => 展示名`;未知键回退原文。 */
export function useMetricLabel(): (metric: string) => string {
  const t = useTranslations("metric");
  return (metric: string): string => {
    const key = METRIC_LABEL_KEYS[metric];
    return key ? t(key) : metric;
  };
}
