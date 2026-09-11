"use client";

/**
 * ProductMetricsSection.tsx — 产品计量指标的登记面。
 * @package @vxture/opera
 * @layer Presentation
 * @category Features - Product
 *
 * ── 为什么这一节存在 ──
 * 三个端点（`GET/POST/DELETE :id/metrics`）早就写好了，**界面一个字都没调**。
 * 于是「接一个要计量的产品」仍然要改 `seed-catalog.mjs` 再跑一次 db-init——而
 * db-init 要走审批门、要冻结合并。一个运营动作被做成了一次发版，这正是那三个端点
 * 当初存在的理由（见 opera-bff `listMetrics` 上方的注释）。
 *
 * 指标键是**跨仓契约**：产品按这个键上报用量（C3 consume），平台按这个键建配额池。
 * 键不存在时对方的 `POST /usage/consume` 直接拒收——所以它必须先于套餐配置存在。
 *
 * ── 为什么写成自足组件而不是直接铺在目录页里 ──
 * 产品详情单页（批 4）会把六组配置收进一页，这一节是其中之一。写成只认
 * `productId` + `canManage` 的组件，届时换个挂载点即可，不必重建；现在先挂在目录页
 * 的抽屉上，与当下的 IA 一致。
 *
 * ── 两组联动是「跟着改」不是「拦下来」 ──
 * `consumeMode` 仅 pool 型有、且 pool 型必填；`resetPeriod` 非 none 也仅 pool 型。
 * 切成非 pool 时把这两项一并归位并锁死，而不是让它们停在一个不合法的值上等提交报错
 * ——后者会让运营者看着一个自己没动过的字段被判错。同 `product/clients` 页公共客户端
 * 锁死 PKCE 的做法。
 */

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  ActionMenu,
  Badge,
  Button,
  DataTable,
  DialogForm,
  EmptyState,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Icon,
  Input,
  NativeSelect,
  useToast,
} from "@vxture/design-system";
import { useTableLabels } from "@/lib/table";
import { api, OperaApiError } from "@/lib/api";
import { RequiredMark } from "@/components/form/RequiredMark";

/** L0 平台级共享指标（只读）。 */
interface PlatformMetric {
  metricKey: string;
  kind: string | null;
  metricUnit: string | null;
  state: string | null;
}

export interface ProductMetric {
  metricKey: string;
  mergeStrategy: string;
  consumeMode: string | null;
  metricUnit: string | null;
  resetPeriod: string;
}

type MergeStrategy = "max" | "union" | "pool" | "tiered";

/** 合并策略的取值与「它是什么意思」。文案按运营者能判断的粒度写，不抄 DDL 注释。 */
const STRATEGIES: ReadonlyArray<{
  value: MergeStrategy;
  label: string;
  hint: string;
}> = [
  {
    value: "pool",
    label: "池（pool）",
    hint: "会消耗的额度：调用次数、字数、存储量。",
  },
  {
    value: "max",
    label: "取最大（max）",
    hint: "不消耗的上限：成员数、数据源数。",
  },
  {
    value: "union",
    label: "并集（union）",
    hint: "开关或枚举集合。",
  },
  {
    value: "tiered",
    label: "取最高档（tiered）",
    hint: "非数值能力，取最高档。",
  },
];

const RESET_PERIODS = [
  { value: "none", label: "不重置" },
  { value: "day", label: "每天" },
  { value: "month", label: "每月" },
] as const;

interface Draft {
  metricKey: string;
  mergeStrategy: MergeStrategy;
  consumeMode: string;
  metricUnit: string;
  resetPeriod: string;
}

