"use client";

/**
 * WorkspaceProductSeatsDialog.tsx — 一个工作空间里每个产品的席位：谁在用、还剩几个。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * owner 2026-09-27 裁定①「要明细表，每个产品清楚谁在当前使用」+ ②「超限硬拦截」。
 *
 * ── 为什么挂在工作空间上，不挂在成员行上 ──
 * 席位是 (工作空间, 产品) 的额度，不是人的属性。从成员行进来就得先回答「哪个工作空间」
 * ——一个人可以在五个空间里，那会变成 5×产品数 行。按空间进来只有「产品数」行，
 * 而且这正是 owner 要的那个方向：**按产品看是谁在用**。
 *
 * ── 逐个指派、逐个报错（同 MemberWorkspacesDialog 的取舍）──
 * 每一次指派都是一次独立的授权变更，而失败原因有四种、下一步动作完全不同：
 * 席位满了（去发布档位改 seat.max）／他已经有了（什么都不用做）／这个产品没订阅（去订阅）
 * ／他不在这个空间（先把人加进来）。攒成一次「保存」只能说一句「保存失败」。
 *
 * ── 上限读不到显示「—」，不显示 0 ──
 * seatMax 为 null 是「没读到」，不是「零个席位」；-1 是目录的无限哨兵。
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Banner,
  Button,
  DialogForm,
  EmptyState,
  NativeSelect,
  StatusBadge,
} from "@vxture/design-system";
import {
  ConsoleBffError,
  PRODUCT_SEAT_ERROR_CODES,
  fetchProductSeats,
  grantProductSeat,
  revokeProductSeat,
  type ProductSeatErrorCode,
  type ProductSeatRow,
} from "@/api/console-bff";
import type { MemberRecord } from "@/entities/console";

export function WorkspaceProductSeatsDialog({
  workspaceId,
  workspaceName,
  members,
  onClose,
}: {
  readonly workspaceId: string;
  readonly workspaceName: string;
  /** 本租户成员全集；这里只用属于本空间的那些（席位候选人必须先是本空间成员）。 */
  readonly members: MemberRecord[];
  readonly onClose: () => void;
}) {
  const t = useTranslations("workspaceProductSeats");

  const [rows, setRows] = useState<ProductSeatRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* 一次只处理一个动作：两个同时在飞，失败提示会互相盖掉。 */
  const [busy, setBusy] = useState<string | null>(null);
  /** 每个产品行上「要指派谁」的选择。 */
  const [picked, setPicked] = useState<Record<string, string>>({});

  const candidates = members.filter((m) =>
    m.workspaces.some((w) => w.id === workspaceId),
  );

  const reload = useCallback(async () => {
    try {
      setRows(await fetchProductSeats(workspaceId));
    } catch {
      setLoadFailed(true);
    }
  }, [workspaceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const errorText = useCallback(
    (caught: unknown) => {
      const code =
        caught instanceof ConsoleBffError &&
        (PRODUCT_SEAT_ERROR_CODES as readonly string[]).includes(caught.message)
          ? (caught.message as ProductSeatErrorCode)
          : null;
      return code ? t(`errors.${code}`) : t("errors.generic");
    },
    [t],
  );

  async function act(key: string, run: () => Promise<void>): Promise<void> {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await run();
      await reload();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(null);
    }
  }

  /** 上限文案：null 显示「—」（读不到），-1 显示无限，其余显示数字。 */
  function limitLabel(seatMax: number | null): string {
    if (seatMax === null) return "—";
    if (seatMax === -1) return t("unlimited");
    return String(seatMax);
  }

  function isFull(row: ProductSeatRow): boolean {
    if (row.seatMax === null || row.seatMax === -1) return false;
    return row.occupied >= row.seatMax;
  }

  return (
    <DialogForm
      open
      size="lg"
      title={t("title", { name: workspaceName })}
      description={t("description")}
      /* 没有「保存」：每一次指派做完即生效。 */
      submitLabel={t("done")}
      cancelLabel={t("close")}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {error ? <Banner tone="danger" title={error} /> : null}
      {loadFailed ? <Banner tone="danger" title={t("loadFailed")} /> : null}

      {rows === null && !loadFailed ? (
        <EmptyState icon="clock" title={t("loading")} />
      ) : rows && rows.length === 0 ? (
        <EmptyState
          icon="cube"
          title={t("noProducts")}
          description={t("noProductsHint")}
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {(rows ?? []).map((row) => {
            const full = isFull(row);
            const free = candidates.filter(
              (m) => !row.holders.some((h) => h.userId === m.accountId),
            );
            const pick = picked[row.productId] ?? "";
            return (
              <li key={row.productId} className="flex flex-col gap-sm py-md">
                <span className="flex items-center justify-between gap-md">
                  <span className="truncate text-label-md text-foreground">
                    {row.productName}
                  </span>
                  <StatusBadge tone={full ? "warning" : "info"}>
                    {t("occupancy", {
                      occupied: row.occupied,
                      limit: limitLabel(row.seatMax),
                    })}
                  </StatusBadge>
                </span>

                {row.holders.length === 0 ? (
                  <span className="text-body-sm text-muted-foreground">
                    {t("nobody")}
                  </span>
                ) : (
                  <ul className="flex flex-col gap-2xs">
                    {row.holders.map((h) => (
                      <li
                        key={h.userId}
                        className="flex items-center justify-between gap-md"
                      >
                        <span className="truncate text-body-sm text-foreground">
                          {h.displayName ?? h.userNo}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy !== null}
                          onClick={() =>
                            void act(`${row.productId}:${h.userId}`, () =>
                              revokeProductSeat(
                                workspaceId,
                                row.productId,
                                h.userId,
                              ),
                            )
                          }
                        >
                          {t("revoke")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}

                <span className="flex items-center gap-sm">
                  <NativeSelect
                    id={`seat-assign-${row.productId}`}
                    aria-label={t("assignTo")}
                    value={pick}
                    disabled={busy !== null || free.length === 0}
                    onChange={(event) =>
                      setPicked((cur) => ({
                        ...cur,
                        [row.productId]: event.target.value,
                      }))
                    }
                  >
                    <option value="">{t("assignPlaceholder")}</option>
                    {free.map((m) => (
                      <option key={m.accountId} value={m.accountId}>
                        {m.name}
                      </option>
                    ))}
                  </NativeSelect>
                  <Button
                    size="sm"
                    disabled={busy !== null || full || pick === ""}
                    onClick={() =>
                      void act(`${row.productId}:assign`, async () => {
                        await grantProductSeat(
                          workspaceId,
                          row.productId,
                          pick,
                        );
                        setPicked((cur) => ({ ...cur, [row.productId]: "" }));
                      })
                    }
                  >
                    {t("assign")}
                  </Button>
                </span>
                {full ? (
                  <span className="text-body-sm text-muted-foreground">
                    {t("fullHint")}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </DialogForm>
  );
}
