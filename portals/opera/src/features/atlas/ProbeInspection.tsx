"use client";

/**
 * ProbeInspection.tsx — 自检 / 验证接入的**完整**结果面板。
 * @package @vxture/opera
 * @layer Presentation
 * @category Features - Atlas
 *
 * owner 2026-10-05:「业务需要完整错误反馈，现在太简单了」。
 *
 * 旧的 `ProbeReport` 把一次真实上游调用的结果压成：一条横幅、三行解析事实、每条检查
 * 一句「未通过 / 已回 usage」，错误信息挤在最底下一行。而当**自检请求本身**失败（冷却、
 * 没有可借的模型、路由缺失、上游 5xx）时，连这些都没有——只弹一条随即消失的 toast，
 * 页面上什么都不留。运营拿着「验证失败」四个字无从下手。
 *
 * 这一版把它做成一个**常驻在详情页上的**面板，并把响应里本来就有、却被丢掉的东西全部
 * 摊开：
 *  - `requestId`：排障锚点，可一键复制，拿去 atlas 的 reqlog 里直接定位这一次调用。
 *  - 密钥是否解析、生效协议（null = 走了回退层，单独标红）、适配器、Endpoint。
 *  - 每条检查：延迟、token、**usage 与内容分别成徽标**，错误**码 + 文案都在原地**。
 *  - 两个「假绿灯」组合单独喊出来：回了 usage 却没交付内容；没匹配到具名协议。
 *  - 当请求本身失败：HTTP 状态码、稳定错误码、原文、冷却倒计时、出错入参、可否重试，
 *    外加按场景给出的下一步（冷却中 / 先启用一个模型 / 该 atlas 版本还没有这条路由）。
 *
 * 纯呈现件：发请求与持有状态都在详情页，这里只认一个 `ProbeState`。
 */

import { useEffect, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Icon,
  StatusBadge,
} from "@vxture/design-system";
import { OperaApiError } from "@/lib/api";
import type { ModelProbeBody, ProbeCheck } from "./model-service";

/** 详情页驱动的状态机。`context` 让错误文案能分清是模型自检还是 Provider 验证。 */
export type ProbeState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "result"; ok: boolean; lead: string; body: ModelProbeBody }
  | { kind: "error"; error: unknown; context: "model" | "provider" };

/** 一键复制的小 chip——requestId / endpoint 这类要粘进工单、粘进 reqlog 查询的值。 */
function CopyChip({ value }: { readonly value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => {
        void (async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            /* 剪贴板被策略挡掉就不做事——值在旁边看得见，仍可手动选。 */
          }
        })();
      }}
      /* 视觉要的是一行可复制的等宽文本 + 图标，不是一个带底的按钮：把 Button 的
         尺寸与内边距归零，只留它的可聚焦/可回车语义（同能力标签那处的做法）。 */
      className="inline-flex h-auto w-auto items-center gap-2xs p-0 font-mono text-code-sm font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
      aria-label={copied ? "已复制" : `复制 ${value}`}
    >
      <span className="break-all">{value}</span>
      <Icon
        name={copied ? "check" : "copy"}
        size="sm"
        aria-hidden="true"
        className={copied ? "text-success-text" : undefined}
      />
    </Button>
  );
}

