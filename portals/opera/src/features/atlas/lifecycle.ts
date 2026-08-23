/**
 * lifecycle.ts — Atlas 注册表的生命周期语汇（推导状态 + 删除前置条件）。
 * @package @vxture/opera
 * @layer Presentation
 *
 * 这两件事贯穿 Provider / Model / Endpoint / Product Grant 四个页面，各写一份必然
 * 漂移——四份文案对同一个 409 说四种话，操作者要靠猜哪份是对的。
 *
 * 权威在 vxture-atlas `docs/30-design/110-management-plane.md`（第 1、2、3 条规则）
 * 与 `docs/20-specs/10-http-surface.md`「Lifecycle: deactivate, then delete」。本文件
 * 只做映射，不新增判断——尤其**不做前置的可删性预判**：能不能删由上游同一份数据源
 * 决定，前端再算一遍就是给同一个问题造第二个答案，而它一定会有和上游不一致的那天。
 */

import type { StatusBadgeTone } from "@vxture/design-system";
import { OperaApiError } from "@/lib/api";
import { isEnabled } from "./state";

/* ── 推导状态 ─────────────────────────────────────────────────────────────── */

/** Endpoint 当前实际在干什么，读时从它指向的模型推导。 */
export type EndpointResolutionState =
  | "disabled"
  | "unresolvable"
  | "degraded"
  | "serving";

export type ModelAvailability =
  | "available"
  | "model_inactive"
  | "provider_inactive"
  | "missing";

export interface EndpointModelRef {
  modelCode: string;
  availability: ModelAvailability;
}

/**
 * `degraded` 是 warning 不是 danger，这一档拿捏的是**调用仍然成功**：primary 倒了、
 * fallback 顶着。把它染成红色会让它和「调用正在失败」抢注意力，而两者该做的事完全
 * 不同——一个是尽快查 primary，一个是立刻止血。
 *
 * `disabled` 是 neutral：那是运营自己关的，不是故障。
 */
export const RESOLUTION_META: Record<
  EndpointResolutionState,
  { label: string; tone: StatusBadgeTone; hint: string }
> = {
  serving: {
    label: "服务中",
    tone: "success",
    hint: "primary 可服务。",
  },
  degraded: {
    label: "降级服务",
    tone: "warning",
    hint: "primary 服务不了，fallback 正顶着——调用仍然成功，但 failover 已经用掉了，此刻没有第二层。",
  },
  unresolvable: {
    label: "无法解析",
    tone: "danger",
    hint: "primary 与 fallback 都服务不了，走这个入口的调用正在失败。",
  },
  disabled: {
    label: "已停用",
    tone: "neutral",
    hint: "运营把它关了。模型或 Provider 的任何状态都不会覆盖这一档。",
  },
};

export const AVAILABILITY_META: Record<
  ModelAvailability,
  { label: string; tone: StatusBadgeTone }
> = {
  available: { label: "可服务", tone: "success" },
  model_inactive: { label: "模型已停用", tone: "warning" },
  /* 单列一档而不是并进 model_inactive：停用 Provider 以前对流量毫无影响，运营可以
     把一家供应商关掉、看着页面变灰、然后继续付钱给它。要能一眼看出是哪一层关的。 */
  provider_inactive: { label: "Provider 已停用", tone: "warning" },
  missing: { label: "模型不存在", tone: "danger" },
};

/**
 * 意图（`state`）与后果（`resolution`）**只在上游坏掉时才不一致**，而那正是唯一
 * 值得看的时刻。启用中却不在服务 = 有话要说。
 *
 * `resolution` 是**必填**的：Atlas 一直回它（2026-08-23 实测在产）。此前这里把它
 * 收成可选、缺失时返回 false，那是一层降级兜底——它把「上游没给这一维」渲染成
 * 「一切正常」，正是本轮要清掉的那类妥协。缺了就是契约破了，该由调用点报错。
 */
export function resolutionDivergesFromIntent(
  state: string,
  resolution: EndpointResolutionState,
): boolean {
  return isEnabled(state) && resolution !== "serving";
}

