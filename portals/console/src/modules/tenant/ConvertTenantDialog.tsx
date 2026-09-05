"use client";

/**
 * ConvertTenantDialog — 个人租户转为组织租户的向导(批 5c-2;owner 2026-09-05 走查重做)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 一个固定尺寸的面板(lg 档、正文最小高度一致),**无滚动条**,三步推进、每页只聚焦一件事:
 *   1/3 升级后的变化(警示 + 五条变化)                          → 「我已了解,继续」
 *   2/3 组织名称与确认(输入组织名称 + 我已知悉 + 输入当前租户名)→ 「确认转换」
 *   3/3 转换过程(**决定之后**的执行显示)                        → 完成后「留在本页」/「去企业认证」
 * 页脚左侧始终显示「第 N / 3 步」;按钮按业务命名,不一律叫「下一步」(owner 走查)。
 *
 * 第 3 步逐项显示的逻辑:后端是**一个事务**,五件事在库里一起成、一起败,几百毫秒就完。
 * 所以这里**先跑完事务、成功后再回放**——每一项都是已经发生的事实,按事务里的先后顺序
 * 每 0.7 秒亮一项(整段不少于 3 秒,让过程正式可感):未到的项灰字无标记,正在亮的项转圈,
 * 亮过的项绿色对勾。它不是服务端的分步进度(事务没有中间态),而是把一次原子操作的
 * 结果按步骤讲一遍;失败则根本不进第 3 步,错误留在第 2 步。
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Banner,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Icon,
  Input,
  Label,
  Progress,
  Spinner,
  StatusBadge,
} from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";
import {
  ConsoleBffError,
  convertTenantToOrganization,
} from "@/api/console-bff";
import { PrincipalNo } from "@/components/principal-no";

const ACK_ITEMS: readonly { key: string; icon: IconName }[] = [
  { key: "verification", icon: "shield-check" },
  { key: "members", icon: "users" },
  { key: "entitlements", icon: "receipt" },
  { key: "paymentTtl", icon: "clock-counter-clockwise" },
  { key: "irreversible", icon: "warning" },
];

/** 第 3 步回放的五项。每项 0.7 秒,整段 3.5 秒(owner:最少 3 秒,让过程正式可感)。 */
const STEPS = ["check", "type", "verification", "personal", "session"] as const;
const STEP_MS = 700;
const TOTAL_STEPS = 3;

/** 1–2 是决定前的向导页;3 是执行显示(回放),走完标记 done。 */
type Phase =
  | { kind: "wizard"; step: 1 | 2 }
  | { kind: "process"; done: boolean };

export interface ConvertResult {
  tenantId: string;
  name: string;
  tenantNo: string | null;
  newPersonalTenantId: string;
  newPersonalTenantNo: string | null;
}

