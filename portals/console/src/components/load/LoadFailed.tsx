"use client";

/**
 * LoadFailed — 页面级「读失败」显影(批 0b)。
 * @package @vxture/console
 * @layer Application
 * @category Component
 *
 * 此前各页取数走 `readJson`,失败一律回落成空数组 / 零值对象,页面把「后端挂了」
 * 画成「没有数据」甚至「0 B / 0 B」这种像真的假零。规范(platform/20-console
 * §状态设计)要求 Error 态:平白说明失败、保留上下文、暴露重试。这里给出两件:
 *   - `LoadFailedBanner`:页头下的横幅 + 重试;
 *   - `LoadFailedEmpty`:替换表格的空态,免得「读取失败」被画成「暂无记录」。
 * 页面自己持 `loadFailed`,指标在失败时显示「—」而不是 0。
 */

import { useTranslations } from "next-intl";
import { Banner, Button, EmptyState } from "@vxture/design-system";

export function LoadFailedBanner({
  onRetry,
  retrying = false,
}: {
  readonly onRetry: () => void;
  readonly retrying?: boolean;
}) {
  const t = useTranslations("loadState");
  return (
    <div className="flex flex-col gap-sm">
      <Banner tone="danger" title={t("title")} description={t("description")} />
      <div>
        <Button
          variant="outline"
          size="md"
          onClick={onRetry}
          disabled={retrying}
        >
          {t("retry")}
        </Button>
      </div>
    </div>
  );
}

export function LoadFailedEmpty() {
  const t = useTranslations("loadState");
  return <EmptyState icon="warning" title={t("empty")} />;
}