/** 冷却倒计时。429 的 `retryAfterMs` 说的是「离下一次可自检还有多久」。 */
function RetryCountdown({ untilMs }: { readonly untilMs: number }) {
  const [remainingMs, setRemainingMs] = useState(() =>
    Math.max(0, untilMs - Date.now()),
  );
  useEffect(() => {
    const tick = () => setRemainingMs(Math.max(0, untilMs - Date.now()));
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [untilMs]);
  if (remainingMs <= 0) return <span>现在可以再试了。</span>;
  return <span>还需等待约 {Math.ceil(remainingMs / 1000)} 秒。</span>;
}

/** 请求本身失败时的标题 + 下一步，按 HTTP 状态/错误码 + 场景定。 */
function errorGuidance(
  error: OperaApiError,
  context: "model" | "provider",
): { title: string; hint: string } {
  /* 404 且无稳定错误码 = atlas 这个部署根本没有这条路由（旧版本），不是「不存在」。 */
  const routeMissing = error.status === 404 && error.code === undefined;
  if (routeMissing && context === "provider") {
    return {
      title: "当前 Atlas 部署还没有 Provider 探测接口",
      hint: "这条路由由 vxture-atlas#159 §1 交付（应用镜像 v0.4.0）。在此之前，改用这家名下某个模型的自检来验接入。",
    };
  }
  if (error.status === 409 && context === "provider") {
    return {
      title: "无法验证：这家名下没有启用中的模型",
      hint: "验证是借这家名下某个启用模型发起一次真实调用完成的；先注册并启用一个模型再试。",
    };
  }
  if (error.status === 429) {
    return {
      title: "自检冷却中",
      hint: "同一模型两次自检需间隔 10 秒以上（Provider 验证与模型自检共用这个冷却）。",
    };
  }
  if (error.status === 403) {
    return {
      title: "没有权限发起自检",
      hint: "自检会发起真实上游调用，要 model:model.manage（模型）或 model:provider.manage（Provider）。",
    };
  }
  if (error.status === 0) {
    return {
      title: "没有收到响应",
      hint: "请求没能到达 opera-bff 或 atlas——多半是服务没起或网络不通，不是接入配置本身的问题。",
    };
  }
  return {
    title: context === "provider" ? "验证失败" : "自检失败",
    hint: "下面是 atlas 原样回传的错误。带上 requestId / 错误码去 atlas 的 reqlog 里能定位这一次调用。",
  };
}

/** 请求级失败——把结构化错误体整个摊开，不再压成一句 toast。 */
function RequestError({
  error,
  context,
}: {
  readonly error: unknown;
  readonly context: "model" | "provider";
}) {
  if (!(error instanceof OperaApiError)) {
    return (
      <Banner
        tone="danger"
        title="自检失败"
        description={error instanceof Error ? error.message : String(error)}
      />
    );
  }
  const { title, hint } = errorGuidance(error, context);
  const retryAfterMs =
    typeof error.body?.retryAfterMs === "number"
      ? error.body.retryAfterMs
      : null;
  return (
    <div className="flex flex-col gap-sm">
      <Banner tone="danger" title={title} description={hint} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-lg gap-y-2xs rounded-md border border-border p-sm text-body-sm">
        <dt className="text-muted-foreground">HTTP 状态</dt>
        <dd className="font-mono">{error.status || "—（无响应）"}</dd>
        {error.code ? (
          <>
            <dt className="text-muted-foreground">错误码</dt>
            <dd className="font-mono break-all">{error.code}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">原文</dt>
        <dd className="break-all">{error.message}</dd>
        {error.field ? (
          <>
            <dt className="text-muted-foreground">出错入参</dt>
            <dd className="font-mono break-all">{error.field}</dd>
          </>
        ) : null}
        {retryAfterMs !== null ? (
          <>
            <dt className="text-muted-foreground">冷却</dt>
            <dd>
              <RetryCountdown untilMs={Date.now() + retryAfterMs} />
            </dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">可否原样重试</dt>
        <dd>{error.retryable ? "可以" : "不一定——先按原文处理再试"}</dd>
      </dl>
    </div>
  );
}

/** 一条检查（chat / stream）的卡片。usage 与内容分别成徽标，错误码+文案都在原地。 */
function CheckCard({ check }: { readonly check: ProbeCheck }) {
  /* 回了 usage 却没交付内容 = 旧自检会判成绿灯的那种假绿灯，单独标红。 */
  const falseGreen = check.usageReported && !check.contentReceived;
  return (
    <div className="flex flex-col gap-xs rounded-md border border-border p-sm">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <div className="flex items-center gap-sm">
          <StatusBadge tone={check.ok ? "success" : "danger"} dot>
            {check.mode}
          </StatusBadge>
          <span className="text-body-sm text-muted-foreground">
            {check.latencyMs != null ? `${check.latencyMs}ms` : "延迟 —"}
            {check.totalTokens != null ? ` · ${check.totalTokens} tokens` : ""}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2xs">
          {/* 计量结论只在检查通过时才是观测：失败分支上 usageReported 恒为 false，
              那时它不是「没回 usage」而是「没得测」，所以失败时不渲染这枚徽标。 */}
          {check.ok ? (
            <Badge variant={check.usageReported ? "secondary" : "outline"}>
              {check.usageReported ? "已回 usage" : "未回 usage（无法计量）"}
            </Badge>
          ) : null}
          {check.ok ? (
            <Badge variant={check.contentReceived ? "secondary" : "outline"}>
              {check.contentReceived ? "有内容交付" : "无内容交付"}
            </Badge>
          ) : null}
        </div>
      </div>
      {falseGreen ? (
        <p className="text-body-sm text-danger-foreground">
          回了 usage，却一个 token
          的可交付内容都没有——这正是旧自检会误判成绿灯的那种。
        </p>
      ) : null}
      {check.error ? (
        <div className="flex flex-col gap-2xs rounded-sm bg-muted/40 p-xs">
          {check.error.code ? (
            <span className="font-mono text-code-sm text-danger-foreground">
              {check.error.code}
            </span>
          ) : null}
          <span className="text-body-sm break-all text-muted-foreground">
            {check.error.message}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** 成功/失败都走这里——它是一次真实调用的完整回执，不是一句结论。 */
function ResultReport({
  ok,
  lead,
  body,
}: {
  readonly ok: boolean;
  readonly lead: string;
  readonly body: ModelProbeBody;
}) {
  const fellBack = body.resolvedProtocol === null;
  const anyFalseGreen = body.checks.some(
    (c) => c.usageReported && !c.contentReceived,
  );
  return (
    <div className="flex flex-col gap-md">
      <Banner
        tone={ok ? "success" : "danger"}
        title={ok ? "接入正常" : "接入异常"}
        description={lead}
      />

      {/* 两个「看起来没事、实则有问题」的组合提到最上面单独喊——它们不会让 ok 变 false，
          却都会让这个接入在生产里悄悄坏掉。 */}
      {anyFalseGreen ? (
        <Banner
          tone="warning"
          title="假绿灯：回了 usage 却没有交付内容"
          description="有检查拿到了 usage 却没产出可交付内容（常见于默认开思考、把预算烧在思维链上的模型）。生产里它会扣费却不出结果——多半要配「厂商开关」关掉思考，或调大最大输出。"
        />
      ) : null}
      {fellBack ? (
        <Banner
          tone="warning"
          title="没有匹配到具名协议"
          description="生效协议为空，走的是 provider_code 回退层。接入仍可能通，但没有按具名协议校验线格式——确认「协议」选对了，或在 Provider / 模型上补齐 wire 声明。"
        />
      ) : null}

      <dl className="grid grid-cols-[auto_1fr] gap-x-lg gap-y-2xs text-body-sm">
        <dt className="text-muted-foreground">requestId</dt>
        <dd>
          {body.requestId ? (
            <CopyChip value={body.requestId} />
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </dd>
        <dt className="text-muted-foreground">密钥解析</dt>
        <dd>
          {body.keyResolved ? (
            <span className="text-success-text">已解析</span>
          ) : (
            <span className="text-danger-foreground">
              未解析——当前无法真实调用
            </span>
          )}
        </dd>
        <dt className="text-muted-foreground">协议（生效值）</dt>
        <dd className="font-mono">
          {body.resolvedProtocol ?? "—（走了回退层）"}
        </dd>
        <dt className="text-muted-foreground">适配器</dt>
        <dd className="font-mono break-all">{body.adapter}</dd>
        <dt className="text-muted-foreground">Endpoint</dt>
        <dd>
          <CopyChip value={body.endpointUrl} />
        </dd>
      </dl>

      <div className="flex flex-col gap-sm">
        {body.checks.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">
            这次没有返回任何检查项。
          </p>
        ) : (
          body.checks.map((c) => <CheckCard key={c.mode} check={c} />)
        )}
      </div>
    </div>
  );
}

export function ProbeInspection({ state }: { readonly state: ProbeState }) {
  if (state.kind === "idle") {
    return (
      <p className="text-body-sm text-muted-foreground">
        还没有自检记录。自检会发起一次真实上游调用（chat 与 stream
        两路）、消耗少量
        token，用来验证密钥解析、线协议生效值、连通性与延迟，以及上游是否回传
        usage（决定能否计量）。
      </p>
    );
  }
  if (state.kind === "running") {
    return (
      <p className="flex items-center gap-sm text-body-sm text-muted-foreground">
        <Icon
          name="spinner"
          size="sm"
          aria-hidden="true"
          className="animate-spin"
        />
        正在发起真实调用并等待上游响应…
      </p>
    );
  }
  if (state.kind === "error") {
    return <RequestError error={state.error} context={state.context} />;
  }
  return <ResultReport ok={state.ok} lead={state.lead} body={state.body} />;
}

/** 发起前的那条「会花真钱」的警示。两张详情页复用同一句。 */
export function ProbeWarning({
  scope,
}: {
  readonly scope: "model" | "provider";
}) {
  return (
    <Banner
      tone="warning"
      title="会发起真实上游调用并消耗 token"
      description={
        scope === "provider"
          ? "Atlas 会挑这家名下 modelCode 最小的启用模型跑一次自检（限制 16 token 以内），用量记平台哨兵账、不扣租户配额。与模型自检共用同一个 10 秒冷却。"
          : "Atlas 侧限制在 16 token 以内，用量记在平台哨兵账上、不扣任何租户配额。同一模型两次自检需间隔 10 秒以上。"
      }
    />
  );
}
