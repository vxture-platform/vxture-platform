/**
 * credit-rate-derivation.ts —— 毛利均衡的积分换算推导（ADR-014）。
 * @package @vxture/bff-admin
 * @layer BFF
 *
 * 把「每模型供应商成本」按一个全局目标毛利反推成「每模型 token→credit 费率」，使各模型
 * 毛利趋同。性质（ADR-014 D3）：若**每一维**的 credit 费率 = 该维成本 ÷ ((1−m)×锚价)，
 * 则**每一维毛利都 = m**，于是总毛利 = m，与进/出/缓存的用量占比无关。
 *
 * 全程 BigInt、金额不走 float：供应商单价是十进制字符串（¥），锚价存 micro-CNY/credit
 * （¥0.20 = 200000），目标毛利存 bps（70% = 7000）。token_credit_rates 存 micro-credit/1K。
 * 取整只在最后一步、四舍五入——余下的偏差落在 owner 说的「大致趋近」里。
 */

/** 定价配置。锚价：1 credit 值多少钱，以 micro-CNY（¥/1e6）计。目标毛利：bps（0–10000）。 */
export interface PricingConfig {
  anchorMicroCnyPerCredit: bigint;
  targetMarginBps: number;
}

/** 正数四舍五入整除：`round(num/den)`。den > 0。 */
function divRoundHalfUp(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new Error("divRoundHalfUp: denominator must be > 0");
  return (num + den / 2n) / den;
}

/**
 * 非负十进制字符串（¥）→ 整数 micro-CNY（×1e6）。多于 6 位小数的部分**四舍五入**到 micro
 * （供应商单价一般 ≤8 位小数；超出的尾数对 micro 已不可见）。非法格式抛错。
 */
export function decimalCnyToMicro(value: string): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/u.exec(value.trim());
  if (!m) throw new Error(`not a non-negative decimal: ${value}`);
  const whole = BigInt(m[1]!);
  const fracRaw = m[2] ?? "";
  /* 取 7 位小数后用第 7 位四舍五入到 6 位（micro）。 */
  const frac7 = (fracRaw + "0000000").slice(0, 7);
  const micro6 = BigInt(frac7.slice(0, 6));
  const roundDigit = BigInt(frac7.slice(6, 7));
  return whole * 1_000_000n + micro6 + (roundDigit >= 5n ? 1n : 0n);
}

/**
 * 供应商单价（¥ per `unitTokens` 个 token）→ 每 1K token 的成本，以 micro-CNY 计。
 * `unitTokens` 一般是 1_000_000（atlas `model_price_rules.unit_tokens` 默认）。
 * cost_micro_cny_per_1k = unitPriceMicroCny × 1000 ÷ unitTokens（四舍五入到 micro）。
 */
export function vendorCostMicroCnyPer1k(
  unitPriceCny: string,
  unitTokens: number,
): bigint {
  if (!Number.isInteger(unitTokens) || unitTokens <= 0) {
    throw new Error(`unitTokens must be a positive integer: ${unitTokens}`);
  }
  const unitPriceMicro = decimalCnyToMicro(unitPriceCny);
  return divRoundHalfUp(unitPriceMicro * 1000n, BigInt(unitTokens));
}

/**
 * 成本（micro-CNY/1K）+ 配置 → credit 费率（micro-credit/1K）。
 *
 * 推导：收费(micro-CNY/1K) = 成本 ÷ (1−m)；而收费 = 费率(micro-credit/1K)/1e6 × 锚价。
 * ⇒ 费率 = 成本 × 1e6 × 10000 ÷ (锚价 × (10000 − bps))，四舍五入。
 *
 * bps 必须在 [0, 10000)；=10000（100% 毛利）无解（除零），拒绝。锚价必须 > 0。
 */
export function deriveRateMicroPer1k(
  costMicroCnyPer1k: bigint,
  cfg: PricingConfig,
): bigint {
  const { anchorMicroCnyPerCredit: anchor, targetMarginBps: bps } = cfg;
  if (anchor <= 0n) throw new Error("anchor must be > 0");
  if (!Number.isInteger(bps) || bps < 0 || bps >= 10000) {
    throw new Error(`targetMarginBps must be in [0, 10000): ${bps}`);
  }
  const numerator = costMicroCnyPer1k * 1_000_000n * 10000n;
  const denominator = anchor * BigInt(10000 - bps);
  return divRoundHalfUp(numerator, denominator);
}

/** atlas 供应商价目里，推导要用的那几维单价（十进制字符串 ¥，null = 未声明）。 */
export interface VendorFourDim {
  unitTokens: number;
  inputUnitPrice: string;
  outputUnitPrice: string;
  /** null = 未声明：缓存读回落 input 价（与 atlas 成本口径一致，只会高估不会低估）。 */
  cachedInputUnitPrice: string | null;
  /** null = 未声明：缓存写回落 input 价。 */
  cacheWriteUnitPrice: string | null;
}

/** token_credit_rates 的四维费率（micro-credit/1K），推导结果。 */
export interface DerivedFourDimRate {
  inputMicroPer1k: string;
  outputMicroPer1k: string;
  cacheReadMicroPer1k: string;
  cacheWriteMicroPer1k: string;
}

/**
 * 从一条供应商价目逐维推导出四维 credit 费率。缓存读/写未声明时按 input 价回落——与
 * atlas 的成本回落口径一致（宁可高估成本、从而少赚，也不凭空把缓存当免费而多赚）。
 */
export function deriveFourDimRate(
  vendor: VendorFourDim,
  cfg: PricingConfig,
): DerivedFourDimRate {
  const per = (unitPrice: string): string =>
    deriveRateMicroPer1k(
      vendorCostMicroCnyPer1k(unitPrice, vendor.unitTokens),
      cfg,
    ).toString();
  const cachedInput = vendor.cachedInputUnitPrice ?? vendor.inputUnitPrice;
  const cacheWrite = vendor.cacheWriteUnitPrice ?? vendor.inputUnitPrice;
  return {
    inputMicroPer1k: per(vendor.inputUnitPrice),
    outputMicroPer1k: per(vendor.outputUnitPrice),
    cacheReadMicroPer1k: per(cachedInput),
    cacheWriteMicroPer1k: per(cacheWrite),
  };
}
