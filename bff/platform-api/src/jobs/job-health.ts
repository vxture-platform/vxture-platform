/**
 * job-health.ts — 后台作业健康判定（#231 第二段，owner 2026-09-08 定「失败 + 静默」）。
 * @package @vxture/bff-platform-api
 *
 * ── 为什么「静默」比「失败」更值钱 ──
 * 作业**失败**会在 provisioning.background_jobs 留下 status='failed' + last_error，
 * 至少还有痕迹。作业**死掉**什么都不留——那一行只是停止更新，run_count 不涨、
 * failure_count 也不涨，看上去和「最近没事干」一模一样。今天没有任何东西盯着这件事，
 * 而它恰恰是最坏的一种坏法：整条自动化链停摆，界面上一切正常。
 *
 * 静默判据同时覆盖两种死法，因为都表现为 last_started_at 不再前进：
 *   · 停止调度（进程没了 / @Interval 没注册上）
 *   · 卡在某一轮里出不来（status 一直 'running'）
 * 所以判定**不看 status**，只看「上次开跑距今多久」。
 *
 * ── 阈值 ──
 * `max(3 × interval_ms, 5min)`：三个周期给足抖动余量；下限 5 分钟是为了 10s 级的
 * 高频作业——按 3×10s=30s 判，一次 GC 或一次慢查询就会误报。
 *
 * ── 启动宽限 ──
 * 所有作业都在同一个进程里（platform-api），`@Interval` 是**过了一个周期才首次触发**，
 * 不是启动即跑。所以刚重启那阵子，长周期作业的 last_started_at 还停在重启前，
 * 会被误判成静默。用本进程的运行时长兜一道：起来不足 STARTUP_GRACE_MS 不判静默。
 * （失败不受宽限影响——status='failed' 是上一轮的真实结论，重启不会让它变得不真。）
 */

/** 静默阈值的下限：高频作业按 3×interval 判会被抖动误伤。 */
export const STALL_FLOOR_MS = 5 * 60 * 1000;
/** 静默阈值 = max(STALL_MULTIPLIER × interval_ms, STALL_FLOOR_MS)。 */
export const STALL_MULTIPLIER = 3;
/** 本进程启动后多久才开始判静默——@Interval 首次触发要等满一个周期。 */
export const STARTUP_GRACE_MS = 10 * 60 * 1000;

export interface JobHealthRow {
  jobName: string;
  status: string;
  intervalMs: number | null;
  lastStartedAt: Date | null;
  lastError: string | null;
  failureCount: number;
}

export type JobVerdict = "ok" | "failed" | "stalled";

/**
 * 该作业的静默阈值（毫秒）。
 *
 * interval_ms 缺失 / 非法（历史行）时按 0 算，让下限单独决定——**不另设默认周期**:
 * 曾写过 `?? 60_000` 当兜底，但 3×60s=180s 恒小于 5 分钟下限，那个常量从来改变不了
 * 任何结果（2026-09-08 变异测试当场暴露:把它换成 0，10 条判据一条都没动）。
 * 看着在兜底、实际不做事的代码，比没有更坏。
 */
export function stallThresholdMs(intervalMs: number | null): number {
  const interval = intervalMs && intervalMs > 0 ? intervalMs : 0;
  return Math.max(STALL_MULTIPLIER * interval, STALL_FLOOR_MS);
}

/**
 * 判一行作业的健康。
 *
 * **静默优先于失败**：一个既 failed 又早就不动的作业，真正的问题是它不动了
 * ——报「上次失败」会让人去查那条 last_error，而那条错误可能是几天前的，
 * 与「现在整条停摆」根本不是同一件事。
 *
 * @param uptimeMs 本进程已运行多久；不足 STARTUP_GRACE_MS 时不判静默。
 */
export function classifyJob(
  row: JobHealthRow,
  now: number,
  uptimeMs: number,
): JobVerdict {
  const graced = uptimeMs < STARTUP_GRACE_MS;
  if (!graced && row.lastStartedAt) {
    const idle = now - row.lastStartedAt.getTime();
    if (idle > stallThresholdMs(row.intervalMs)) return "stalled";
  }
  if (row.status === "failed") return "failed";
  return "ok";
}
