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
import { useTranslations } from "next-intl";
import type { AiModelRecord, ModelProviderRecord } from "./model-service";

/**
 * 一个 wire 键的归属：值从 atlas 的 `resolvedWire` 来，来源只按**声明层的存在性**判定。
 *
 * 这条边界是刻意的。判断「谁声明了这个键」只需要看原始层里有没有这个 key——纯存在性，
 * 无歧义。而**算出生效值**要复刻 `applyOverlay` 的逐键合并语义，那是同一个事实的第二个
 * 实现，且失败方式是安静的：渲染出一个从来没有请求用过的描述符。
 */
type WireOrigin = "model" | "provider" | "merged" | "default";

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
function formatWireValue(
  value: unknown,
  labels: { defaultValue: string; emptyValue: string },
): string {
  if (value === null) return labels.defaultValue;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length
      ? entries
          .map(
            ([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`,
          )
          .join("  ")
      : labels.emptyValue;
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
  const t = useTranslations("modelDetailPage.wire.report");
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
    { key: "thinking", value: wire.thinking },
    { key: "contextOverflow", value: wire.contextOverflow },
  ];

  return (
    <div className="flex flex-col gap-md">
      <Banner
        tone="info"
        title={t("title")}
        description={t("description", { version: wire.schemaVersion })}
      />
      <dl className="flex flex-col gap-sm">
        {rows.map((r) => {
          const origin = wireOriginOf(r.key, r.value, model, provider);
          const isModeMap = r.key === "thinking";
          const isOverflow = r.key === "contextOverflow";
          const isJson = isModeMap || isOverflow;
          return (
            <div
              key={r.key}
              className="flex flex-col gap-2xs rounded-md border border-border p-sm"
            >
              <div className="flex items-center justify-between gap-sm">
                <dt className="font-mono text-code-sm">{r.key}</dt>
                <StatusBadge
                  tone={isOverflow ? "info" : WIRE_ORIGIN_TONE[origin]}
                  dot
                >
                  {isOverflow ? t("accumulated") : t(`origin.${origin}`)}
                </StatusBadge>
              </div>
              <dd className="font-mono text-code-sm whitespace-pre-wrap break-all text-muted-foreground">
                {isJson
                  ? r.value === undefined
                    ? t("unavailable")
                    : JSON.stringify(r.value, null, 2)
                  : formatWireValue(r.value, {
                      defaultValue: t("defaultValue"),
                      emptyValue: t("emptyValue"),
                    })}
                {isJson ? (
                  <p className="mt-2xs font-sans text-caption">
                    {t(isModeMap ? "thinkingHint" : "contextOverflowHint")}
                  </p>
                ) : null}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
