/**
 * maintenance-detail.logic.ts - 产品「升级维护中」弹窗的倒计时算式
 * @package @vxture/website
 * @layer Presentation
 * @category Logic
 *
 * 与 suspension-detail.logic 同一个抽法：弹窗本身引了 `useRouter`，那条 import 链在纯 node
 * 的测试环境解析不了；而会错且**不报错**的恰恰只有这一段算式。
 *
 * 形态与订阅冻结弹窗不同：那扇窗显示到分钟（`2d 3h`），这扇窗要走秒、一格一位
 * （owner 2026-09-28：「大字号倒计时框」）。所以这里吐的是**两位数字串**，不是可读句。
 *
 * 三条判据：
 * ① 终点是运营填的估计。过点**不翻负数**，落到 `elapsed`，界面改说「恢复时间已到，正在
 *    收尾」——估计错了是常事，不该演成一个承诺被违背的样子。
 * ② 整天拆出去：小时恒 < 24，两位方格永远放得下；天数由界面另写「{d} 天」。
 * ③ 秒向上取整：剩 0.5 秒显示 00:00:01 而不是 00:00:00——「还有 0 秒」与「已到」是
 *    两个状态，不该同时成立。
 */

export interface MaintenanceCountdown {
  /** 整天数；≥1 时界面在方格前另写「{d} 天」。 */
  days: number;
  /** 两位数字串（"02"），方格一格一位。 */
  hours: string;
  minutes: string;
  seconds: string;
}

export type MaintenanceCountdownState =
  /** `until` 解析不出来：没有终点就没有倒计时，界面不画这一段。 */
  | { kind: "invalid" }
  /** 已过点。 */
  | { kind: "elapsed" }
  | ({ kind: "running" } & MaintenanceCountdown);

const two = (n: number): string => String(n).padStart(2, "0");

/** 距 `untilIso` 还有多久，按 `nowMs` 算。纯函数：时刻由调用方给，便于测。 */
export function maintenanceCountdown(
  untilIso: string,
  nowMs: number,
): MaintenanceCountdownState {
  const target = Date.parse(untilIso);
  if (!Number.isFinite(target)) return { kind: "invalid" };
  const ms = target - nowMs;
  if (ms <= 0) return { kind: "elapsed" };
  const totalSeconds = Math.ceil(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const rest = totalSeconds % 86_400;
  return {
    kind: "running",
    days,
    hours: two(Math.floor(rest / 3600)),
    minutes: two(Math.floor((rest % 3600) / 60)),
    seconds: two(rest % 60),
  };
}
