"use client";

/**
 * Workspace application assignments shared by subscription and member management.
 * @package @vxture/console
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-13
 *
 * Assignments take effect individually. Workspace membership is required first;
 * the database enforces the shared product seat limit for all management clients.
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
  addWorkspaceMember,
} from "@/api/console-bff";
import type { MemberRecord } from "@/entities/console";

export function WorkspaceProductSeatsDialog({
  workspaceId,
  workspaceName,
  members,
  onClose,
  productCode,
  targetMemberId,
  workspaceSelector,
  onMembersChanged,
}: {
  readonly workspaceId: string;
  readonly workspaceName: string;
  /** 本租户成员全集；这里只用属于本空间的那些（席位候选人必须先是本空间成员）。 */
  readonly members: MemberRecord[];
  readonly onClose: () => void;
  readonly productCode?: string | undefined;
  readonly targetMemberId?: string | undefined;
  readonly workspaceSelector?: import("react").ReactNode;
  readonly onMembersChanged?: () => Promise<void>;
}) {
  const t = useTranslations("workspaceProductSeats");

  const [rows, setRows] = useState<ProductSeatRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* 一次只处理一个动作：两个同时在飞，失败提示会互相盖掉。 */
  const [busy, setBusy] = useState<string | null>(null);
  /** 每个产品行上「要指派谁」的选择。 */
  const [picked, setPicked] = useState<Record<string, string>>({});

  const candidates = members.filter(
    (m) =>
      m.status === "Active" &&
      (!targetMemberId || m.accountId === targetMemberId) &&
      m.workspaces.some((w) => w.id === workspaceId),
  );

  const reload = useCallback(async () => {
    try {
      const data = await fetchProductSeats(workspaceId);
      setRows(
        productCode
          ? data.filter((row) => row.productCode === productCode)
          : data,
      );
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [workspaceId, productCode]);

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
      {workspaceSelector}
      {onMembersChanged
        ? members
            .filter(
              (m) =>
                m.status === "Active" &&
                (!targetMemberId || m.accountId === targetMemberId) &&
                !m.workspaces.some((w) => w.id === workspaceId),
            )
            .map((m) => (
              <div
                key={m.accountId}
                className="flex flex-wrap items-center justify-between gap-sm"
              >
                <span className="text-body-sm text-muted-foreground">
                  {t("notInWorkspace", { name: m.name })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() =>
                    void act(`join:${m.accountId}`, async () => {
                      await addWorkspaceMember(workspaceId, m.accountId);
                      await onMembersChanged?.();
                    })
                  }
                >
                  {t("joinWorkspace")}
                </Button>
              </div>
            ))
        : null}
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
            const pick =
              targetMemberId && free.some((m) => m.accountId === targetMemberId)
                ? targetMemberId
                : (picked[row.productId] ?? "");
            const visibleHolders = row.holders.filter(
              (h) => !targetMemberId || h.userId === targetMemberId,
            );
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

                {visibleHolders.length === 0 ? (
                  <span className="text-body-sm text-muted-foreground">
                    {t(targetMemberId ? "memberUnassigned" : "nobody")}
                  </span>
                ) : (
                  <ul className="flex flex-col gap-2xs">
                    {visibleHolders.map((h) => (
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
