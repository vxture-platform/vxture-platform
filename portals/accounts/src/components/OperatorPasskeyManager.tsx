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

function formatUsage(passkey: OperatorPasskey) {
  const added = new Date(passkey.createdAt).toLocaleDateString();
  if (!passkey.lastUsedAt) return `添加于 ${added} · 尚未使用`;
  return `添加于 ${added} · 最近使用 ${new Date(
    passkey.lastUsedAt,
  ).toLocaleDateString()}`;
}

export function OperatorPasskeyManager() {
  const [passkeys, setPasskeys] = useState<OperatorPasskey[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      setPasskeys(await listOperatorPasskeys());
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = () => withBusy(() => registerOperatorPasskey().then());
  const handleRename = (id: string, current: string | null) => {
    const label = window.prompt("通行密钥名称", current ?? "");
    if (label === null) return;
    const trimmed = label.trim();
    if (!trimmed) return;
    void withBusy(() => renameOperatorPasskey(id, trimmed));
  };
  const handleRevoke = (id: string) => {
    if (!window.confirm("确定删除此通行密钥？删除后将无法用它登录。")) return;
    void withBusy(() => revokeOperatorPasskey(id));
  };

  return (
    <section className="flex flex-col gap-lg">
      <header className="flex flex-wrap items-start justify-between gap-md">
        <div className="flex flex-col gap-2xs">
          <h2 className="text-heading-3 text-foreground">
            通行密钥（Passkey）
          </h2>
          <p className="text-body-sm text-muted-foreground">
            登录运营台时用它替代验证码。一个账号可以注册多把，换设备时不必先解绑。
          </p>
        </div>
        <Button disabled={busy} onClick={handleAdd}>
          <Icon name="plus" size="sm" />
          {busy ? "处理中…" : "添加通行密钥"}
        </Button>
      </header>

      {error ? <Banner tone="danger" title={error} /> : null}

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
          title="还没有通行密钥"
          description="添加一把之后，就可以用指纹、面容或安全密钥登录运营台。"
        />
      ) : (
        <ul className="flex list-none flex-col gap-sm p-none">
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
                      {passkey.label ?? "未命名通行密钥"}
                    </strong>
                    <span className="text-body-sm text-muted-foreground">
                      {formatUsage(passkey)}
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
                    重命名
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onClick={() => handleRevoke(passkey.id)}
                  >
                    删除
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
