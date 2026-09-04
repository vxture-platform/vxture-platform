"use client";

/**
 * ConvertTenantDialog — 个人租户转为组织租户的三屏(批 5c-2,owner 2026-09-05)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * ① 确认框:组织名称 + 知悉四项 + 输入当前租户名称确认
 * ② 转换中:整页遮罩、五步、**整段不少于 5 秒**、每步不少于 1 秒
 * ③ 完成:新形态说明 + 两个去处
 *
 * 关于进度的诚实性(第一版设计的自我修正):后端是**一个事务**,几百毫秒就完。
 * 如果一边跑事务一边按时间把步骤逐个打勾,事务失败时前几步的勾就是假的——用户
 * 会看到「编号已换发」然后被告知失败,不知道到底改没改。所以这里是**先跑完事务、
 * 成功后再回放**:每步展示的是已经发生的事实,失败则根本不进第二屏,直接在
 * 第一屏给错误。仪式感照旧(≥5 秒、逐步亮起),但它不会撒谎。
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Banner,
  Button,
  Checkbox,
  DialogForm,
  Icon,
  Input,
  Label,
  Progress,
  StatusBadge,
} from "@vxture/design-system";
import {
  ConsoleBffError,
  convertTenantToOrganization,
} from "@/api/console-bff";
import { PrincipalNo } from "@/components/principal-no";

const ACK_ITEMS = [
  "verification",
  "members",
  "paymentTtl",
  "irreversible",
] as const;

/** 回放的五步。每步至少 1 秒,整段 ≥ 5 秒。 */
const STEPS = ["check", "type", "verification", "personal", "session"] as const;
const STEP_MS = 1000;

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
  /** 回放结束后调用:调用方刷新会话并把页面切成组织形态。 */
  readonly onDone: (result: ConvertResult) => void;
}) {
  const t = useTranslations("tenantInfoPage.convert");

  const [name, setName] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!open) {
      setName("");
      setAcknowledged(false);
      setConfirmName("");
      setError(null);
      setResult(null);
      setStep(0);
      setSubmitting(false);
    }
  }, [open]);

  // 回放:事务已经成功,这里逐步亮起已发生的事实。
  useEffect(() => {
    if (!result || step >= STEPS.length) return;
    const timer = setTimeout(() => setStep((s) => s + 1), STEP_MS);
    return () => clearTimeout(timer);
  }, [result, step]);

  if (!open) return null;

  const ready =
    name.trim().length > 0 &&
    acknowledged &&
    confirmName.trim() === currentName;
  const replaying = result !== null && step < STEPS.length;
  const finished = result !== null && step >= STEPS.length;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const next = await convertTenantToOrganization(name.trim());
      setResult(next);
      setStep(0);
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

  // ② / ③ 回放与完成:整页遮罩,回放期间不可关闭。
  if (result) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-lg">
        <div className="flex w-full max-w-panel-md flex-col gap-lg rounded-xl bg-card p-xl shadow-raised ring-1 ring-foreground/10">
          <div className="flex flex-col gap-2xs">
            <h2 className="text-title-md text-foreground">
              {finished ? t("done.title", { name: result.name }) : t("running")}
            </h2>
            <p className="text-body-sm text-muted-foreground">
              {finished ? t("done.description") : t("runningHint")}
            </p>
          </div>

          <Progress value={(step / STEPS.length) * 100} />

          <ul className="flex flex-col gap-sm">
            {STEPS.map((s, index) => (
              <li
                key={s}
                className="flex flex-wrap items-center gap-md text-body-sm"
              >
                <StatusBadge
                  tone={index < step ? "success" : "neutral"}
                  icon={index < step ? "check" : "placeholder"}
                >
                  {index + 1}
                </StatusBadge>
                <span
                  className={
                    index < step ? "text-foreground" : "text-muted-foreground"
                  }
                >
                  {t(`steps.${s}`)}
                </span>
                {index < step && s === "type" ? (
                  <PrincipalNo
                    no={result.tenantNo}
                    kind="tenant"
                    className="text-muted-foreground"
                  />
                ) : null}
                {index < step && s === "personal" ? (
                  <PrincipalNo
                    no={result.newPersonalTenantNo}
                    kind="tenant"
                    className="text-muted-foreground"
                  />
                ) : null}
              </li>
            ))}
          </ul>

          {finished ? (
            <div className="flex flex-wrap items-center justify-end gap-sm">
              <Button
                variant="outline"
                size="md"
                onClick={() => onDone(result)}
              >
                {t("done.stay")}
              </Button>
              <Button size="md" onClick={() => onDone(result)}>
                <Icon name="shield-check" size="xs" fallback="placeholder" />
                <span>{t("done.verify")}</span>
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // ① 确认框
  return (
    <DialogForm
      open
      danger
      size="md"
      title={t("title")}
      description={t("description")}
      submitLabel={t("start")}
      cancelLabel={t("cancel")}
      submitting={submitting || replaying}
      submitDisabled={!ready}
      onOpenChange={(next) => {
        if (!next && !submitting) onClose();
      }}
      onSubmit={(event) => void submit(event)}
    >
      <div className="flex flex-col gap-lg">
        {error ? <Banner tone="danger" title={error} /> : null}
        <Label>
          {t("nameLabel")}
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("namePlaceholder")}
            required
          />
        </Label>
        <div className="flex flex-col gap-xs">
          <p className="text-label-md text-foreground">{t("ackTitle")}</p>
          <ul className="flex flex-col gap-2xs">
            {ACK_ITEMS.map((item) => (
              <li key={item} className="text-body-sm text-muted-foreground">
                · {t(`ack.${item}`)}
              </li>
            ))}
          </ul>
          <Label className="flex items-start gap-sm text-body-sm">
            <Checkbox
              checked={acknowledged}
              onCheckedChange={(value) => setAcknowledged(value === true)}
              aria-label={t("ackConfirm")}
            />
            <span>{t("ackConfirm")}</span>
          </Label>
        </div>
        <Label>
          {t("confirmLabel", { name: currentName })}
          <Input
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
          />
        </Label>
      </div>
    </DialogForm>
  );
}
