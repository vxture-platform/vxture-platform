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
        throw new Error("监测设置响应不完整");
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
      setError(e instanceof Error ? e.message : "监测设置读取失败");
    }
  }, [kind, subjectKey]);
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
        {label}（留空继承）
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
          ? `${e.code ?? ""}：${e.message}`
          : e instanceof Error
            ? e.message
            : "保存失败",
      );
    } finally {
      setSaving(false);
    }
  }

  // ============================================================================
  // Display applicability and source before exposing writable controls
  // ============================================================================

  return (
    <Section title="服务监测设置" level={2}>
      {error ? <Banner tone="danger" title={error} /> : null}
      {!view ? (
        <Button type="button" variant="secondary" onClick={() => void reload()}>
          重新读取监测设置
        </Button>
      ) : (
        <>
          {kind === "provider" || target ? (
            <p>
              当前探测间隔：{interval} 分钟（{intervalSource}）；探测：
              {enabled ? "开启" : "关闭"}（{enabledSource}）。
            </p>
          ) : null}
          {kind === "model" && !target ? (
            <p>该模型当前不在探测目标中；保存覆盖不会自动启用模型或路由。</p>
          ) : null}
          {target?.probeSkipped ? (
            <p>当前跳过探测：{target.probeSkipped.reason}</p>
          ) : null}
          <div className="grid gap-md md:grid-cols-2">
            {input("probeIntervalMinutes", "主动探测间隔（5–60 分钟）", 5, 60)}
            {kind === "model" ? (
              <Field>
                <FieldLabel htmlFor="health-probe-enabled">是否探测</FieldLabel>
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
                  <option value="">继承</option>
                  <option value="true">开启</option>
                  <option value="false">关闭</option>
                </NativeSelect>
              </Field>
            ) : null}
            {balance ? (
              <>
                {input(
                  "balanceMinAmount",
                  `余额最低额度（${vendor.currency ?? "厂商币种"}，0 关闭）`,
                  0,
                )}
                {input("balanceMinDays", "预计可用天数（0–30，0 关闭）", 0, 30)}
                {input(
                  "balancePollMinutes",
                  "余额查询间隔（15–1440 分钟）",
                  15,
                  1440,
                )}
              </>
            ) : null}
          </div>
          {vendor ? (
            balance ? (
              <p>
                当前余额阈值：{vendor.minAmount ?? "未设"}（
                {vendor.minAmountSource}）；天数：{vendor.minDays}（
                {vendor.minDaysSource}）；查询：{vendor.pollMinutes} 分钟（
                {vendor.pollMinutesSource}）。
              </p>
            ) : (
              <p>
                余额监测不适用：
                {vendor.reason ?? "厂商未提供可用的余额读取能力"}
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
              {saving ? "保存中…" : "保存监测设置"}
            </Button>
          ) : null}
        </>
      )}
    </Section>
  );
}
