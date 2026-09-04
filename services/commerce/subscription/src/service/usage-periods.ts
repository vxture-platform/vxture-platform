/**
 * usage-periods.ts — 用量趋势的周期键(UTC)生成与补零(纯函数)。
 * @package @vxture/service-subscription
 *
 * usage_summary_* 的桶边界全程 UTC(与 rollup / consume 的周期逻辑一致),所以
 * 窗口也在 UTC 里算:以「当前周期」为末桶,向前数 span 个桶。此前 BFF 用
 * `now() - interval` 当谓词、拿到哪几桶算哪几桶——没数据的天直接消失,页面
 * 「近 7 天」就变成「最后 7 个有数据的桶」(审计 P0 #8)。这里把键先算出来,
 * 查询只负责填数,缺的补零。
 */
import type {
  UsageGranularity,
  UsageTrendBucket,
} from "../types/metering-read.types";

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
 */
export function usagePeriodKeys(
  granularity: UsageGranularity,
  span: number,
  now: Date = new Date(),
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
      const head = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
      );
      for (let i = n - 1; i >= 0; i -= 1) {
        keys.push(utcDateKey(new Date(head - i * 86_400_000)));
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
