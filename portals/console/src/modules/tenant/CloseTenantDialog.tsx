"use client";

/**
 * CloseTenantDialog — 注销组织租户(走查 2026-09-05),照删除账号对话框的形状。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 打开即读资格快照:阻断 / 确认 / 连带动作三档各成一块;有阻断项就提交不了。
 * 落锤条件:资格通过 + 勾过知悉 + 输入租户名称。重大操作:lg 档、警示在最上面、
 * 各块之间松开(owner 走查:弹窗不能又小又挤)。提交遇 409 说明资格刚变,重读快照。
 */

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  Banner,
  Checkbox,
  DialogForm,
  Input,
  Label,
  Spinner,
  StatusBadge,
} from "@vxture/design-system";
import {
  ConsoleBffError,
  fetchTenantClosure,
  requestTenantClosure,
} from "@/api/console-bff";
import type { TenantClosureItem, TenantClosureState } from "@/entities/console";

function itemValues(item: TenantClosureItem) {
  return {
    count: item.count ?? 0,
    amount: item.amount ?? "0.00",
    currency: item.currency ?? "CNY",
  };
}

export function CloseTenantDialog({
  open,
  tenantName,
  onClose,
  onClosed,
}: {
  readonly open: boolean;
  readonly tenantName: string;
  readonly onClose: () => void;
  readonly onClosed: () => void;
}) {
  const t = useTranslations("tenantInfoPage.closure");
  const [state, setState] = useState<TenantClosureState | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setFailed(false);
    setError(null);
    setAcknowledged(false);
    setConfirmName("");
    fetchTenantClosure()
      .then((next) => {
        if (active) setState(next);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  if (!open) return null;

  const canSubmit =
    Boolean(state?.canClose) &&
    acknowledged &&
    confirmName.trim() === tenantName &&
    !loading;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await requestTenantClosure(confirmName.trim());
      onClosed();
    } catch (err) {
      if (err instanceof ConsoleBffError && err.status === 409) {
        setError(t("errorBlocked"));
        try {
          setState(await fetchTenantClosure());
        } catch {
          /* 保持上一次的快照 */
        }
      } else {
        setError(
          err instanceof ConsoleBffError && err.message
            ? err.message
            : t("error"),
        );
      }
      setSubmitting(false);
    }
  }

  const renderList = (
    title: string,
    tone: "danger" | "warning" | "neutral",
    items: TenantClosureItem[],
    prefix: "blockers" | "confirmations" | "auto",
  ) =>
    items.length === 0 ? null : (
      <div className="flex flex-col gap-sm">
        <p className="text-label-md text-foreground">{title}</p>
        <ul className="flex flex-col gap-sm">
          {items.map((item) => (
            <li
              key={item.code}
              className="flex items-start gap-md text-body-md"
            >
              <StatusBadge tone={tone}>
                {t(`${prefix}.${item.code}.tag`)}
              </StatusBadge>
              <span className="min-w-0 flex-1 text-muted-foreground">
                {t(`${prefix}.${item.code}.text`, itemValues(item))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <DialogForm
      open
      danger
      size="lg"
      title={t("title", { name: tenantName })}
      description={t("description")}
      submitLabel={t("submit")}
      cancelLabel={t("cancel")}
      submitting={submitting}
      submitDisabled={!canSubmit}
      onOpenChange={(next) => {
        if (!next && !submitting) onClose();
      }}
      onSubmit={(event) => void submit(event)}
    >
      <div className="flex flex-col gap-xl">
        <Banner tone="danger" title={t("warning")} />
        {error ? <Banner tone="danger" title={error} /> : null}
        {failed ? <Banner tone="danger" title={t("loadFailed")} /> : null}
        {loading ? (
          <span className="flex items-center gap-sm text-body-md text-muted-foreground">
            <Spinner size="sm" />
            {t("loading")}
          </span>
        ) : null}

        {state ? (
          <>
            {renderList(
              t("blockersTitle"),
              "danger",
              state.blockers,
              "blockers",
            )}
            {state.blockers.length === 0 ? (
              <Banner tone="success" title={t("eligible")} />
            ) : null}
            {renderList(
              t("confirmationsTitle"),
              "warning",
              state.confirmations,
              "confirmations",
            )}
            {renderList(t("autoTitle"), "neutral", state.autoActions, "auto")}
          </>
        ) : null}

        <div className="flex flex-col gap-sm">
          <p className="text-label-md text-foreground">{t("confirmTitle")}</p>
          <Label className="flex items-start gap-sm text-body-md">
            <Checkbox
              checked={acknowledged}
              disabled={!state?.canClose}
              onCheckedChange={(value) => setAcknowledged(value === true)}
              aria-label={t("ackConfirm")}
            />
            <span>{t("ackConfirm")}</span>
          </Label>
          <div className="flex flex-col gap-xs">
            <Label htmlFor="close-tenant-confirm" className="text-label-md">
              {t("confirmLabel", { name: tenantName })}
            </Label>
            <Input
              id="close-tenant-confirm"
              value={confirmName}
              disabled={!state?.canClose}
              onChange={(event) => setConfirmName(event.target.value)}
            />
          </div>
        </div>
      </div>
    </DialogForm>
  );
}
