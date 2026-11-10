/**
 * OperatorPasskeyManager.tsx - operator passkey management (list/add/rename/revoke).
 * @package @vxture/accounts
 *
 * The credential-management UI for an authenticated operator (P3.4). Lists the
 * operator's registered passkeys and supports adding (registration ceremony),
 * renaming, and revoking. All calls are cookie-authenticated (vx_sid_op) against
 * the IdP on the accounts surface. Revoking the last passkey of a
 * webauthn-required operator is blocked server-side (surfaced as an error).
 *
 * 2026-08-17：整件此前挂 `.vx-auth-primary` / `.vx-auth-hint` / `.vx-auth-link-button`
 * 与 `.vx-passkey-*`——前三个随遗留样式层退役后**没有任何定义**，后一批是
 * accounts 自己 globals.css 里的局部样式。于是这一页的按钮是浏览器默认按钮、
 * 说明文字与正文同色、错误与"加载中"长得一模一样。改为一律走 DS 组件：
 * 列表用 `Card`，动作用 `Button`，错误用 `Banner`，空态用 `EmptyState`。
 */
"use client";

import {
  SecurityVerification,
  useSecurityVerificationControls,
  SecurityCompletion,
} from "./SecurityVerification";
import { useAccountCompletion } from "./AccountCenterShell";
import { AccountHeading } from "./AccountPrimitives";
import { useCallback, useEffect, useState } from "react";
import {
  Banner,
  Button,
  Card,
  useToast,
  EmptyState,
  DialogForm,
  Input,
  Icon,
  Skeleton,
} from "@vxture/design-system";
import {
  listOperatorPasskeys,
  registerOperatorPasskey,
  renameOperatorPasskey,
  revokeOperatorPasskey,
  type OperatorPasskey,
} from "@/api/operator-webauthn";
import { useLocale, useTranslations } from "next-intl";
import { formatDay } from "@vxture-platform/shared";

/* 收 `locale` 与 `t`：`toLocaleDateString()` 不带参数走的是**浏览器默认语言**，
   和界面选的语言没有关系——一个中文界面配英文日期，或者反过来。 */
function formatUsage(
  passkey: OperatorPasskey,
  locale: string,
  t: ReturnType<typeof useTranslations<"passkeys">>,
) {
  const added = formatDay(passkey.createdAt, locale);
  if (!passkey.lastUsedAt) return t("addedNeverUsed", { added });
  return t("addedLastUsed", {
    added,
    lastUsed: formatDay(passkey.lastUsedAt, locale),
  });
}