/* ── 上游字段缺失：**已不在这一层处理** ───────────────────────────────────────
 *
 * 这里曾经有三样东西：`formatDependentCount()`（计数缺失显示「—」）、
 * `deleteDescription()`（计数缺失就换一套「这台 Atlas 会级联删除」的危险文案）、
 * `STALE_ATLAS_HINT`（四页共用的"上游落后"说明）。2026-08-23 全部删除。
 *
 * 它们的共同问题是**把一个坏掉的契约渲染成一个正常的界面**：字段没了，页面不报错，
 * 只是换一种说法继续显示。当时的理由是"Atlas 是外部主机、本仓不钉它的版本"——理由
 * 成立，但结论错了。正确的结论不是"少了就换套说法"，而是"少了就说少了"。
 *
 * 现在由 opera-bff 的 `atlas-contract.ts` 在入口拦：必有字段缺失 → 502
 * `ATLAS_CONTRACT_FIELD_MISSING`，消息里点名是哪个资源缺哪个字段。页面拿到的是一条
 * 明确的读取失败，而不是一个自信地错着的界面。 */

/**
 * **整条端点 / 整根轴不存在**时的说明——与上面删掉的那三样**不是一回事**，这一条留着。
 *
 * 界线是「上游有没有明确说不」：
 *
 *   端点不存在 → 上游回 404 / 400，是它自己说的。如实转述 = 精准的错误提醒。
 *   字段缺失   → 上游回 200 + 一个缺胳膊的对象，没人说不。此时"如实"只能靠断言，
 *               而不是靠页面替它编一套说法。
 *
 * 所以用它的地方必须是**接住了一个真实的 404/400**，并且**绝不拿别的数据顶替**
 * （用量计量那处写得很清楚：不退回 tenant 数据冒充另一根轴）。
 */
export const STALE_ATLAS_HINT =
  "当前 Atlas 部署早于交付这项能力的版本（本仓不钉它的版本，它是外部主机）。升级 Atlas 后此处会自动恢复，不需要改门户。";

/* ── 删除前置条件 ─────────────────────────────────────────────────────────── */

/** Atlas 的稳定错误码。判它，不要判文案。 */
export const MUST_DEACTIVATE_FIRST = "MODEL_ADMIN_MUST_DEACTIVATE_FIRST";
export const HAS_DEPENDENTS = "MODEL_ADMIN_HAS_DEPENDENTS";

/**
 * 把删除失败翻译成「接下来该做什么」。
 *
 * 两条前置条件都是**拒绝**而不是级联：删除 Provider 曾经会级联软删它的模型、连带
 * 删掉那些模型上的每一条租户授权——一次点击撤销了租户从未同意交出的访问权。让调用
 * 方自己先清空，把那件事变成一个每步都可见、每步都可逆的序列。
 *
 * `blockedBy` 逐条点名，不是因为好看：只被告知「你不能」的操作者只能自己去翻是哪些
 * 东西还在引用它。
 */
export function describeDeleteFailure(error: unknown): {
  title: string;
  description: string;
} | null {
  if (!(error instanceof OperaApiError)) return null;

  if (error.code === MUST_DEACTIVATE_FIRST) {
    return {
      title: "要先停用才能删除",
      description:
        "任何东西都不会从「正在服务」一步变成「没了」。先停用，确认没有流量再回来删。",
    };
  }

  if (error.code === HAS_DEPENDENTS) {
    const blockers = error.blockedBy;
    return {
      title: "还有东西在引用它",
      description:
        blockers.length > 0
          ? `先处理这些再回来：${blockers.map((b) => `${b.label}（${b.type}）`).join("、")}`
          : error.message,
    };
  }

  return null;
}

/** 供 toast 直接展开：命中前置条件就用结构化文案，否则退回上游原文。 */
export function deleteFailureToast(
  error: unknown,
  fallbackTitle: string,
): { title: string; description?: string } {
  const described = describeDeleteFailure(error);
  if (described) return described;
  return {
    title: fallbackTitle,
    ...(error instanceof OperaApiError && error.message
      ? { description: error.message }
      : {}),
  };
}
