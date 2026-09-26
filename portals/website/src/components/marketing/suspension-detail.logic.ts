/**
 * suspension-detail.logic.ts - 暂停详情弹窗的两段算式
 * @package @vxture/website
 * @layer Presentation
 * @category Logic
 *
 * 从 `SuspensionDetailDialog.tsx` 抽出来。抽的理由不是复用（只有一个调用方），是**可测**：
 * 弹窗本身引了 `useRouter`，那条 import 链会把 `next-intl/navigation → next/navigation`
 * 拖进纯 node 的测试环境（解析不了）。而真正会错且不报错的恰恰只有这两段算式。
 *
 * ① 倒计时过点之后落回 null，**不翻负数**。终点是运营填的**估计**，不是平台的承诺；
 *    估计错了是常事，界面不该把它演成一个承诺被违背的样子。
 * ② 「已暂停 N 天」**向上取整到 1**，与顺延的取整口径一致——两处取整不同，客户会看到
 *    「已暂停 0 天」却被顺延了 1 天。
 */

/** 整天数，向上取整到 1——停了两小时也算「已暂停 1 天」。 */
export function daysSince(iso: string): number {
  const started = Date.parse(iso);
  if (!Number.isFinite(started)) return 0;
  return Math.max(1, Math.ceil((Date.now() - started) / 86_400_000));
}

/** 剩余时长 `2d 3h` / `5h 30m` / `20m`；已过点或解析不出来返回 null。 */
export function remainingUntil(iso: string | null): string | null {
  if (!iso) return null;
  const target = Date.parse(iso);
  if (!Number.isFinite(target)) return null;
  const ms = target - Date.now();
  if (ms <= 0) return null;
  const totalMinutes = Math.floor(ms / 60_000);
  const d = Math.floor(totalMinutes / 1440);
  const h = Math.floor((totalMinutes % 1440) / 60);
  const m = totalMinutes % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