export function ConvertTenantDialog({
  open,
  currentName,
  onClose,
  onDone,
}: {
  readonly open: boolean;
  readonly currentName: string;
  readonly onClose: () => void;
  /** 「转换完成」后调用:调用方刷新会话并把页面切成组织形态。 */
  readonly onDone: (result: ConvertResult) => void;
}) {
  const t = useTranslations("tenantInfoPage.convert");

  const [phase, setPhase] = useState<Phase>({ kind: "wizard", step: 1 });
  const [name, setName] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [replayStep, setReplayStep] = useState(0);

  useEffect(() => {
    if (!open) {
      setPhase({ kind: "wizard", step: 1 });
      setName("");
      setAcknowledged(false);
      setConfirmName("");
      setError(null);
      setResult(null);
      setReplayStep(0);
      setSubmitting(false);
    }
  }, [open]);

  // 第 3 步:事务已经成功,逐项亮起已发生的事实;走完标记完成。
  useEffect(() => {
    if (phase.kind !== "process" || phase.done) return;
    if (replayStep >= STEPS.length) {
      setPhase({ kind: "process", done: true });
      return;
    }
    const timer = setTimeout(() => setReplayStep((s) => s + 1), STEP_MS);
    return () => clearTimeout(timer);
  }, [phase, replayStep]);

  if (!open) return null;

  const replaying = phase.kind === "process" && !phase.done;
  const finished = phase.kind === "process" && phase.done;
  const busy = submitting || replaying;
  const nameReady = name.trim().length > 0;
  const confirmReady =
    nameReady && acknowledged && confirmName.trim() === currentName;
  const currentStep = phase.kind === "wizard" ? phase.step : TOTAL_STEPS;

  async function start() {
    if (!confirmReady || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const next = await convertTenantToOrganization(name.trim());
      setResult(next);
      setReplayStep(0);
      setPhase({ kind: "process", done: false });
    } catch (err) {
      setError(
        err instanceof ConsoleBffError && err.message
          ? err.message
          : t("failed"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  const stepTitle = finished
    ? t("completeTitle")
    : t(`stepTitles.${["changes", "confirm", "process"][currentStep - 1]}`);
  const stepIndicator = t("stepOf", {
    current: currentStep,
    total: TOTAL_STEPS,
  });

  let body: React.ReactNode;
  if (phase.kind === "wizard" && phase.step === 1) {
    body = (
      <>
        <Banner tone="danger" title={t("warning")} />
        <ul className="flex flex-col gap-md">
          {ACK_ITEMS.map((item) => (
            <li
              key={item.key}
              className="flex items-start gap-md text-body-md text-foreground"
            >
              <Icon
                name={item.icon}
                size="sm"
                fallback="placeholder"
                className="mt-2xs shrink-0 text-destructive-text"
              />
              <span>{t(`ack.${item.key}`)}</span>
            </li>
          ))}
        </ul>
      </>
    );
  } else if (phase.kind === "wizard") {
    body = (
      <>
        {error ? <Banner tone="danger" title={error} /> : null}
        <div className="flex flex-col gap-xs">
          <Label htmlFor="convert-org-name" className="text-label-md">
            {t("nameLabel")}
          </Label>
          <Input
            id="convert-org-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("namePlaceholder")}
            autoFocus
            required
          />
          <p className="text-body-sm text-muted-foreground">{t("nameHint")}</p>
        </div>
        <p className="text-body-md text-foreground">
          {nameReady
            ? t("summary", { from: currentName, to: name.trim() })
            : t("summaryPending", { from: currentName })}
        </p>
        <Label className="flex items-start gap-sm text-body-md">
          <Checkbox
            checked={acknowledged}
            onCheckedChange={(value) => setAcknowledged(value === true)}
            aria-label={t("ackConfirm")}
          />
          <span>{t("ackConfirm")}</span>
        </Label>
        <div className="flex flex-col gap-xs">
          <Label htmlFor="convert-confirm-name" className="text-label-md">
            {t("confirmLabel", { name: currentName })}
          </Label>
          <Input
            id="convert-confirm-name"
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
          />
        </div>
      </>
    );
  } else {
    body = (
      <>
        <Progress value={finished ? 100 : (replayStep / STEPS.length) * 100} />
        <ul className="flex flex-col gap-md">
          {STEPS.map((s, index) => {
            // 三态:亮过(绿色对勾)/ 正在亮(转圈)/ 未到(灰字无标记)
            const state =
              finished || index < replayStep
                ? "done"
                : index === replayStep
                  ? "current"
                  : "pending";
            return (
              <li
                key={s}
                className="flex flex-wrap items-center gap-md text-body-md"
              >
                {state === "done" ? (
                  <StatusBadge tone="success" icon="check">
                    {index + 1}
                  </StatusBadge>
                ) : state === "current" ? (
                  <span className="inline-flex items-center gap-xs">
                    <Spinner size="sm" />
                    <StatusBadge tone="neutral" icon={false}>
                      {index + 1}
                    </StatusBadge>
                  </span>
                ) : (
                  <StatusBadge tone="neutral" icon={false}>
                    {index + 1}
                  </StatusBadge>
                )}
                <span
                  className={
                    state === "pending"
                      ? "text-muted-foreground"
                      : "text-foreground"
                  }
                >
                  {t(`steps.${s}`)}
                </span>
                {state === "done" && s === "type" && result ? (
                  <PrincipalNo
                    no={result.tenantNo}
                    kind="tenant"
                    className="text-muted-foreground"
                  />
                ) : null}
                {state === "done" && s === "personal" && result ? (
                  <PrincipalNo
                    no={result.newPersonalTenantNo}
                    kind="tenant"
                    className="text-muted-foreground"
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
        {finished ? (
          <Banner
            tone="success"
            title={t("done.title", { name: result?.name ?? name })}
          />
        ) : (
          <p className="text-body-sm text-muted-foreground">
            {t("runningHint")}
          </p>
        )}
      </>
    );
  }

  // 按钮按业务命名(owner 走查:不一律叫「下一步」)
  let footerActions: React.ReactNode = null;
  if (phase.kind === "wizard" && phase.step === 1) {
    footerActions = (
      <>
        <Button variant="outline" size="md" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button size="md" onClick={() => setPhase({ kind: "wizard", step: 2 })}>
          {t("actions.understand")}
        </Button>
      </>
    );
  } else if (phase.kind === "wizard") {
    footerActions = (
      <>
        <Button
          variant="outline"
          size="md"
          onClick={() => setPhase({ kind: "wizard", step: 1 })}
          disabled={submitting}
        >
          {t("prev")}
        </Button>
        <Button
          size="md"
          onClick={() => void start()}
          disabled={!confirmReady || submitting}
        >
          {t("actions.confirmConvert")}
        </Button>
      </>
    );
  } else if (finished && result) {
    const done = result;
    footerActions = (
      <>
        <Button variant="outline" size="md" onClick={() => onDone(done)}>
          {t("done.stay")}
        </Button>
        <Button size="md" onClick={() => onDone(done)}>
          <Icon name="shield-check" size="xs" fallback="placeholder" />
          <span>{t("done.verify")}</span>
        </Button>
      </>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent
        width="lg"
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{stepTitle}</DialogDescription>
        </DialogHeader>

        {/* 正文:各步同一最小高度,不出滚动条 */}
        <div className="flex min-h-panel-sm flex-col gap-lg py-md">{body}</div>

        <DialogFooter className="flex items-center justify-between gap-md sm:justify-between">
          <span className="text-body-sm text-muted-foreground">
            {stepIndicator}
            {replaying ? ` · ${t("running")}` : ""}
            {finished ? ` · ${t("completeTitle")}` : ""}
          </span>
          <span className="flex items-center gap-sm">{footerActions}</span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
