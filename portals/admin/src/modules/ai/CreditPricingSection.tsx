"use client";

/**
 * CreditPricingSection.tsx —— 积分换算/定价（ADR-014 PR3b）。
 *
 * 挂在「模型计价策略」页上，与供应商价目（price_rule，=我方付上游）并列，管的是另一侧：
 * token→credit 费率（=我方按 credit 向客户收多少）。按一个全局目标毛利，从每模型的供应商
 * 成本**逐维反推** credit 费率，使各模型毛利趋同（ADR-014）。
 *
 * 读：换算配置（锚价+目标毛利）、现行 credit 费率、atlas 供应商价目、模型表。
 * 写：改配置、按目标毛利推导、应用推导出的费率（经 admin-bff /api/credit-pricing，
 *     pricing:credit_rate.manage；缺权 BFF 回 403）。
 */

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ActionButton,
  Badge,
  Banner,
  Button,
  DataTable,
  DialogForm,
  EmptyState,
  Field,
  FieldLabel,
  Input,
  useToast,
} from "@vxture/design-system";
import type { DataTableColumn } from "@vxture/design-system";
import { useTableLabels } from "@/modules/shared/table";
import type { AiModelRecord, ModelPriceRuleRecord } from "@/entities/console";
import {
  applyCreditRate,
  deriveCreditRates,
  fetchAiModels,
  fetchCreditPricingConfig,
  fetchCreditRates,
  fetchModelPriceRules,
  updateCreditPricingConfig,
  type CreditPricingConfig,
  type CreditRateRecord,
  type DerivedCreditRate,
} from "@/api/admin-bff";

function errDesc(error: unknown): { description?: string } {
  return error instanceof Error && error.message
    ? { description: error.message }
    : {};
}

/** micro-credit/1K → credit/1K 文本（如 133333 → "0.133"）。 */
function creditPer1k(micro: string | undefined): string {
  if (!micro) return "—";
  return (Number(micro) / 1_000_000).toFixed(3);
}
/** micro-CNY/credit → ¥ 文本（200000 → "0.20"）。 */
function anchorYuan(micro: string): string {
  return (Number(micro) / 1_000_000).toFixed(2);
}

interface ModelRow {
  model: AiModelRecord;
  priceRule: ModelPriceRuleRecord | undefined;
  current: CreditRateRecord | undefined;
  derived: DerivedCreditRate | undefined;
}