const EMPTY_DRAFT: Draft = {
  metricKey: "",
  /* pool 是最常见的一档（要计量才来登记指标），也是唯一带子字段的一档——
     默认选它，子字段一上来就可见，运营者不会以为它们不存在。 */
  mergeStrategy: "pool",
  consumeMode: "divisible",
  metricUnit: "",
  resetPeriod: "month",
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

function describeError(error: unknown): string {
  return error instanceof OperaApiError && error.message
    ? error.message
    : "操作失败";
}

export interface ProductMetricsSectionProps {
  readonly productId: string;
  readonly productName: string;
  readonly canManage: boolean;
}

export function ProductMetricsSection({
  productId,
  productName,
  canManage,
}: ProductMetricsSectionProps) {
  const tShared = useTranslations();
  const { toast } = useToast();
  const tableLabels = useTableLabels();
  const [rows, setRows] = useState<ProductMetric[]>([]);
  const [platform, setPlatform] = useState<PlatformMetric[]>([]);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editing, setEditing] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const [mine, shared] = await Promise.all([
        api.get<ProductMetric[]>(`/api/products/${productId}/metrics`),
        /* 平台清单读不到不该挡住本产品的指标——它只是参考。 */
        api
          .get<PlatformMetric[]>("/api/products/platform-metrics")
          .catch(() => [] as PlatformMetric[]),
      ]);
      setRows(mine);
      setPlatform(shared);
      setLoad({ kind: "ready" });
    } catch (error) {
      setLoad({ kind: "error", message: describeError(error) });
    }
  }, [productId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const isPool = draft.mergeStrategy === "pool";

  /** 切策略时把两个子字段一并归位——不合法的组合不该有机会被提交。 */
  function pickStrategy(next: MergeStrategy) {
    setDraft({
      ...draft,
      mergeStrategy: next,
      consumeMode: next === "pool" ? draft.consumeMode || "divisible" : "",
      resetPeriod: next === "pool" ? draft.resetPeriod || "month" : "none",
    });
  }

  function openCreate() {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setDialogOpen(true);
  }

  function openEdit(row: ProductMetric) {
    setEditing(row.metricKey);
    setDraft({
      metricKey: row.metricKey,
      mergeStrategy: row.mergeStrategy as MergeStrategy,
      consumeMode: row.consumeMode ?? "",
      metricUnit: row.metricUnit ?? "",
      resetPeriod: row.resetPeriod,
    });
    setDialogOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      /* 指标键是**路径参数**不是 body 字段，方法是 PUT（按键 upsert）。
         这里最初写成 `POST /metrics` 带 metricKey——type-check 抓不到，因为
         api 的 body 是 unknown；只有真调一次才知道。 */
      const key = draft.metricKey.trim();
      await api.put(
        `/api/products/${productId}/metrics/${encodeURIComponent(key)}`,
        {
          mergeStrategy: draft.mergeStrategy,
          /* 非 pool 时**不带这两个字段**，而不是带一个空串：BFF 对
           「非 pool 却给了 consumeMode」是报错的，空串在 trim 之后虽然也会变 null，
           但显式不带更贴合「这一档没有这个概念」。 */
          ...(isPool ? { consumeMode: draft.consumeMode } : {}),
          metricUnit: draft.metricUnit.trim() || null,
          resetPeriod: isPool ? draft.resetPeriod : "none",
        },
      );
      toast({
        tone: "success",
        title: editing ? "指标已更新" : `${key} 已登记`,
      });
      setDialogOpen(false);
      await reload();
    } catch (error) {
      toast({
        tone: "danger",
        title: "保存失败",
        description: describeError(error),
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(metricKey: string) {
    setSubmitting(true);
    try {
      await api.delete(
        `/api/products/${productId}/metrics/${encodeURIComponent(metricKey)}`,
      );
      toast({ tone: "success", title: `${metricKey} 已退掉` });
      await reload();
    } catch (error) {
      /* 409 的消息里带着「被哪几个套餐档位引用着」，原样给出去——运营者要的是
         「去哪儿解开」，不是「失败了」。 */
      toast({
        tone: "danger",
        title: "退不掉",
        description: describeError(error),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-md">
      {load.kind === "loading" ? (
        <EmptyState title="读取中" description="正在读取已登记的指标。" />
      ) : load.kind === "error" ? (
        <EmptyState
          title="读取失败"
          description={`${load.message}。读不到不等于没有，请先解决读取失败。`}
        />
      ) : (
        <>
          {canManage ? (
            <div className="flex justify-end">
              <Button type="button" variant="outline" onClick={openCreate}>
                <Icon name="plus" size="sm" aria-hidden="true" />
                登记指标
              </Button>
            </div>
          ) : null}

          {/* 平台级共享指标：**这里登记的是产品自己的**，这几个已经有了，不要重来。
              owner 2026-09-11:「应该把平台的核心指标预写在清单……登记的是产品特有
              的指标，不能都从头来。」产品重定义这些键会被 409 拦下。 */}
          {platform.length > 0 ? (
            <div className="flex flex-col gap-xs rounded-md border border-border-soft bg-muted/30 p-sm">
              <span className="text-label-sm text-muted-foreground">
                平台级共享指标（已有，无需登记）
              </span>
              <div className="flex flex-wrap gap-xs">
                {platform.map((m) => (
                  <Badge
                    key={m.metricKey}
                    variant={m.state === "active" ? "outline" : "secondary"}
                  >
                    <span className="font-mono text-code-sm">
                      {m.metricKey}
                    </span>
                    {m.metricUnit ? ` · ${m.metricUnit}` : null}
                    {m.state === "reserved" ? " · 保留" : null}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          {rows.length === 0 ? (
            <EmptyState
              title="还没有登记任何指标"
              description={`${productName} 目前不计量。`}
            />
          ) : (
            <DataTable
              labels={tableLabels}
              rows={rows}
              rowKey={(r: ProductMetric) => r.metricKey}
              columns={[
                {
                  id: "metricKey",
                  header: "指标键",
                  cell: (r) => (
                    <span className="font-mono text-code-sm">
                      {r.metricKey}
                    </span>
                  ),
                },
                {
                  id: "strategy",
                  header: "合并策略",
                  cell: (r) => (
                    <div className="flex items-center gap-xs">
                      <Badge variant="outline">{r.mergeStrategy}</Badge>
                      {r.consumeMode ? (
                        <Badge variant="secondary">{r.consumeMode}</Badge>
                      ) : null}
                    </div>
                  ),
                },
                {
                  id: "unit",
                  header: "单位",
                  cell: (r) => r.metricUnit ?? "—",
                },
                {
                  id: "reset",
                  header: "重置",
                  cell: (r) =>
                    RESET_PERIODS.find((p) => p.value === r.resetPeriod)
                      ?.label ?? r.resetPeriod,
                },
              ]}
              rowActions={(r: ProductMetric) => (
                <ActionMenu
                  label={`${r.metricKey} 操作`}
                  disabled={!canManage || submitting}
                  items={[
                    {
                      id: "edit",
                      label: "编辑",
                      icon: "edit",
                      onSelect: () => openEdit(r),
                    },
                    {
                      id: "delete",
                      label: "退掉指标",
                      icon: "trash",
                      danger: true,
                      /* 分隔线不用手写:DS 12.5.0 起件自己认末尾那段连续的危险项。 */
                      confirm: {
                        verb: "退掉",
                        target: `指标 ${r.metricKey}`,
                        consequence:
                          "套餐里若还有引用这个键的配额项，会被拦下并告知是哪几档。",
                        onConfirm: () => void remove(r.metricKey),
                      },
                    },
                  ]}
                />
              )}
            />
          )}
        </>
      )}

      <DialogForm
        size="lg"
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? `编辑指标 · ${editing}` : "登记计量指标"}
        description="登记后，产品就可以按这个键上报用量，套餐也可以按这个键配额度。"
        submitLabel={editing ? "保存" : "登记"}
        submitting={submitting}
        submitDisabled={draft.metricKey.trim() === ""}
        onSubmit={submit}
        cancelLabel={tShared("actions.cancel")}
      >
        <FieldGroup>
          <Field orientation="labeled">
            <FieldLabel htmlFor="metric-key">
              指标键
              <RequiredMark />
            </FieldLabel>
            <Input
              id="metric-key"
              value={draft.metricKey}
              disabled={editing !== null}
              onChange={(e) =>
                setDraft({ ...draft, metricKey: e.target.value })
              }
              placeholder="doc.words"
              className="font-mono text-code-sm"
            />
            <FieldDescription>
              点号分段，如 <code>doc.words</code>。平台级共享键（
              <code>ai.credit</code> 等）不能在这里登记。
              {editing ? "登记后不可改。" : null}
            </FieldDescription>
          </Field>

          <Field orientation="labeled">
            <FieldLabel htmlFor="metric-strategy">
              合并策略
              <RequiredMark />
            </FieldLabel>
            <NativeSelect
              id="metric-strategy"
              value={draft.mergeStrategy}
              onChange={(e) => pickStrategy(e.target.value as MergeStrategy)}
            >
              {STRATEGIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
            <FieldDescription>
              {STRATEGIES.find((s) => s.value === draft.mergeStrategy)?.hint}
            </FieldDescription>
          </Field>

          {isPool ? (
            <>
              <Field orientation="labeled">
                <FieldLabel htmlFor="metric-consume">消耗模式</FieldLabel>
                <NativeSelect
                  id="metric-consume"
                  value={draft.consumeMode}
                  onChange={(e) =>
                    setDraft({ ...draft, consumeMode: e.target.value })
                  }
                >
                  <option value="divisible">可拆（divisible）</option>
                  <option value="atomic">整取（atomic）</option>
                </NativeSelect>
                <FieldDescription>
                  可拆：从多个池各扣一部分。整取：单池吃不下整笔就拒绝。
                </FieldDescription>
              </Field>

              <Field orientation="labeled">
                <FieldLabel htmlFor="metric-reset">重置周期</FieldLabel>
                <NativeSelect
                  id="metric-reset"
                  value={draft.resetPeriod}
                  onChange={(e) =>
                    setDraft({ ...draft, resetPeriod: e.target.value })
                  }
                >
                  {RESET_PERIODS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </NativeSelect>
                <FieldDescription>不重置 = 一次性额度。</FieldDescription>
              </Field>
            </>
          ) : null}

          <Field orientation="labeled">
            <FieldLabel htmlFor="metric-unit">单位</FieldLabel>
            <Input
              id="metric-unit"
              value={draft.metricUnit}
              onChange={(e) =>
                setDraft({ ...draft, metricUnit: e.target.value })
              }
              placeholder="words / calls / GB / seats"
            />
            <FieldDescription>仅展示用。</FieldDescription>
          </Field>
        </FieldGroup>
      </DialogForm>
    </div>
  );
}
