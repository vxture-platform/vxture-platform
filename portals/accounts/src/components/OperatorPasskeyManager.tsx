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

import { useCallback, useEffect, useState } from "react";
import {
  Banner,
  Button,
  Card,
  DestructiveButton,
  EmptyState,
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
import { useConfirmLabels } from "@/lib/destructive";

/* 收 `locale` 与 `t`：`toLocaleDateString()` 不带参数走的是**浏览器默认语言**，
   和界面选的语言没有关系——一个中文界面配英文日期，或者反过来。 */
function formatUsage(
  passkey: OperatorPasskey,
  locale: string,
  t: ReturnType<typeof useTranslations<"passkeys">>,
) {
  const added = new Date(passkey.createdAt).toLocaleDateString(locale);
  if (!passkey.lastUsedAt) return t("addedNeverUsed", { added });
  return t("addedLastUsed", {
    added,
    lastUsed: new Date(passkey.lastUsedAt).toLocaleDateString(locale),
  });
}

export function OperatorPasskeyManager() {
  const withLabels = useConfirmLabels();
  const t = useTranslations("passkeys");
  const tCommon = useTranslations("common");
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
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : tCommon("actionFailed"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = () => withBusy(() => registerOperatorPasskey().then());
  const handleRename = (id: string, current: string | null) => {
    const label = window.prompt(t("renamePrompt"), current ?? "");
    if (label === null) return;
    const trimmed = label.trim();
    if (!trimmed) return;
    void withBusy(() => renameOperatorPasskey(id, trimmed));
  };
  /* 原来是 `window.confirm`：一句没有主语的「确定删除此通行密钥？」——删的是
     哪一把、删完还剩几把、会不会把自己锁在门外，一个字都没有。而且原生
     对话框会阻塞整个页面。改走 DS 的确认契约，落锤重新抛出，失败时框不关。 */
  const revokePasskey = async (id: string) => {
    const ok = await withBusy(() => revokeOperatorPasskey(id));
    if (!ok) throw new Error(t("revokeFailed"));
  };

  return (
    <section className="flex flex-col gap-lg">
      <header className="flex flex-wrap items-start justify-between gap-md">
        <div className="flex flex-col gap-2xs">
          <h2 className="text-heading-3 text-foreground">
            {t("sectionTitle")}
          </h2>
          <p className="text-body-sm text-muted-foreground">
            {t("sectionDescription")}
          </p>
        </div>
        <Button disabled={busy} onClick={handleAdd}>
          <Icon name="plus" size="sm" />
          {busy ? tCommon("processing") : t("add")}
        </Button>
      </header>

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
      ) : passkeys.length === 0 ? (
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
                className="flex-row flex-wrap items-center justify-between gap-md px-lg py-md"
              >
                <div className="flex min-w-0 items-center gap-md">
                  <span
                    className="flex size-media-xs shrink-0 items-center justify-center rounded-full bg-primary-muted text-primary-text"
                    aria-hidden="true"
                  >
                    <Icon name="key" size="sm" />
                  </span>
                  <div className="flex min-w-0 flex-col gap-2xs">
                    <strong className="truncate text-label-md text-foreground">
                      {passkey.label ?? t("unnamed")}
                    </strong>
                    <span className="text-body-sm text-muted-foreground">
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
                  <DestructiveButton
                    size="sm"
                    disabled={busy}
                    confirm={withLabels({
                      verb: t("delete"),
                      target: t("confirmTarget", {
                        name: passkey.label ?? t("unnamed"),
                      }),
                      /* 「这是最后一把」是这一页唯一真正要紧的事实，而它此前
                         一个字都没写。服务端只在「该运营账号强制 webauthn」时
                         才拒绝删最后一把，前端看不到那个开关，所以它是后果里
                         的一句提醒，不是 precondition——precondition 是闩，写成
                         闩会把合法的删除也挡住。 */
                      consequence: t(
                        passkeys.length === 1
                          ? "consequenceLast"
                          : "consequenceOther",
                      ),
                      onConfirm: () => revokePasskey(passkey.id),
                    })}
                  >
                    {t("delete")}
                  </DestructiveButton>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
