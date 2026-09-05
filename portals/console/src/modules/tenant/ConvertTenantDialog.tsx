"use client";

/**
 * ConvertTenantDialog — 个人租户转为组织租户的向导(批 5c-2;owner 2026-09-05 走查重做)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 一个固定尺寸的面板(lg 档、正文最小高度一致),**无滚动条**,按步推进、每页只聚焦一件事:
 *   1/4 升级后的变化(警示 + 五条变化)
 *   2/4 组织名称(认证名;简称初始相同)
 *   3/4 转换过程(五步预览 + 时长说明)
 *   4/4 确认并开始(摘要 + 我已知悉 + 输入当前租户名;「开始转换」就在这一块的操作栏)
 * 提交后同一面板进入回放(五步逐项亮起,整段不少于 5 秒),最后一屏「转换完成」。
 * 页脚左侧始终显示「第 N / 4 步」,右侧是上一步 / 下一步(或开始转换)。
 *
 * 关于进度的诚实性:后端是**一个事务**,几百毫秒就完。这里是**先跑完事务、成功后再回放**:
 * 每步展示的是已经发生的事实,失败则留在第 4 步给错误,不进回放。
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

/** 回放的五步。每步至少 1 秒,整段 ≥ 5 秒。 */
const STEPS = ["check", "type", "verification", "personal", "session"] as const;
const STEP_MS = 1000;
const WIZARD_STEPS = 4;

type Phase =
  | { kind: "wizard"; step: 1 | 2 | 3 | 4 }
  | { kind: "replay" }
  | { kind: "done" };

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

  // 回放:事务已经成功,逐步亮起已发生的事实;走完进入「转换完成」。
  useEffect(() => {
    if (phase.kind !== "replay") return;
    if (replayStep >= STEPS.length) {
      setPhase({ kind: "done" });
      return;
    }
    const timer = setTimeout(() => setReplayStep((s) => s + 1), STEP_MS);
    return () => clearTimeout(timer);
  }, [phase.kind, replayStep]);

  if (!open) return null;

  const busy = submitting || phase.kind === "replay";
  const nameReady = name.trim().length > 0;
  const confirmReady =
    nameReady && acknowledged && confirmName.trim() === currentName;

  async function start() {
    if (!confirmReady || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const next = await convertTenantToOrganization(name.trim());
      setResult(next);
      setReplayStep(0);
      setPhase({ kind: "replay" });
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

  const stepTitle =
    phase.kind === "wizard"
      ? t(
          `stepTitles.${["changes", "name", "process", "confirm"][phase.step - 1]}`,
        )
      : phase.kind === "replay"
        ? t("running")
        : t("completeTitle");

  const stepIndicator =
    phase.kind === "wizard"
      ? t("stepOf", { current: phase.step, total: WIZARD_STEPS })
      : phase.kind === "replay"
        ? t("runningHint")
        : t("done.description");

  const replayList = (
    <ul className="flex flex-col gap-md">
      {STEPS.map((s, index) => {
        const lit = phase.kind === "done" || index < replayStep;
        return (
          <li
            key={s}
            className="flex flex-wrap items-center gap-md text-body-md"
          >
            <StatusBadge
              tone={lit ? "success" : "neutral"}
              icon={lit ? "check" : "placeholder"}
            >
              {index + 1}
            </StatusBadge>
            <span className={lit ? "text-foreground" : "text-muted-foreground"}>
              {t(`steps.${s}`)}
            </span>
            {lit && s === "type" && result ? (
              <PrincipalNo
                no={result.tenantNo}
                kind="tenant"
                className="text-muted-foreground"
              />
            ) : null}
            {lit && s === "personal" && result ? (
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
  );

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
  } else if (phase.kind === "wizard" && phase.step === 2) {
    body = (
      <div className="flex flex-col gap-sm">
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
    );
  } else if (phase.kind === "wizard" && phase.step === 3) {
    body = (
      <>
        <ol className="flex flex-col gap-md">
          {STEPS.map((s, index) => (
            <li
              key={s}
              className="flex items-center gap-md text-body-md text-foreground"
            >
              <StatusBadge tone="neutral" icon={false}>
                {index + 1}
              </StatusBadge>
              <span>{t(`steps.${s}`)}</span>
            </li>
          ))}
        </ol>
        <p className="text-body-sm text-muted-foreground">{t("processHint")}</p>
      </>
    );
  } else if (phase.kind === "wizard") {
    body = (
      <>
        {error ? <Banner tone="danger" title={error} /> : null}
        <p className="text-body-md text-foreground">
          {t("summary", { from: currentName, to: name.trim() })}
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
        <Progress
          value={
            phase.kind === "done" ? 100 : (replayStep / STEPS.length) * 100
          }
        />
        {replayList}
        {phase.kind === "done" ? (
          <Banner
            tone="success"
            title={t("done.title", { name: result?.name ?? name })}
          />
        ) : null}
      </>
    );
  }

  let footerActions: React.ReactNode;
  if (phase.kind === "wizard") {
    const { step } = phase;
    footerActions = (
      <>
        {step === 1 ? (
          <Button variant="outline" size="md" onClick={onClose}>
            {t("cancel")}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="md"
            onClick={() =>
              setPhase({ kind: "wizard", step: (step - 1) as 1 | 2 | 3 })
            }
            disabled={submitting}
          >
            {t("prev")}
          </Button>
        )}
        {step < WIZARD_STEPS ? (
          <Button
            size="md"
            onClick={() =>
              setPhase({ kind: "wizard", step: (step + 1) as 2 | 3 | 4 })
            }
            disabled={step === 2 && !nameReady}
          >
            {t("next")}
          </Button>
        ) : (
          <Button
            size="md"
            onClick={() => void start()}
            disabled={!confirmReady || submitting}
          >
            {t("start")}
          </Button>
        )}
      </>
    );
  } else if (phase.kind === "done" && result) {
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
  } else {
    footerActions = null;
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
          <DialogTitle>
            {phase.kind === "wizard" ? t("title") : stepTitle}
          </DialogTitle>
          <DialogDescription>
            {phase.kind === "wizard" ? stepTitle : stepIndicator}
          </DialogDescription>
        </DialogHeader>

        {/* 正文:各步同一最小高度,不出滚动条 */}
        <div className="flex min-h-panel-sm flex-col gap-lg py-md">{body}</div>

        <DialogFooter className="flex items-center justify-between gap-md sm:justify-between">
          <span className="text-body-sm text-muted-foreground">
            {phase.kind === "wizard"
              ? stepIndicator
              : phase.kind === "replay"
                ? t("running")
                : t("completeTitle")}
          </span>
          <span className="flex items-center gap-sm">{footerActions}</span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
