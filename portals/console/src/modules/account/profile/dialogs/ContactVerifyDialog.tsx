"use client";

/**
 * ContactVerifyDialog — 验证当前手机 / 验证当前邮箱 / 更换邮箱(同一件,按 mode 变形)。
 * 状态与动作在 useContactVerifyFlow 里,这里只画。
 */

import { useTranslations } from "next-intl";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldGroup,
  FieldLabel,
  Icon,
  Input,
} from "@vxture/design-system";
import type { ContactVerifyFlow } from "../flows";

export function ContactVerifyDialog({
  flow,
  currentPhone,
}: {
  readonly flow: ContactVerifyFlow;
  readonly currentPhone: string;
}) {
  const t = useTranslations("profilePage");
  return (
    <Dialog open={flow.open} onOpenChange={flow.setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(`dialogs.contactVerify.${flow.mode}.title`)}
          </DialogTitle>
          <DialogDescription>
            {t(`dialogs.contactVerify.${flow.mode}.description`)}
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          {flow.mode === "email-change" ? (
            <Field>
              <FieldLabel htmlFor="profile-new-email">
                {t("fields.newEmail")}
              </FieldLabel>
              <Input
                id="profile-new-email"
                type="email"
                value={flow.newEmail}
                onChange={(event) => {
                  flow.setNewEmail(event.target.value);
                  flow.setSent(false);
                }}
                placeholder={t("placeholders.newEmail")}
                autoComplete="email"
              />
            </Field>
          ) : null}

          {flow.sent ? (
            <p className="flex items-center gap-xs text-body-sm text-success-text">
              <Icon name="check" size="xs" fallback="placeholder" />
              {flow.mode === "phone-verify"
                ? t("dialogs.phoneChange.sentToPhone", { phone: currentPhone })
                : flow.mode === "email-verify"
                  ? t("dialogs.phoneChange.sentToEmail", { email: flow.masked })
                  : t("dialogs.phoneChange.sentToEmail", {
                      email: flow.newEmail,
                    })}
            </p>
          ) : (
            <Button
              variant="outline"
              className="self-start"
              onClick={() => void flow.send()}
              disabled={
                flow.submitting ||
                (flow.mode === "email-change" && !flow.newEmail.trim())
              }
            >
              {t("actions.sendCode")}
            </Button>
          )}

          <Field>
            <FieldLabel htmlFor="profile-verify-code">
              {t("fields.verificationCode")}
            </FieldLabel>
            <Input
              id="profile-verify-code"
              value={flow.code}
              onChange={(event) => flow.setCode(event.target.value)}
              placeholder={t("placeholders.verificationCode")}
              inputMode="numeric"
              maxLength={6}
              disabled={!flow.sent}
            />
          </Field>
        </FieldGroup>

        <DialogFooter>
          <Button variant="outline" onClick={() => flow.setOpen(false)}>
            {t("actions.cancel")}
          </Button>
          <Button
            onClick={() => void flow.submit()}
            disabled={flow.submitting || !flow.sent || flow.code.length < 6}
          >
            {t("actions.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
