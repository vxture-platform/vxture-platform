/**
 * refund-sources.ts - Integer-cent proportional refund allocation.
 * @package @vxture/service-subscription
 * @layer Domain
 * @category money
 * @author AI-Generated
 * @date 2026-11-19
 */
// ===========================================================================
// Settled source values and immutable refund targets
// ===========================================================================
export interface RefundSource {
  id: string;
  source: "online" | "offline" | "voucher" | "balance";
  cents: number;
  currency: string;
}
export interface RefundTarget extends RefundSource {
  targetCents: number;
}

// ===========================================================================
// Integer-cent policy and cash allocation
// ===========================================================================
/**
 * Allocate a rounded total using largest remainders and stable source IDs.
 * @param sources - Actual settled sources in integer cents.
 * @param alpha - Consumable cost share in [0,1].
 * @param usage - Consumed quota ratio in [0,1].
 * @returns Frozen targets whose sum equals the rounded total return value.
 * @throws {Error} When money or policy inputs cannot be proved valid.
 */
export function allocateRefundSources(
  sources: RefundSource[],
  alpha: number,
  usage: number,
): RefundTarget[] {
  if (
    ![alpha, usage].every((v) => Number.isFinite(v) && v >= 0 && v <= 1) ||
    new Set(sources.map((s) => s.id)).size !== sources.length ||
    sources.some(
      (s) =>
        !Number.isSafeInteger(s.cents) ||
        s.cents < 0 ||
        !["online", "offline", "voucher", "balance"].includes(s.source),
    )
  )
    throw new Error("Invalid refund sources or cost policy");
  // Six decimal places for each input preserve deterministic cost calculations.
  const scale = 1_000_000n;
  const denominator = scale * scale;
  const numerator =
    denominator -
    BigInt(Math.round(alpha * Number(scale))) *
      BigInt(Math.round(usage * Number(scale)));
  const rows = sources.map((s) => ({
    ...s,
    targetCents: Number((BigInt(s.cents) * numerator) / denominator),
    remainder: (BigInt(s.cents) * numerator) % denominator,
  }));
  const total = sources.reduce((sum, s) => sum + BigInt(s.cents), 0n);
  const target = Number((total * numerator + denominator / 2n) / denominator);
  let delta = target - rows.reduce((sum, s) => sum + s.targetCents, 0);
  for (const row of [...rows].sort((a, b) =>
    a.remainder === b.remainder
      ? a.id.localeCompare(b.id)
      : a.remainder > b.remainder
        ? -1
        : 1,
  )) {
    if (delta-- > 0) row.targetCents++;
  }
  return rows.map(({ remainder: _remainder, ...row }) => row);
}

/**
 * Allocate a chosen cash amount without crossing any original source cap.
 * @param sources - Cash payment sources only.
 * @param cents - Requested total cash refund.
 * @returns Per-source cash reservations.
 * @throws {Error} When the request exceeds actual cash receipts.
 */
export function allocateCashRefund(
  sources: RefundSource[],
  cents: number,
): RefundTarget[] {
  const total = sources.reduce((sum, s) => sum + s.cents, 0);
  if (
    !Number.isSafeInteger(cents) ||
    cents <= 0 ||
    cents > total ||
    !Number.isSafeInteger(total) ||
    new Set(sources.map((s) => s.id)).size !== sources.length ||
    sources.some(
      (s) =>
        (s.source !== "online" && s.source !== "offline") ||
        !Number.isSafeInteger(s.cents) ||
        s.cents < 0,
    )
  )
    throw new Error("Refund exceeds actual cash receipts");
  const rows = sources.map((s) => ({
    ...s,
    targetCents: Number((BigInt(s.cents) * BigInt(cents)) / BigInt(total)),
    remainder: (BigInt(s.cents) * BigInt(cents)) % BigInt(total),
  }));
  let delta = cents - rows.reduce((sum, s) => sum + s.targetCents, 0);
  for (const row of [...rows].sort((a, b) =>
    a.remainder === b.remainder
      ? a.id.localeCompare(b.id)
      : a.remainder > b.remainder
        ? -1
        : 1,
  ))
    if (delta-- > 0) row.targetCents++;
  return rows.map(({ remainder: _remainder, ...row }) => row);
}