export function OperatorPasskeyManager() {
  const verification = useSecurityVerificationControls();
  const { toast } = useToast();
  const beginCompletion = useAccountCompletion();
  const [adding, setAdding] = useState(false);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [removing, setRemoving] = useState<OperatorPasskey | null>(null);
  const [removeError, setRemoveError] = useState("");
  const t = useTranslations("passkeys");
  const tCommon = useTranslations("common");
  const formText = useTranslations("accountsForms");
  const locale = useLocale();
  const [passkeys, setPasskeys] = useState<OperatorPasskey[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  /* `null` = 没有错误；`""` = 有错但没有可读信息，渲染时用托底文案。
     不把译文存进 state 有两个理由：`refresh` 是 `useCallback([], …)` 且被
     `useEffect([refresh])` 依赖着，把 `tCommon` 加进依赖会让它每次渲染换身份、
     effect 无限重跑；而且存进 state 的译文在切语言时不会跟着变。 */
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setPasskeys(await listOperatorPasskeys());
    } catch (e) {
      setError(e instanceof Error ? e.message : "");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /* 返回成败。原来只把错误写进 `setError` 就返回，调用方无从知道成没成——
     加确认框之后这一点变成语义的：框关不关，取决于这个 Promise 是否
     rejected。不改成抛出是因为 `handleAdd`/`handleRename` 都是 `void` 调用，
     抛出会变成 unhandled rejection；返回布尔让每个调用点自己决定怎么用。 */
  const withBusy = async (fn: () => Promise<void>): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast({ tone: "success", title: formText("saved") });
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : tCommon("actionFailed"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = () => setAdding(true);
  const [renaming, setRenaming] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const handleRename = (id: string, current: string | null) => {
    setError(null);
    setRenaming({ id, label: current ?? "" });
  };
  // Keep removal feedback in its own modal while consuming the pinned DS.
  async function removePasskey(proofToken: string) {
    if (!removing) return;
    setBusy(true);
    setRemoveError("");
    const completion = beginCompletion();
    try {
      await revokeOperatorPasskey(removing.id, proofToken);
      setRemoving(null);
      completion.complete(<SecurityCompletion realm="workforce" />);
    } catch (reason) {
      completion.cancel();
      setConfirmingRemoval(false);
      setRemoveError(
        reason instanceof Error ? reason.message : t("revokeFailed"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-lg">
      <AccountHeading
        title={t("sectionTitle")}
        icon="key"
        action={
          <Button disabled={busy} onClick={handleAdd}>
            <Icon name="plus" size="sm" />
            {busy ? tCommon("processing") : t("add")}
          </Button>
        }
      />

      {error !== null ? (
        <Banner tone="danger" title={error || tCommon("loadFailed")} />
      ) : null}

      {loading ? (
        // 加载态原先是一行"加载中…"，和"尚未注册通行密钥"、和报错三者同一个
        // 样子——三种完全不同的状态在页面上长得一模一样。
        <div className="flex flex-col gap-sm" aria-busy="true">
          <Skeleton className="h-row-lg w-full" />
          <Skeleton className="h-row-lg w-full" />
        </div>
      ) : error !== null ? null : passkeys.length === 0 ? (
        <EmptyState
          icon="key"
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <ul className="flex list-none flex-col gap-sm p-0">
          {passkeys.map((passkey) => (
            <li key={passkey.id}>
              <Card
                surface="soft"
                className="accounts-section flex-row flex-wrap items-center justify-between gap-md px-lg py-md"
              >
                <div className="flex min-w-0 items-center gap-md">
                  <span
                    className="flex size-media-xs shrink-0 items-center justify-center rounded-full bg-primary-muted text-primary-text"
                    aria-hidden="true"
                  >
                    <Icon name="key" size="sm" />
                  </span>
                  <div className="flex min-w-0 flex-col gap-2xs">
                    <strong className="truncate text-label text-foreground">
                      {passkey.label ?? t("unnamed")}
                    </strong>
                    <span className="text-body-small text-muted-foreground">
                      {formatUsage(passkey, locale, t)}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2xs">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => handleRename(passkey.id, passkey.label)}
                  >
                    {t("rename")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setRemoveError("");
                      setConfirmingRemoval(false);
                      setRemoving(passkey);
                    }}
                  >
                    {t("delete")}
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <DialogForm
        open={adding}
        size="sm"
        title={t("add")}
        submitLabel={verification.label || formText("continue")}
        cancelLabel={formText("cancel")}
        submitDisabled={verification.disabled}
        submitting={busy}
        onOpenChange={(value) => {
          if (!busy) setAdding(value);
        }}
        onSubmit={(event) => {
          event.preventDefault();
          verification.submit();
        }}
      >
        <SecurityVerification
          controls={verification.controls}
          realm="workforce"
          operation="passkey-add"
          target=""
          onBusyChange={setBusy}
          onVerified={async (proofToken) => {
            const completion = beginCompletion();
            try {
              await registerOperatorPasskey(proofToken);
              setAdding(false);
              completion.complete(<SecurityCompletion realm="workforce" />);
            } catch (reason) {
              completion.cancel();
              throw reason;
            }
          }}
        />
      </DialogForm>
      <DialogForm
        size="sm"
        title={formText("delete_passkey_title")}
        description={t(
          passkeys.length === 1 ? "consequenceLast" : "consequenceOther",
        )}
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setRemoving(null);
        }}
        danger
        submitDisabled={confirmingRemoval && verification.disabled}
        submitting={busy}
        pendingLabel={tCommon("processing")}
        submitLabel={confirmingRemoval ? verification.label : t("delete")}
        cancelLabel={formText("cancel")}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) {
            if (confirmingRemoval) verification.submit();
            else setConfirmingRemoval(true);
          }
        }}
      >
        <p>
          {removing
            ? t("confirmTarget", { name: removing.label ?? t("unnamed") })
            : null}
        </p>
        {confirmingRemoval && removing ? (
          <SecurityVerification
            controls={verification.controls}
            realm="workforce"
            operation="passkey-remove"
            target={removing.id}
            onBusyChange={setBusy}
            onVerified={removePasskey}
          />
        ) : null}
        {removeError ? <Banner tone="danger" title={removeError} /> : null}
      </DialogForm>
      <DialogForm
        size="sm"
        title={t("rename")}
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setRenaming(null);
        }}
        submitLabel={formText("save")}
        cancelLabel={formText("cancel")}
        submitting={busy}
        submitDisabled={!renaming?.label.trim()}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!renaming || busy) return;
          const ok = await withBusy(() =>
            renameOperatorPasskey(renaming.id, renaming.label.trim()),
          );
          if (ok) setRenaming(null);
        }}
      >
        <label htmlFor="passkey-label">
          {t("rename")}
          <span className="accounts-required" aria-hidden="true">
            *
          </span>
        </label>
        <Input
          id="passkey-label"
          required
          aria-label={t("rename")}
          value={renaming?.label ?? ""}
          maxLength={100}
          disabled={busy}
          onChange={(event) =>
            setRenaming((current) =>
              current ? { ...current, label: event.target.value } : null,
            )
          }
        />
        {error ? <Banner tone="danger" title={error} /> : null}
      </DialogForm>
    </section>
  );
}