export function CreditPricingSection() {
  const { toast } = useToast();
  const tableLabels = useTableLabels();

  const [config, setConfig] = useState<CreditPricingConfig | null>(null);
  const [rates, setRates] = useState<CreditRateRecord[]>([]);
  const [priceRules, setPriceRules] = useState<ModelPriceRuleRecord[]>([]);
  const [models, setModels] = useState<AiModelRecord[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [derivedByModel, setDerivedByModel] = useState<
    Record<string, DerivedCreditRate>
  >({});
  const [configOpen, setConfigOpen] = useState(false);
  const [anchorDraft, setAnchorDraft] = useState("0.20");
  const [marginDraft, setMarginDraft] = useState("70");

  async function reload() {
    try {
      const [cfg, rt, pr, md] = await Promise.all([
        fetchCreditPricingConfig(),
        fetchCreditRates(),
        fetchModelPriceRules({ includeInactive: false }),
        fetchAiModels(false),
      ]);
      setConfig(cfg);
      setRates(rt);
      setPriceRules(pr);
      setModels(md);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }
  useEffect(() => {
    void reload();
  }, []);

  /** 现行 credit 费率按 model_code 精确命中（否则留空＝走 provider/默认兜底）。 */
  const rateByModel = useMemo(() => {
    const m = new Map<string, CreditRateRecord>();
    for (const r of rates) if (r.model_code) m.set(r.model_code, r);
    return m;
  }, [rates]);
  const priceRuleByModelId = useMemo(() => {
    const m = new Map<string, ModelPriceRuleRecord>();
    for (const p of priceRules) if (!m.has(p.modelId)) m.set(p.modelId, p);
    return m;
  }, [priceRules]);

  const rows = useMemo<ModelRow[]>(
    () =>
      models.map((model) => ({
        model,
        priceRule: priceRuleByModelId.get(model.id),
        current: rateByModel.get(model.modelCode),
        derived: derivedByModel[model.modelCode],
      })),
    [models, priceRuleByModelId, rateByModel, derivedByModel],
  );

  /** 对所有有供应商价目的模型，按当前配置批量推导（服务端算，毛利按 target 收敛）。 */
  async function deriveAll() {
    const withCost = rows.filter((r) => r.priceRule);
    if (withCost.length === 0) {
      toast({ tone: "warning", title: "没有带供应商价目的模型可推导" });
      return;
    }
    setBusy(true);
    try {
      const res = await deriveCreditRates(
        withCost.map((r) => ({
          provider_code: r.model.provider,
          model_code: r.model.modelCode,
          unit_tokens: r.priceRule!.unitTokens,
          input_unit_price: r.priceRule!.inputUnitPrice,
          output_unit_price: r.priceRule!.outputUnitPrice,
          cached_input_unit_price: r.priceRule!.cachedInputUnitPrice,
        })),
      );
      const next: Record<string, DerivedCreditRate> = {};
      for (const d of res.derived) if (d.model_code) next[d.model_code] = d;
      setDerivedByModel(next);
      toast({
        tone: "success",
        title: `已按目标毛利 ${res.target_margin_bps / 100}% 推导 ${res.derived.length} 个模型`,
      });
    } catch (error) {
      toast({ tone: "danger", title: "推导失败", ...errDesc(error) });
    } finally {
      setBusy(false);
    }
  }

  async function apply(row: ModelRow) {
    const d = row.derived;
    if (!d) return;
    setBusy(true);
    try {
      await applyCreditRate({
        provider_code: d.provider_code,
        model_code: d.model_code,
        input_micro_per_1k: d.input_micro_per_1k,
        output_micro_per_1k: d.output_micro_per_1k,
        cache_write_micro_per_1k: d.cache_write_micro_per_1k,
        cache_read_micro_per_1k: d.cache_read_micro_per_1k,
        note: `换算面按目标毛利应用（${row.model.modelCode}）`,
      });
      toast({ tone: "success", title: `${row.model.modelCode} 费率已应用` });
      await reload();
    } catch (error) {
      toast({ tone: "danger", title: "应用失败", ...errDesc(error) });
    } finally {
      setBusy(false);
    }
  }

  async function saveConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const yuan = Number(anchorDraft);
    const pct = Number(marginDraft);
    if (!Number.isFinite(yuan) || yuan <= 0) {
      toast({ tone: "danger", title: "锚价要 > 0 的金额（元）" });
      return;
    }
    if (!Number.isFinite(pct) || pct < 0 || pct >= 100) {
      toast({ tone: "danger", title: "目标毛利要在 [0, 100) 之间（%）" });
      return;
    }
    setBusy(true);
    try {
      const cfg = await updateCreditPricingConfig({
        anchor_micro_cny_per_credit: Math.round(yuan * 1_000_000),
        target_margin_bps: Math.round(pct * 100),
      });
      setConfig(cfg);
      setConfigOpen(false);
      setDerivedByModel({}); // 配置变了，旧的推导作废
      toast({ tone: "success", title: "换算配置已更新" });
    } catch (error) {
      toast({ tone: "danger", title: "更新失败", ...errDesc(error) });
    } finally {
      setBusy(false);
    }
  }

  const columns: DataTableColumn<ModelRow>[] = [
    {
      id: "model",
      header: "模型",
      cell: (r) => (
        <span className="flex flex-col gap-2xs">
          <span>{r.model.modelName}</span>
          <span className="font-mono text-code-sm text-muted-foreground">
            {r.model.modelCode}
          </span>
        </span>
      ),
    },
    {
      id: "cost",
      header: "供应商成本（入/出 ¥/1M）",
      cell: (r) =>
        r.priceRule ? (
          <span className="text-body-sm">
            {r.priceRule.inputUnitPrice} / {r.priceRule.outputUnitPrice}
          </span>
        ) : (
          <Badge variant="outline">未采集</Badge>
        ),
    },
    {
      id: "current",
      header: "现行费率（入/出 cr/1K）",
      cell: (r) =>
        r.current ? (
          <span className="text-body-sm">
            {creditPer1k(r.current.input_micro_per_1k)} /{" "}
            {creditPer1k(r.current.output_micro_per_1k)}
          </span>
        ) : (
          <span className="text-body-sm text-muted-foreground">默认兜底</span>
        ),
    },
    {
      id: "derived",
      header: "推导（入/出 cr/1K）",
      cell: (r) =>
        r.derived ? (
          <span className="text-body-sm text-info-foreground">
            {creditPer1k(r.derived.input_micro_per_1k)} /{" "}
            {creditPer1k(r.derived.output_micro_per_1k)}
          </span>
        ) : (
          <span className="text-body-sm text-muted-foreground">—</span>
        ),
    },
    {
      id: "act",
      header: "",
      cell: (r) =>
        r.derived ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void apply(r)}
          >
            应用
          </Button>
        ) : null,
    },
  ];

  return (
    <section className="flex flex-col gap-md">
      {loadFailed ? (
        <Banner
          tone="danger"
          title="换算配置读取失败"
          description="多半是还没跑 2026-12-03 迁移/种子，或缺 pricing:credit_rate.read 能力。"
          action={
            <Button variant="secondary" onClick={() => void reload()}>
              重试
            </Button>
          }
        />
      ) : null}

      {/* 配置摘要 + 推导 */}
      <div className="flex flex-wrap items-center justify-between gap-sm rounded-md border border-border p-md">
        <div className="flex flex-col gap-2xs">
          <span className="text-body-sm text-muted-foreground">
            积分换算基准（ADR-014：按目标毛利逐维反推，各模型毛利趋同）
          </span>
          <span className="text-body">
            锚价{" "}
            <strong>
              ¥{config ? anchorYuan(config.anchor_micro_cny_per_credit) : "—"}
            </strong>{" "}
            / credit · 目标毛利{" "}
            <strong>
              {config ? (config.target_margin_bps / 100).toFixed(0) : "—"}%
            </strong>
          </span>
        </div>
        <div className="flex items-center gap-sm">
          <Button
            variant="outline"
            disabled={!config || busy}
            onClick={() => {
              if (config) {
                setAnchorDraft(anchorYuan(config.anchor_micro_cny_per_credit));
                setMarginDraft(String(config.target_margin_bps / 100));
              }
              setConfigOpen(true);
            }}
          >
            调整基准
          </Button>
          <ActionButton
            icon="workflow"
            disabled={busy}
            onClick={() => void deriveAll()}
          >
            按目标毛利推导
          </ActionButton>
        </div>
      </div>

      <DataTable
        labels={tableLabels}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.model.id}
        empty={
          <EmptyState
            title="暂无模型"
            description="先在模型服务里登记模型、在此页配供应商价目，再推导换算费率。"
          />
        }
      />

      {config ? (
        <p className="text-body-sm text-muted-foreground">
          没采集到供应商价目的模型推不出费率，调用时回落到默认兜底档（2K tokens
          = 1 credit）；要它们也按目标毛利计费，先在上方「供应商价目」里补价。
        </p>
      ) : null}

      <DialogForm
        open={configOpen}
        onOpenChange={setConfigOpen}
        size="sm"
        title="调整换算基准"
        description="锚价决定 1 credit 值多少钱；目标毛利决定各模型按什么比例收费。改完需重新推导。"
        submitLabel="保存"
        submitting={busy}
        onSubmit={saveConfig}
        cancelLabel="取消"
      >
        <Field>
          <FieldLabel htmlFor="cp-anchor">锚价（元 / credit）</FieldLabel>
          <Input
            id="cp-anchor"
            inputMode="decimal"
            value={anchorDraft}
            onChange={(e) => setAnchorDraft(e.target.value)}
            placeholder="0.20"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="cp-margin">目标毛利（%）</FieldLabel>
          <Input
            id="cp-margin"
            inputMode="decimal"
            value={marginDraft}
            onChange={(e) => setMarginDraft(e.target.value)}
            placeholder="70"
          />
        </Field>
      </DialogForm>
    </section>
  );
}
