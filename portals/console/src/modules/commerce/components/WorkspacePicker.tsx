"use client";

/**
 * WorkspacePicker.tsx — 订单归属（租户 / 工作区）选择器。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 「给谁买」：多租户用户在下单前确认订阅开通到哪个租户的工作区，防止买错
 * 归属。切换走 TenantProvider 的既有 seam（switchTenantContext），与页头的
 * 租户切换同一条路；单租户时渲染静态卡，不假装能点。
 * 工作区维度目前每租户只有 default 一个（后端尚无多工作区），所以选择粒度
 * 是租户。展示结构（owner 2026-08-20）：第一行 = 租户名称（主）+ 工作区
 * 名称（副）；第二行 = workspace_no 可视码。UUID 任何场景不得展示。
 * 行样式统一走 sectionKit 信息行规格。
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Banner,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icon,
  cn,
} from "@vxture/design-system";
import type { TenantContext } from "@/entities/console";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { useTenant } from "@/features/tenant";
import { infoRow, infoRowGlyph, infoRowText } from "./sectionKit";

/** 可视码按 4 位分组展示（workspace_no 15 位 = 租户号 12 位 + 序号 3 位）。 */
function formatVisibleNo(no: string | null | undefined): string | null {
  if (!no) return null;
  return no.replace(/(\d{4})(?=\d)/g, "$1 ");
}

function TenantGlyph({ type }: { readonly type: "personal" | "organization" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        infoRowGlyph,
        type === "personal"
          ? "bg-primary-muted-hover text-primary-hover"
          : "border border-success-border bg-success-muted text-success-text",
      )}
    >
      <Icon name={type === "personal" ? "user" : "buildings"} size="sm" />
    </span>
  );
}

function TenantLine({
  tenant,
  labels,
}: {
  readonly tenant: TenantContext;
  readonly labels: { ws: string };
}) {
  // 结构（owner 2026-08-20 条 4）：第一行 = 租户名称（主）+ 工作区名称（副）；
  // 第二行 = workspace_no 可视码小字。UUID/内部 id 一律不出现。
  const no = formatVisibleNo(tenant.workspaceNo);
  return (
    <span className={infoRowText}>
      <span className="flex min-w-0 items-baseline gap-xs">
        <span className="truncate text-label-md text-foreground">
          {tenant.name}
        </span>
        <span className="truncate text-body-sm text-muted-foreground">
          {tenant.workspaceName ?? labels.ws}
        </span>
      </span>
      {no ? (
        <span className="truncate text-body-sm text-muted-foreground tabular-nums">
          {no}
        </span>
      ) : null}
    </span>
  );
}

export interface WorkspacePickerProps {
  /** 切换完成后回调（页面借此重拉租户相关数据）。 */
  readonly onSwitched?: () => void;
}

export function WorkspacePicker({ onSwitched }: WorkspacePickerProps) {
  const t = useTranslations("workspacePicker");
  const { session } = useConsoleSession();
  const { tenantList, switchTenantContext } = useTenant();
  const [busy, setBusy] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  // TenantListItem 缺工作区/可视码，按 id 回查 session 里的完整上下文。
  const detailById = useMemo(() => {
    const map = new Map<string, TenantContext>();
    for (const item of session.tenantOptions ?? []) map.set(item.id, item);
    if (session.tenant) map.set(session.tenant.id, session.tenant);
    return map;
  }, [session.tenant, session.tenantOptions]);

  const current = session.tenant;
  if (!current) return null;

  const labels = { ws: t("defaultWorkspace") };
  const options = tenantList
    .map((item) => detailById.get(item.id))
    .filter((item): item is TenantContext => Boolean(item));
  const switchable = options.length > 1;

  const triggerBody = (
    <>
      <TenantGlyph type={current.tenantType ?? "organization"} />
      <TenantLine tenant={current} labels={labels} />
    </>
  );

  if (!switchable) {
    return <div className={infoRow}>{triggerBody}</div>;
  }

  return (
    <div className="flex flex-col gap-sm">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            disabled={busy}
            className="h-auto w-full justify-start gap-md px-md py-sm text-left font-normal"
          >
            {triggerBody}
            <span className="shrink-0 text-muted-foreground" aria-hidden="true">
              <Icon name={busy ? "spinner" : "chevron-down"} size="sm" />
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-(--radix-dropdown-menu-trigger-width)"
        >
          {options.map((tenant) => {
            const isCurrent = tenant.id === current.id;
            return (
              <DropdownMenuItem
                key={tenant.id}
                disabled={busy}
                onSelect={() => {
                  if (isCurrent) return;
                  setBusy(true);
                  setSwitchError(null);
                  void switchTenantContext(tenant.id)
                    .then(() => onSwitched?.())
                    .catch(() => setSwitchError(t("switchFailed")))
                    .finally(() => setBusy(false));
                }}
                className="gap-md py-sm"
              >
                <TenantGlyph type={tenant.tenantType ?? "organization"} />
                <TenantLine tenant={tenant} labels={labels} />
                {isCurrent ? (
                  <span className="shrink-0 text-primary" aria-hidden="true">
                    <Icon name="check" size="sm" />
                  </span>
                ) : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      {switchError ? <Banner tone="danger" title={switchError} /> : null}
    </div>
  );
}
