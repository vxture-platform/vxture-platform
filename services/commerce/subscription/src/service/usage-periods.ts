/**
 * usage-periods.ts — 用量趋势的周期键生成与补零(纯函数)。
 * @package @vxture/service-subscription
 *
 * usage_summary_* 的桶边界全程 UTC(与 rollup / consume 的周期逻辑一致),所以
 * 窗口也在 UTC 里算:以「当前周期」为末桶,向前数 span 个桶。此前 BFF 用
 * `now() - interval` 当谓词、拿到哪几桶算哪几桶——没数据的天直接消失,页面
 * 「近 7 天」就变成「最后 7 个有数据的桶」(审计 P0 #8)。这里把键先算出来,
 * 查询只负责填数,缺的补零。
 *
 * ── 用户时区(owner 裁定 4,2026-10-04)──
 * 「用量日表时区,默认按照 UTC+0,如果用户设置了,按照用户设置时区」。天表键是
 * workspace 级共享、用户时区是 user 级,所以天表不改:day 档的键按 `zone` 里的
 * 「今天」起算日历日,读侧再从小时表按同一时区现场重切(窗口在
 * REBUCKET_HORIZON_DAYS 内才有小时数据可切,与 rollup 的天表重算窗口共用一个常量)。
 * 其余四档不看 zone:hour 桶本就与时区无关,周/月/年保持 UTC 权威。
 *
 * 日历步进用 `Date.UTC(y, m, d - i)`:在 UTC 轴上做整数天运算,不会碰到用户时区里
 * 23 / 25 小时的 DST 日——那一天在键序列里就是普通的一天,它有多少小时由 SQL 重切决定。
 */
import {
  USAGE_REBUCKET_HORIZON_DAYS,
  civilDateInZone,
} from "@vxture-platform/shared";
import type {
  UsageGranularity,
  UsageTrendBucket,
} from "../types/metering-read.types";

/**
 * 小时表能按用户时区重切的最远天数 = rollup 从小时表重算天表的窗口(hours → days
 * 的 `date - N`)。两处共用这一个常量:它们描述的是同一件事——「小时表里还有多少天
 * 被当作可靠来源」。rollup 文件 import 它,别在那里再写一个 35。
 */
export const REBUCKET_HORIZON_DAYS = USAGE_REBUCKET_HORIZON_DAYS;

const pad2 = (n: number): string => String(n).padStart(2, "0");

function utcDateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** ISO 周一(UTC):周日算上一周的第 7 天。 */
function isoMondayUtc(d: Date): Date {
  const day = d.getUTCDay(); // 0 = Sunday
  const back = day === 0 ? 6 : day - 1;
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back),
  );
}

/**
 * 窗口内全部周期键,升序,末项 = 当前周期。
 * hour: `YYYY-MM-DD HH:00` · day / week: `YYYY-MM-DD` · month: `YYYYMM` · year: `YYYY`
 *
 * `zone`(IANA 名,缺省 'UTC')只对 day 档生效:末项 = 该时区里的今天。调用方先用
 * isIanaTimeZone 校验——无效名 Intl 会抛 RangeError,这里不吞(吞了就是把 UTC 日
 * 贴上用户时区的标签)。
 */
export function usagePeriodKeys(
  granularity: UsageGranularity,
  span: number,
  now: Date = new Date(),
  zone: string = "UTC",
): string[] {
  const n = Math.max(1, Math.floor(span));
  const keys: string[] = [];
  switch (granularity) {
    case "hour": {
      const head = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        now.getUTCHours(),
      );
      for (let i = n - 1; i >= 0; i -= 1) {
        const d = new Date(head - i * 3_600_000);
        keys.push(`${utcDateKey(d)} ${pad2(d.getUTCHours())}:00`);
      }
      return keys;
    }
    case "day": {
      const today =
        zone === "UTC"
          ? {
              year: now.getUTCFullYear(),
              month: now.getUTCMonth() + 1,
              day: now.getUTCDate(),
            }
          : civilDateInZone(now, zone);
      for (let i = n - 1; i >= 0; i -= 1) {
        keys.push(
          utcDateKey(
            new Date(Date.UTC(today.year, today.month - 1, today.day - i)),
          ),
        );
      }
      return keys;
    }
    case "week": {
      const monday = isoMondayUtc(now).getTime();
      for (let i = n - 1; i >= 0; i -= 1) {
        keys.push(utcDateKey(new Date(monday - i * 7 * 86_400_000)));
      }
      return keys;
    }
    case "month": {
      for (let i = n - 1; i >= 0; i -= 1) {
        const d = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1),
        );
        keys.push(`${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}`);
      }
      return keys;
    }
    case "year": {
      for (let i = n - 1; i >= 0; i -= 1) {
        keys.push(String(now.getUTCFullYear() - i));
      }
      return keys;
    }
    default:
      return keys;
  }
}

/**
 * 窗口起点(首桶键)→ SQL 谓词绑定值:hour 给 ISO 时刻,day / week 给日期,
 * month / year 给与列同形的文本。
 */
export function usageWindowStart(
  granularity: UsageGranularity,
  firstKey: string,
): string {
  return granularity === "hour"
    ? `${firstKey.replace(" ", "T")}:00Z`
    : firstKey;
}

/**
 * day 档按用户时区重切时的**开区间右端**:末桶键的次日(`YYYY-MM-DD`)。
 * SQL 把它和首桶键各自在用户时区转成 timestamptz,`[from, toExclusive)` 恰好盖住
 * 窗口里每一个本地日——含 DST 切换日的 23 / 25 小时。
 */
export function usageWindowEndExclusive(lastKey: string): string {
  const [y, m, d] = lastKey.split("-").map(Number) as [number, number, number];
  return utcDateKey(new Date(Date.UTC(y, m - 1, d + 1)));
}

/** 把查询回来的(可能稀疏的)桶按键集补零并按键序排好。 */
export function zeroFillBuckets(
  keys: string[],
  rows: {
    period: string;
    productCode: string;
    productName: string;
    total: number;
  }[],
): UsageTrendBucket[] {
  const byPeriod = new Map<string, UsageTrendBucket>(
    keys.map((period) => [period, { period, total: 0, byProduct: [] }]),
  );
  for (const r of rows) {
    const bucket = byPeriod.get(r.period);
    if (!bucket) continue; // 键集之外的行(谓词与键集不同步时的保险)不入桶
    bucket.total += r.total;
    bucket.byProduct.push({
      productCode: r.productCode,
      productName: r.productName,
      total: r.total,
    });
  }
  return keys.map((k) => byPeriod.get(k)!);
}
