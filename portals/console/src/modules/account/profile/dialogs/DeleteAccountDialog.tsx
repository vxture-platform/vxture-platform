"use client";

/**
 * DeleteAccountDialog — 删除账号的资格清单 + 知悉确认(批 5b,050-account §7)。
 *
 * 打开即读资格快照:阻断项(红,任一命中提交禁用)/ 确认项(删除将作废的东西)/
 * 自动处理项(删除时连带)。勾「我已知悉」才能提交;提交成功账号进入 30 天保留期,
 * 调用方随即登出。快照在提交时由 BFF 再判一次,409 deletion_blocked 就把新阻断
 * 项画出来。
 */

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  Banner,
  Checkbox,
  DialogForm,
  Label,
  StatusBadge,
} from "@vxture/design-system";
import {
  ConsoleBffError,
  fetchAccountDeletion,
  requestAccountDeletion,
} from "@/api/console-bff";
import type {
  AccountDeletionItem,
  AccountDeletionState,
} from "@/entities/console";
import { LoadFailedEmpty } from "@/components/load/LoadFailed";

function itemValues(item: AccountDeletionItem) {
  return {
    count: item.count ?? 0,
    amount: item.amount ?? "0.00",
    currency: item.currency ?? "CNY",
    names: item.names?.join(" / ") ?? "",
  };
}

export function DeleteAccountDialog({
  open,
  onClose,
  onDeleted,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onDeleted: (state: AccountDeletionState) => void;
}) {
  const t = useTranslations("profilePage.deletion");
  const [state, setState] = useState<AccountDeletionState | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setFailed(false);
    setError(null);
    setAcknowledged(false);
    fetchAccountDeletion()
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

  const canSubmit = Boolean(state?.canDelete) && acknowledged && !loading;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const next = await requestAccountDeletion();
      onDeleted(next);
    } catch (err) {
      if (err instanceof ConsoleBffError && err.status === 409) {
        // 资格已变化:重读快照,新阻断项会画出来。
        setError(t("errorBlocked"));
        try {
          setState(await fetchAccountDeletion());
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
    items: AccountDeletionItem[],
    prefix: "blockers" | "confirmations" | "auto",
  ) =>
    items.length === 0 ? null : (
      <div className="flex flex-col gap-xs">
        <p className="text-label-md text-foreground">{title}</p>
        <ul className="flex flex-col gap-xs">
          {items.map((item) => (
            <li
              key={item.code}
              className="flex items-start gap-md text-body-sm"
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
      size="md"
      title={t("dialog.title")}
      description={t("dialog.description", {
        days: state?.retentionDays ?? 30,
      })}
      submitLabel={t("dialog.submit")}
      cancelLabel={t("dialog.cancel")}
      submitting={submitting}
      submitDisabled={!canSubmit}
      onOpenChange={(next) => {
        if (!next && !submitting) onClose();
      }}
      onSubmit={(event) => void submit(event)}
    >
      {failed ? (
        <LoadFailedEmpty />
      ) : loading || !state ? (
        <p className="py-sm text-body-sm text-muted-foreground">
          {t("dialog.loading")}
        </p>
      ) : (
        <div className="flex flex-col gap-lg">
          {error ? <Banner tone="danger" title={error} /> : null}
          {state.blockers.length > 0 ? (
            <Banner tone="danger" title={t("dialog.blocked")} />
          ) : null}
          {renderList(
            t("dialog.blockersTitle"),
            "danger",
            state.blockers,
            "blockers",
          )}
          {renderList(
            t("dialog.confirmTitle"),
            "warning",
            state.confirmations,
            "confirmations",
          )}
          {renderList(
            t("dialog.autoTitle"),
            "neutral",
            state.autoActions,
            "auto",
          )}
          <Label className="flex items-start gap-sm text-body-sm">
            <Checkbox
              checked={acknowledged}
              disabled={!state.canDelete}
              onCheckedChange={(value) => setAcknowledged(value === true)}
              aria-label={t("dialog.acknowledge")}
            />
            <span>
              {t("dialog.acknowledge", { days: state.retentionDays })}
            </span>
          </Label>
        </div>
      )}
    </DialogForm>
  );
}
