"use client";

/**
 * SimpleDialogs — 改账号名 / 改密码 / 关闭账号密码登录确认 / 解绑三方 四个小对话框。
 * 外壳统一走 DS `DialogForm`(批 5a:此前四份各自手搭 Dialog + form)。
 * 字段一律「标签在上、控件在下」(DS Field):标签与控件不能同塞进一个 Label——
 * DS Label 是横排 flex,控件占满一行会把中文标题挤到只剩一字宽、逐字换行
 * (租户信息页走查第八轮抓到的,同一写法全站一起改)。
 */

import { useTranslations } from "next-intl";
import { DialogForm, Field, FieldLabel, Input } from "@vxture/design-system";
import type { FormEvent } from "react";

export function UsernameDialog({
  open,
  value,
  onChange,
  onClose,
  onSubmit,
  submitting,
}: {
  readonly open: boolean;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly onClose: () => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly submitting: boolean;
}) {
  const t = useTranslations("profilePage");
  if (!open) return null;
  return (
    <DialogForm
      open
      title={t("dialogs.username.title")}
      description={t("dialogs.username.description")}
      submitLabel={t("actions.save")}
      cancelLabel={t("actions.cancel")}
      submitting={submitting}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      onSubmit={onSubmit}
    >
      <Field>
        <FieldLabel htmlFor="profile-username">
          {t("fields.username")}
        </FieldLabel>
        <Input
          id="profile-username"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="username"
          placeholder={t("placeholders.username")}
          required
        />
      </Field>
    </DialogForm>
  );
}

export interface PasswordFormState {
  currentPassword: string;
  nextPassword: string;
  confirmPassword: string;
}

export function PasswordDialog({
  open,
  hasPassword,
  form,
  onChange,
  onClose,
  onSubmit,
  submitting,
  minLength,
}: {
  readonly open: boolean;
  readonly hasPassword: boolean;
  readonly form: PasswordFormState;
  readonly onChange: (next: PasswordFormState) => void;
  readonly onClose: () => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly submitting: boolean;
  readonly minLength: number;
}) {
  const t = useTranslations("profilePage");
  if (!open) return null;
  return (
    <DialogForm
      open
      title={
        hasPassword
          ? t("dialogs.password.title")
          : t("dialogs.password.setupTitle")
      }
      description={
        hasPassword
          ? t("dialogs.password.description")
          : t("dialogs.password.setupDescription")
      }
      submitLabel={
        hasPassword ? t("actions.updatePassword") : t("actions.setPassword")
      }
      cancelLabel={t("actions.cancel")}
      submitting={submitting}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      onSubmit={onSubmit}
    >
      {hasPassword ? (
        <Field>
          <FieldLabel htmlFor="profile-current-password">
            {t("fields.currentPassword")}
          </FieldLabel>
          <Input
            id="profile-current-password"
            type="password"
            value={form.currentPassword}
            onChange={(event) =>
              onChange({ ...form, currentPassword: event.target.value })
            }
            autoComplete="current-password"
            required
          />
        </Field>
      ) : null}
      <Field>
        <FieldLabel htmlFor="profile-next-password">
          {t("fields.nextPassword")}
        </FieldLabel>
        <Input
          id="profile-next-password"
          type="password"
          value={form.nextPassword}
          onChange={(event) =>
            onChange({ ...form, nextPassword: event.target.value })
          }
          autoComplete="new-password"
          minLength={minLength}
          required
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="profile-confirm-password">
          {t("fields.confirmPassword")}
        </FieldLabel>
        <Input
          id="profile-confirm-password"
          type="password"
          value={form.confirmPassword}
          onChange={(event) =>
            onChange({ ...form, confirmPassword: event.target.value })
          }
          autoComplete="new-password"
          minLength={minLength}
          required
        />
      </Field>
      <p className="text-body-sm text-muted-foreground">
        {t("dialogs.password.rule", { min: minLength })}
      </p>
    </DialogForm>
  );
}

export function DisableLoginDialog({
  open,
  onClose,
  onConfirm,
  submitting,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
  readonly submitting: boolean;
}) {
  const t = useTranslations("profilePage");
  if (!open) return null;
  return (
    <DialogForm
      open
      title={t("dialogs.disableLogin.title")}
      description={t("dialogs.disableLogin.description")}
      submitLabel={t("security.disableLogin")}
      cancelLabel={t("actions.cancel")}
      danger
      submitting={submitting}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        onConfirm();
      }}
    />
  );
}

export function UnbindDialog({
  providerName,
  onClose,
  onConfirm,
  submitting,
}: {
  readonly providerName: string | null;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
  readonly submitting: boolean;
}) {
  const t = useTranslations("profilePage");
  if (!providerName) return null;
  return (
    <DialogForm
      open
      title={t("connectedAccounts.dialogs.unbindTitle")}
      description={t("connectedAccounts.dialogs.unbindDescription", {
        provider: providerName,
      })}
      submitLabel={t("connectedAccounts.actions.confirmUnbind")}
      cancelLabel={t("actions.cancel")}
      danger
      submitting={submitting}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        onConfirm();
      }}
    />
  );
}
