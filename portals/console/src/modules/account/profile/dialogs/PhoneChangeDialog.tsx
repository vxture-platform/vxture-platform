"use client";

/**
 * PhoneChangeDialog — 更换手机号(两步:先证明是本人,再验证新号)。
 * 状态与动作在 usePhoneChangeFlow 里,这里只画。
 */

import { Fragment } from "react";
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
  FieldLabel,
  Icon,
  Input,
} from "@vxture/design-system";
import type { PhoneChangeFlow } from "../flows";

export function PhoneChangeDialog({
  flow,
  currentPhone,
  currentEmail,
}: {
  readonly flow: PhoneChangeFlow;
  readonly currentPhone: string;
  readonly currentEmail: string | null;
}) {
  const t = useTranslations("profilePage");

  const steps = [
    t("dialogs.phoneChange.step1Label"),
    t("dialogs.phoneChange.step2Label"),
  ];
  const activeIdx = flow.step === "step1" ? 0 : 1;
  const stepBar = (
    <div className="flex flex-wrap items-center gap-xs">
      {steps.map((label, i) => {
        const isActive = i === activeIdx;
        const isDone = i < activeIdx;
        return (
          <Fragment key={label}>
            {i > 0 && <span className="h-px w-media-xs bg-border" />}
            <span
              className={
                isDone || isActive
                  ? "size-2xs rounded-full bg-primary"
                  : "size-2xs rounded-full bg-border"
              }
            />
            <span
              className={
                isActive
                  ? "text-label-sm text-foreground"
                  : "text-label-sm text-muted-foreground"
              }
            >
              {label}
            </span>
          </Fragment>
        );
      })}
    </div>
  );

  return (
    <Dialog open={flow.open} onOpenChange={flow.setOpen}>
      <DialogContent>
        <div className="flex flex-col gap-lg">
          {flow.step === "success" ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t("dialogs.phoneChange.successTitle")}
                </DialogTitle>
                <DialogDescription>
                  {t("dialogs.phoneChange.successMessage", {
                    phone: currentPhone,
                  })}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button onClick={() => flow.setOpen(false)}>
                  {t("actions.close")}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                {stepBar}
                <DialogTitle>
                  {flow.step === "step1"
                    ? t("dialogs.phoneChange.step1Title")
                    : t("dialogs.phoneChange.step2Title")}
                </DialogTitle>
                <DialogDescription>
                  {flow.step === "step1"
                    ? t("dialogs.phoneChange.step1Description")
                    : t("dialogs.phoneChange.step2Description")}
                </DialogDescription>
              </DialogHeader>

              {flow.step === "step1" ? (
                <>
                  {flow.step1Sent ? (
                    <p className="flex items-center gap-xs text-body-sm text-success-text">
                      <Icon name="check" size="xs" fallback="placeholder" />
                      {flow.idMethod === "phone"
                        ? t("dialogs.phoneChange.sentToPhone", {
                            phone: currentPhone,
                          })
                        : t("dialogs.phoneChange.sentToEmail", {
                            email: flow.maskedEmail,
                          })}
                    </p>
                  ) : (
                    <Button
                      variant="outline"
                      className="self-start"
                      onClick={() =>
                        void (flow.idMethod === "phone"
                          ? flow.sendStep1PhoneOtp()
                          : flow.sendStep1EmailOtp())
                      }
                      disabled={flow.submitting}
                    >
                      {flow.idMethod === "phone"
                        ? t("dialogs.phoneChange.sendToPhone", {
                            phone: currentPhone,
                          })
                        : t("actions.sendCode")}
                    </Button>
                  )}

                  <Field>
                    <FieldLabel htmlFor="profile-step1-code">
                      {t("fields.verificationCode")}
                    </FieldLabel>
                    <Input
                      id="profile-step1-code"
                      value={flow.step1Code}
                      onChange={(event) =>
                        flow.setStep1Code(event.target.value)
                      }
                      placeholder={t("placeholders.verificationCode")}
                      inputMode="numeric"
                      maxLength={6}
                      disabled={!flow.step1Sent}
                    />
                  </Field>

                  <div className="flex flex-wrap items-center gap-xs">
                    {flow.step1Sent && (
                      <Button
                        variant="ghost"
                        size="md"
                        type="button"
                        onClick={() =>
                          void (flow.idMethod === "phone"
                            ? flow.sendStep1PhoneOtp()
                            : flow.sendStep1EmailOtp())
                        }
                        disabled={flow.submitting}
                      >
                        {t("actions.resendCode")}
                      </Button>
                    )}
                    {flow.idMethod === "phone" && currentEmail ? (
                      <Button
                        variant="ghost"
                        size="md"
                        type="button"
                        onClick={flow.switchToEmailMethod}
                      >
                        {t("dialogs.phoneChange.switchToEmail", {
                          email: currentEmail,
                        })}
                      </Button>
                    ) : flow.idMethod === "email" ? (
                      <Button
                        variant="ghost"
                        size="md"
                        type="button"
                        onClick={flow.switchToPhoneMethod}
                      >
                        {t("dialogs.phoneChange.switchToPhone")}
                      </Button>
                    ) : null}
                  </div>

                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => flow.setOpen(false)}
                    >
                      {t("actions.cancel")}
                    </Button>
                    <Button
                      onClick={() => void flow.submitStep1()}
                      disabled={
                        flow.submitting ||
                        !flow.step1Sent ||
                        flow.step1Code.length < 6
                      }
                    >
                      {t("actions.next")}
                    </Button>
                  </DialogFooter>
                </>
              ) : (
                <>
                  <Field>
                    <FieldLabel htmlFor="profile-new-phone">
                      {t("fields.newPhone")}
                    </FieldLabel>
                    <div className="flex items-center gap-sm">
                      <Input
                        id="profile-new-phone"
                        className="flex-1"
                        type="tel"
                        value={flow.newPhone}
                        onChange={(event) => {
                          flow.setNewPhone(event.target.value);
                          flow.setStep2Sent(false);
                        }}
                        placeholder={t("placeholders.newPhone")}
                        autoComplete="tel"
                      />
                      <Button
                        variant="outline"
                        onClick={() => void flow.sendStep2Otp()}
                        disabled={flow.submitting || !flow.newPhone.trim()}
                      >
                        {flow.step2Sent
                          ? t("actions.resendCode")
                          : t("actions.sendCode")}
                      </Button>
                    </div>
                  </Field>

                  {flow.step2Sent && (
                    <p className="flex items-center gap-xs text-body-sm text-success-text">
                      <Icon name="check" size="xs" fallback="placeholder" />
                      {t("dialogs.phoneChange.sentToPhone", {
                        phone: flow.newPhone,
                      })}
                    </p>
                  )}

                  <Field>
                    <FieldLabel htmlFor="profile-new-phone-code">
                      {t("fields.verificationCode")}
                    </FieldLabel>
                    <Input
                      id="profile-new-phone-code"
                      value={flow.newPhoneCode}
                      onChange={(event) =>
                        flow.setNewPhoneCode(event.target.value)
                      }
                      placeholder={t("placeholders.verificationCode")}
                      inputMode="numeric"
                      maxLength={6}
                      disabled={!flow.step2Sent}
                    />
                  </Field>

                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => flow.setStep("step1")}
                    >
                      {t("actions.prev")}
                    </Button>
                    <Button
                      onClick={() => void flow.submitStep2()}
                      disabled={
                        flow.submitting ||
                        !flow.step2Sent ||
                        flow.newPhoneCode.length < 6
                      }
                    >
                      {t("actions.completeChange")}
                    </Button>
                  </DialogFooter>
                </>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
