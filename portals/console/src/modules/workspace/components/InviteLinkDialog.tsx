"use client";

/**
 * InviteLinkDialog.tsx — 邀请发出 / 重发后的链接对话框(批 2;成员页与邀请页共用)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 邮件是主通道,链接是兜底:SMTP 没配或投递失败时邀请已经建好,把链接交给
 * 邀请人手动转发,比让整个动作失败强。token 只在这一刻可见——关掉就只能重发。
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Banner,
  DialogForm,
  Field,
  FieldLabel,
  Input,
} from "@vxture/design-system";
import type { InviteMemberResult } from "@/api/console-bff";
import { fmtDate, fmtTime } from "@/modules/commerce/components/hubModel";

export function InviteLinkDialog({
  result,
  resent = false,
  onClose,
}: {
  readonly result: InviteMemberResult | null;
  readonly resent?: boolean;
  readonly onClose: () => void;
}) {
  const t = useTranslations("inviteLinkDialog");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  useEffect(() => {
    setCopyState("idle");
  }, [result?.inviteLink]);

  if (!result) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.inviteLink);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <DialogForm
      open
      title={resent ? t("titleResent") : t("title")}
      description={
        result.emailSent
          ? t("sent", { email: result.email })
          : t("notSent", { email: result.email })
      }
      submitLabel={copyState === "copied" ? t("copied") : t("copy")}
      cancelLabel={t("close")}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        void copy();
      }}
    >
      {!result.emailSent ? (
        <Banner tone="warning" title={t("notSentTitle")} />
      ) : null}
      {/* 标签在上、控件在下(DS Field);标签与控件同塞一个 Label 会把标题挤到逐字换行 */}
      <Field>
        <FieldLabel htmlFor="invite-link">{t("linkLabel")}</FieldLabel>
        <Input
          id="invite-link"
          value={result.inviteLink}
          readOnly
          onFocus={(event) => event.currentTarget.select()}
        />
      </Field>
      <p className="text-body-sm text-muted-foreground">
        {t("expires", {
          date: `${fmtDate(result.expiresAt)} ${fmtTime(result.expiresAt)}`,
        })}
      </p>
      {copyState === "failed" ? (
        <Banner tone="danger" title={t("copyFailed")} />
      ) : null}
    </DialogForm>
  );
}
