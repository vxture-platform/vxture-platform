"use client";

/**
 * Shared entry for subscription and member application assignments.
 * @package @vxture/console
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-13
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Banner,
  Button,
  DialogForm,
  NativeSelect,
} from "@vxture/design-system";
import {
  fetchMembers,
  fetchWorkspaces,
  type ConsoleWorkspace,
} from "@/api/console-bff";
import type { MemberRecord } from "@/entities/console";
import { WorkspaceProductSeatsDialog } from "./WorkspaceProductSeatsDialog";

// ============================================================================
// Load the management roster without changing the selected subscription scope.
// ============================================================================
export function ApplicationAccessDialog({
  workspaceId,
  productCode,
  memberId,
  onClose,
}: {
  readonly workspaceId: string;
  readonly productCode?: string;
  readonly memberId?: string;
  readonly onClose: () => void;
}) {
  const t = useTranslations("workspaceProductSeats");
  const [data, setData] = useState<{
    workspaces: ConsoleWorkspace[];
    members: MemberRecord[];
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState(workspaceId);
  useEffect(() => {
    let active = true;
    setData(null);
    setFailed(false);
    void Promise.all([fetchWorkspaces(), fetchMembers()])
      .then(([workspaces, members]) => {
        if (!active) return;
        const usable = workspaces.filter((w) => w.status === "active");
        setData({ workspaces: usable, members });
        setSelected((current) =>
          productCode
            ? workspaceId
            : usable.some((w) => w.id === current)
              ? current
              : (usable[0]?.id ?? ""),
        );
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [workspaceId, productCode, retry]);
  const workspace = data?.workspaces.find((w) => w.id === selected);
  if (!data || !workspace)
    return (
      <DialogForm
        open
        size="lg"
        title={t("accessTitle")}
        submitLabel={t("done")}
        cancelLabel={t("close")}
        onSubmit={(event) => {
          event.preventDefault();
          onClose();
        }}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        {failed ? (
          <>
            <Banner tone="danger" title={t("loadFailed")} />
            <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
              {t("retry")}
            </Button>
          </>
        ) : (
          <p role="status">
            {t(
              !data
                ? "loading"
                : productCode
                  ? "workspaceUnavailable"
                  : "noWorkspaces",
            )}
          </p>
        )}
      </DialogForm>
    );
  return (
    <WorkspaceProductSeatsDialog
      key={`${selected}:${productCode ?? "*"}:${memberId ?? "*"}`}
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      members={data.members}
      productCode={productCode}
      targetMemberId={memberId}
      onClose={onClose}
      onMembersChanged={async () => {
        const members = await fetchMembers();
        setData((current) => (current ? { ...current, members } : current));
      }}
      workspaceSelector={
        <label className="flex flex-col gap-sm">
          <span>{t("workspace")}</span>
          <NativeSelect
            value={selected}
            disabled={!!productCode}
            onChange={(event) => setSelected(event.target.value)}
          >
            {data.workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </NativeSelect>
        </label>
      }
    />
  );
}
