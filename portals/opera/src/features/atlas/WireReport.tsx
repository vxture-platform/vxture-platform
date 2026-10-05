"use client";

/**
 * WireReport.tsx — 一个模型**实际跑的**线协议描述符，以及每个键由哪一层定的。
 * @package @vxture/opera
 * @layer Presentation
 * @category Features - Atlas
 *
 * 存在的理由是 `behaviorVersion` 旁边的一个洞：它说「配置动了」，但想知道**动成了
 * 什么**，此前只能跑一次自检——而自检是真实上游调用、要烧 token。便宜的信号指向一个
 * 昂贵的答案，结果就是没人去问。atlas 2026-08-24 起直发 `resolvedWire`，这里把它接出来。
 *
 * 2026-10-05：从模型行的抽屉搬进「模型详情」二级页——它回答的是「这个模型实际跑什么」，
 * 本就属于这个模型自己的页面，不该是列表上一个一闪而过的抽屉。
 */

import { Banner, StatusBadge } from "@vxture/design-system";
import type { AiModelRecord, ModelProviderRecord } from "./model-service";

/**
 * 一个 wire 键的归属：值从 atlas 的 `resolvedWire` 来，来源只按**声明层的存在性**判定。
 *
 * 这条边界是刻意的。判断「谁声明了这个键」只需要看原始层里有没有这个 key——纯存在性，
 * 无歧义。而**算出生效值**要复刻 `applyOverlay` 的逐键合并语义，那是同一个事实的第二个
 * 实现，且失败方式是安静的：渲染出一个从来没有请求用过的描述符。
 */
type WireOrigin = "model" | "provider" | "merged" | "default";

const WIRE_ORIGIN_LABEL: Record<WireOrigin, string> = {
  model: "本模型覆盖",
  provider: "Provider 覆盖",
  /**
   * 对象类的键（`headers` / `supports` / `paramMap`）是**逐子键**合并的，所以多层
   * 同时声明时，生效值里每个子键可能来自不同的层。
   *
   * 实测过一个真实例子：`supports` 的四个子键分别来自三层——`temperature` 是协议
   * 默认、`topP` 来自 Provider、`tools`/`toolChoice` 被本模型改成 false。此时标
   * 「本模型覆盖」会让人以为整个值由模型定，那是**这个抽屉自己在撒谎**，而它存在的
   * 理由恰恰是消灭这种误读。
   */
  merged: "多层合并",
  default: "协议默认",
};

const WIRE_ORIGIN_TONE: Record<
  WireOrigin,
  "info" | "warning" | "neutral" | "danger"
> = {
  model: "info",
  provider: "warning",
  merged: "info",
  default: "neutral",
};

/** `config.wire` 里有没有这个键。不看值——值由上游合并后给出。 */
function declaresWireKey(
  config: Record<string, unknown> | null | undefined,
  key: string,
): boolean {
  const wire = config?.["wire"];
  if (typeof wire !== "object" || wire === null || Array.isArray(wire)) {
    return false;
  }
  return key in (wire as Record<string, unknown>);
}

function wireOriginOf(
  key: string,
  value: unknown,
  model: AiModelRecord,
  provider: ModelProviderRecord | undefined,
): WireOrigin {
  const byModel = declaresWireKey(model.config, key);
  const byProvider = declaresWireKey(provider?.config, key);

  /* 对象类的键逐子键合并，所以两层都声明时**没有哪一层"赢了"**——生效值里不同的
     子键来自不同的层，甚至还留着协议默认的那一份。标成任何单一来源都是误导。 */
  if (byModel && byProvider && value !== null && typeof value === "object") {
    return "merged";
  }
  /* 标量键才有"压过"这回事，顺序与上游一致：模型压 provider，provider 压协议默认。 */
  if (byModel) return "model";
  if (byProvider) return "provider";
  return "default";
}

/**
 * 值怎么显示。对象类的键（headers / supports / paramMap / extraBody）平铺成一行行
 * `k=v`。
 *
 * 子值用 `JSON.stringify` 而不是 `String`：前七个键的子值都是标量，`extraBody`
 * 的不是——DeepSeek 关思考的开关是 `thinking: {"type":"disabled"}`，`String()`
 * 会把它渲染成 `thinking=[object Object]`，也就是把唯一要看的那部分吃掉。
 */
function formatWireValue(value: unknown): string {
  if (value === null) return "—（用适配器默认）";
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length
      ? entries
          .map(
            ([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`,
          )
          .join("  ")
      : "—（空）";
  }
  return String(value);
}

export function WireReport({
  model,
  provider,
}: {
  readonly model: AiModelRecord;
  readonly provider: ModelProviderRecord | undefined;
}) {
  const wire = model.resolvedWire;
  const rows: ReadonlyArray<{ key: string; value: unknown }> = [
    { key: "chatPath", value: wire.chatPath },
    { key: "auth", value: wire.authStyle },
    { key: "streamUsage", value: wire.streamUsage },
    { key: "headers", value: wire.headers },
    { key: "supports", value: wire.supports },
    { key: "paramMap", value: wire.paramMap },
    /* v2 加的第八个键。它此前不在这张表里，于是一个靠 `extraBody` 才跑得起来的
       模型（关掉思考的 DeepSeek）在这个抽屉里看不到自己真正的开关——抽屉存在的
       理由是「实际跑什么」，少一个键就是把它变回一句半真话。 */
    { key: "extraBody", value: wire.extraBody },
  ];

  return (
    <div className="flex flex-col gap-md">
      <Banner
        tone="info"
        title="这是生效值，不是声明值"
        description={`协议默认 ← Provider 的 config.wire ← 本模型的，三层叠加后的结果，由 Atlas 合并（wire schema v${wire.schemaVersion}）。标签指出每个键由哪一层声明——那是存在性判断；合并本身不在门户做，逐键合并的语义只有一份，在上游。`}
      />
      <dl className="flex flex-col gap-sm">
        {rows.map((r) => {
          const origin = wireOriginOf(r.key, r.value, model, provider);
          return (
            <div
              key={r.key}
              className="flex flex-col gap-2xs rounded-md border border-border p-sm"
            >
              <div className="flex items-center justify-between gap-sm">
                <dt className="font-mono text-code-sm">{r.key}</dt>
                <StatusBadge tone={WIRE_ORIGIN_TONE[origin]} dot>
                  {WIRE_ORIGIN_LABEL[origin]}
                </StatusBadge>
              </div>
              <dd className="font-mono text-code-sm break-all text-muted-foreground">
                {formatWireValue(r.value)}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
