/**
 * Monitoring settings wire types and partial override serialization.
 * @package @vxture/opera
 * @layer Presentation
 * @category types
 * @author AI-Generated
 * @date 2026-10-20
 */
export interface ProbeEffective {
  intervalMinutes: number;
  enabled: boolean;
  intervalSource: string;
  enabledSource: string;
}
export interface HealthOverride {
  subjectKind: string;
  subjectKey: string;
  probeIntervalMinutes: number | null;
  probeEnabled: boolean | null;
  balanceMinAmount: number | null;
  balanceMinDays: number | null;
  balancePollMinutes: number | null;
}
export interface HealthSettingsView {
  global: ProbeEffective;
  overrides: HealthOverride[];
  targets: (ProbeEffective & {
    modelCode: string;
    providerCode: string;
    probeSkipped: { reason: string } | null;
  })[];
  vendors: {
    providerCode: string;
    applicable: boolean;
    reason?: string;
    currency: string | null;
    minAmount: number | null;
    minDays: number;
    pollMinutes: number;
    minAmountSource: string;
    minDaysSource: string;
    pollMinutesSource: string;
  }[];
}
export interface HealthDraft {
  probeIntervalMinutes: string;
  probeEnabled: string;
  balanceMinAmount: string;
  balanceMinDays: string;
  balancePollMinutes: string;
}

/**
 * Serialize changed fields only; blank explicitly clears a stored override.
 * @param draft - Current input strings; zero is a meaningful threshold.
 * @param original - Initial strings loaded from the last successful server read.
 * @param balance - Whether the provider supports balance monitoring.
 * @returns A PATCH body with null for explicit clears.
 * @throws Error when a changed numeric input is not finite.
 */
export function healthSettingsPatch(
  draft: HealthDraft,
  original: HealthDraft,
  balance: boolean,
): Record<string, number | boolean | null> {
  const body: Record<string, number | boolean | null> = {};
  const keys: (keyof HealthDraft)[] = [
    "probeIntervalMinutes",
    "probeEnabled",
    ...(balance
      ? (["balanceMinAmount", "balanceMinDays", "balancePollMinutes"] as const)
      : []),
  ];
  for (const key of keys) {
    if (draft[key] === original[key]) continue;
    const raw = draft[key].trim();
    if (!raw) body[key] = null;
    else if (key === "probeEnabled") {
      if (raw !== "true" && raw !== "false")
        throw new Error("请选择开启、关闭或继承");
      body[key] = raw === "true";
    } else {
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error("请输入有效数字");
      body[key] = value;
    }
  }
  return body;
}

/** @returns Override inputs without converting inherited effective values into writes. */
export function healthSettingsDraft(row?: HealthOverride): HealthDraft {
  return {
    probeIntervalMinutes: row?.probeIntervalMinutes?.toString() ?? "",
    probeEnabled: row?.probeEnabled?.toString() ?? "",
    balanceMinAmount: row?.balanceMinAmount?.toString() ?? "",
    balanceMinDays: row?.balanceMinDays?.toString() ?? "",
    balancePollMinutes: row?.balancePollMinutes?.toString() ?? "",
  };
}
