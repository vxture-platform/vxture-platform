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

/** 意图（isActive）与后果（resolution）**只在上游坏掉时才不一致**，而那正是唯一
 *  值得看的时刻。启用中却不在服务 = 有话要说。
 *
 *  上游没回 `resolution` 时（部署的 Atlas 落后于契约）返回 false：不知道不等于
 *  出事，把「读不到」渲染成告警和把它渲染成正常一样是在编。 */
export function resolutionDivergesFromIntent(
  isActive: boolean,
  resolution: EndpointResolutionState | undefined,
): boolean {
  return isActive && resolution !== undefined && resolution !== "serving";
}

/* ── 上游字段缺失 ─────────────────────────────────────────────────────────────
 *
 * Atlas 是外部主机，本仓不钉它的版本，所以「契约里有」不等于「线上这台回」。下面
 * 这些字段都是 2026-08 才加的，缺失时**一律显示成「未知」而不是 0 / 正常**。
 *
 * 这不是过度防御，是同一条规则的另一面：一个显示 0 而删除回 409 的计数列，比没有
 * 这一列更糟——它教会操作者不信这个页面。把 undefined 也画成 0 就是在造那种列。 */

/** 计数列的显示值。undefined = 这台 Atlas 还没回这个字段。 */
export function formatDependentCount(count: number | undefined): string {
  return count === undefined ? "—" : String(count);
}

/**
 * 这台 Atlas 到底有没有删除前置条件——**危险文案必须问过这个再说话**。
 *
 * 依赖计数（`modelCount` / `endpointRefCount`）和两条前置条件是同一个提交
 * （vxture-atlas#173）一起加进来的，所以「行上有没有那个计数」就是「删除会不会先
 * 拒绝」的可靠判据，不需要真去删一次来试探。
 *
 * 判错的代价是不对称的，所以默认取严：字段缺失时按**旧版级联行为**说话。反过来
 * ——在一台真会级联的 Atlas 上写着「不会级联删除任何东西」——等于用文案怂恿人点
 * 下去，而那一下会撤销租户从未同意交出的访问权。旧文案只是过时，这种是骗。
 *
 * @param marker 该资源行上、随 #173 一起出现的那个计数字段
 */
export function deleteDescription(
  marker: number | undefined,
  enforced: string,
  legacyCascade: string,
): string {
  return marker === undefined ? legacyCascade : enforced;
}

/** 上游落后于契约时的通用说明——四个页面共用一句话，省得四处各写一套。 */
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
