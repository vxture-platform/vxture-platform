"use client";

/**
 * Existing Atlas monitoring settings on the model-service detail pages.
 * @package @vxture/opera
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-10-20
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Banner,
  Button,
  Field,
  FieldLabel,
  Input,
  NativeSelect,
  Section,
} from "@vxture/design-system";
import { api, OperaApiError } from "@/lib/api";
import {
  HealthSettingsInputError,
  healthSettingsDraft,
  healthSettingsPatch,
  type HealthDraft,
  type HealthSettingsView,
} from "./health-settings";

// ============================================================================
// Settings loaded from Atlas; fields always edit overrides, never effective values
// ============================================================================

export function HealthSettingsPanel({
  kind,
  subjectKey,
  canManage,
}: {
  readonly kind: "model" | "provider";
  readonly subjectKey: string;
  readonly canManage: boolean;
}) {
  const t = useTranslations("atlasHealthSettings");
  const [view, setView] = useState<HealthSettingsView | null>(null);
  const [original, setOriginal] = useState(healthSettingsDraft());
  const [draft, setDraft] = useState(healthSettingsDraft());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    setLoaded(false);
    try {
      const data = await api.get<HealthSettingsView>(
        `/api/atlas/health-settings?kind=${kind}`,
      );
      if (
        !data.global ||
        !Array.isArray(data.targets) ||
        !Array.isArray(data.vendors) ||
        !Array.isArray(data.overrides)
      )
        throw new Error(t("invalidResponse"));
      const next = healthSettingsDraft(
        data.overrides.find(
          (r) => r.subjectKind === kind && r.subjectKey === subjectKey,
        ),
      );
      setView(data);
      setOriginal(next);
      setDraft(next);
      setError("");
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("readFailed"));
    }
  }, [kind, subjectKey, t]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const vendor =
    kind === "provider"
      ? view?.vendors.find((v) => v.providerCode === subjectKey)
      : undefined;
  const target =
    kind === "model"
      ? view?.targets.find((m) => m.modelCode === subjectKey)
      : undefined;
  const balance = vendor?.applicable === true;
  const override = view?.overrides.find(
    (r) => r.subjectKind === kind && r.subjectKey === subjectKey,
  );
  const interval =
    target?.intervalMinutes ??
    (kind === "provider"
      ? (override?.probeIntervalMinutes ?? view?.global.intervalMinutes)
      : undefined);
  const intervalSource =
    target?.intervalSource ??
    (override?.probeIntervalMinutes != null
      ? "provider"
      : view?.global.intervalSource);
  const enabled =
    target?.enabled ?? override?.probeEnabled ?? view?.global.enabled;
  const enabledSource =
    target?.enabledSource ??
    (override?.probeEnabled != null ? kind : view?.global.enabledSource);
  const input = (
    key: keyof HealthDraft,
    label: string,
    min: number,
    max?: number,
  ) => (
    <Field key={key}>
      <FieldLabel htmlFor={`health-${kind}-${key}`}>
        {t("inheritHint", { label })}
      </FieldLabel>
      <Input
        id={`health-${kind}-${key}`}
        type="number"
        min={min}
        {...(max !== undefined ? { max } : {})}
        step={key === "balanceMinAmount" ? "any" : "1"}
        value={draft[key]}
        disabled={!canManage || saving}
        onChange={(e) => setDraft((old) => ({ ...old, [key]: e.target.value }))}
      />
    </Field>
  );
  async function save() {
    setSaving(true);
    setError("");
    try {
      const body = healthSettingsPatch(draft, original, balance);
      if (Object.keys(body).length)
        await api.patch(
          `/api/atlas/health-settings/${encodeURIComponent(`${kind}:${subjectKey}`)}`,
          body,
        );
      await reload();
    } catch (e) {
      setError(
        e instanceof OperaApiError
          ? `${e.code ?? ""}: ${e.message}`
          : e instanceof HealthSettingsInputError
            ? t(`errors.${e.code}`)
            : e instanceof Error
              ? e.message
              : t("saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  }

  // ============================================================================
  // Display applicability and source before exposing writable controls
  // ============================================================================

  return (
    <Section title={t("title")} level={2}>
      {error ? <Banner tone="danger" title={error} /> : null}
      {!view ? (
        <Button type="button" variant="secondary" onClick={() => void reload()}>
          {t("reload")}
        </Button>
      ) : (
        <>
          {kind === "provider" || target ? (
            <p>
              {t("effectiveProbe", {
                interval: interval ?? "",
                intervalSource: intervalSource ?? "",
                enabled: enabled ? t("enabled") : t("disabled"),
                enabledSource: enabledSource ?? "",
              })}
            </p>
          ) : null}
          {kind === "model" && !target ? <p>{t("notTargeted")}</p> : null}
          {target?.probeSkipped ? (
            <p>{t("probeSkipped", { reason: target.probeSkipped.reason })}</p>
          ) : null}
          <div className="grid gap-md md:grid-cols-2">
            {input("probeIntervalMinutes", t("probeInterval"), 5, 60)}
            {kind === "model" ? (
              <Field>
                <FieldLabel htmlFor="health-probe-enabled">
                  {t("probeEnabled")}
                </FieldLabel>
                <NativeSelect
                  id="health-probe-enabled"
                  value={draft.probeEnabled}
                  disabled={!canManage || saving}
                  onChange={(e) =>
                    setDraft((old) => ({
                      ...old,
                      probeEnabled: e.target.value,
                    }))
                  }
                >
                  <option value="">{t("inherit")}</option>
                  <option value="true">{t("enabled")}</option>
                  <option value="false">{t("disabled")}</option>
                </NativeSelect>
              </Field>
            ) : null}
            {balance ? (
              <>
                {input(
                  "balanceMinAmount",
                  t("balanceMinAmount", {
                    currency: vendor.currency ?? t("vendorCurrency"),
                  }),
                  0,
                )}
                {input("balanceMinDays", t("balanceMinDays"), 0, 30)}
                {input("balancePollMinutes", t("balancePollMinutes"), 15, 1440)}
              </>
            ) : null}
          </div>
          {vendor ? (
            balance ? (
              <p>
                {t("effectiveBalance", {
                  amount: vendor.minAmount ?? t("notSet"),
                  amountSource: vendor.minAmountSource,
                  days: vendor.minDays,
                  daysSource: vendor.minDaysSource,
                  minutes: vendor.pollMinutes,
                  minutesSource: vendor.pollMinutesSource,
                })}
              </p>
            ) : (
              <p>
                {t("balanceUnsupported", {
                  reason: vendor.reason ?? t("balanceUnavailable"),
                })}
              </p>
            )
          ) : null}
          {canManage ? (
            <Button
              type="button"
              disabled={
                saving ||
                !loaded ||
                JSON.stringify(draft) === JSON.stringify(original)
              }
              onClick={() => void save()}
            >
              {saving ? t("saving") : t("save")}
            </Button>
          ) : null}
        </>
      )}
    </Section>
  );
}
