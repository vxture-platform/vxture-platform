"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Banner,
  Button,
  DataTable,
  FieldLabel,
  FormPageTemplate,
  Icon,
  Input,
  NativeSelect,
  StatusBadge,
  Switch,
  ViewHeader,
} from "@vxture/design-system";
import type { DataTableColumn, IconName } from "@vxture/design-system";
import { PageSection, SummaryStrip } from "@/layout/shell";
import { PlannedBadge, PlannedNotice } from "@/components/planned";
import { useTranslations } from "next-intl";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { fetchMembers, transferTenantOwner } from "@/api/console-bff";
import type { MemberRecord } from "@/entities/console";

type BooleanSettingKey =
  | "inviteApproval"
  | "externalMembers"
  | "mfaRequired"
  | "trustedDeviceReview"
  | "exportApproval"
  | "apiKeyCreation";
type SelectSettingKey = "defaultRole" | "sessionTimeout" | "auditRetention";
type SettingKey = BooleanSettingKey | SelectSettingKey;
type SectionKey = "access" | "security" | "data";

type TenantSettingState = Record<BooleanSettingKey, boolean> &
  Record<SelectSettingKey, string>;

type SettingRow = {
  key: SettingKey;
  icon: IconName;
  type: "switch" | "select";
  options?: string[];
};

type SettingSection = {
  key: SectionKey;
  icon: IconName;
  rows: SettingRow[];
};

const STORAGE_KEY = "vxture.console.tenantSettings.v1";

const DEFAULT_TENANT_SETTINGS: TenantSettingState = {
  inviteApproval: true,
  externalMembers: false,
  defaultRole: "member",
  mfaRequired: false,
  trustedDeviceReview: true,
  sessionTimeout: "24h",
  auditRetention: "180",
  exportApproval: true,
  apiKeyCreation: false,
};

const SETTING_SECTIONS: SettingSection[] = [
  {
    key: "access",
    icon: "users",
    rows: [
      { key: "inviteApproval", icon: "user-switch", type: "switch" },
      { key: "externalMembers", icon: "globe", type: "switch" },
      {
        key: "defaultRole",
        icon: "shield-check",
        type: "select",
        options: ["readonly", "member", "admin"],
      },
    ],
  },
  {
    key: "security",
    icon: "shield-check",
    rows: [
      { key: "mfaRequired", icon: "key", type: "switch" },
      { key: "trustedDeviceReview", icon: "server", type: "switch" },
      {
        key: "sessionTimeout",
        icon: "clock",
        type: "select",
        options: ["8h", "24h", "7d"],
      },
    ],
  },
  {
    key: "data",
    icon: "database",
    rows: [
      {
        key: "auditRetention",
        icon: "clock",
        type: "select",
        options: ["90", "180", "365"],
      },
      { key: "exportApproval", icon: "arrow-down", type: "switch" },
      { key: "apiKeyCreation", icon: "api", type: "switch" },
    ],
  },
];

function readStoredSettings(): TenantSettingState {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return DEFAULT_TENANT_SETTINGS;
    }

    return {
      ...DEFAULT_TENANT_SETTINGS,
      ...(JSON.parse(stored) as Partial<TenantSettingState>),
    };
  } catch {
    return DEFAULT_TENANT_SETTINGS;
  }
}

export function SettingsPage() {
  const t = useTranslations("settings");
  const [settings, setSettings] = useState<TenantSettingState>(
    DEFAULT_TENANT_SETTINGS,
  );
  const [hydrated, setHydrated] = useState(false);
  const [messageKey, setMessageKey] = useState<string | null>(null);

  useEffect(() => {
    setSettings(readStoredSettings());
    setHydrated(true);
  }, []);

  // ── 转让所有权(owner 2026-08-21 裁定,决策 3 批一)──────────────────────────
  const { session, refreshSession } = useConsoleSession();
  const tenantId = session.tenant?.id ?? null;
  const tenantName = session.tenant?.name ?? "";
  const isOrgTenant = session.tenant?.tenantType === "organization";

  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState("");
  const [transferConfirm, setTransferConfirm] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferDone, setTransferDone] = useState<string | null>(null);

  useEffect(() => {
    // 个人租户没有可转让的所有权,也就不必拉成员表。
    if (!isOrgTenant || !tenantId) {
      setMembers([]);
      return;
    }
    let alive = true;
    fetchMembers()
      .then((rows) => {
        if (alive) setMembers(rows);
      })
      .catch(() => {
        if (alive) setMembers([]);
      });
    return () => {
      alive = false;
    };
  }, [isOrgTenant, tenantId]);

  /** 我是不是当前 owner。以成员表里自己那行的角色为准,不看 roleLabel 文案。 */
  const isOwner = useMemo(
    () =>
      members.some((m) => m.id === session.user?.id && m.roleCode === "owner"),
    [members, session.user?.id],
  );

  /** 可接收人 = 在职 ∧ 非本人。挂起中的邀请(statusCode 非 active)不算——
   *  转给一个还没接受邀请的人,后端会以 target_not_member 拒掉。 */
  const transferCandidates = useMemo(
    () =>
      members.filter(
        (m) => m.statusCode === "active" && m.id !== session.user?.id,
      ),
    [members, session.user?.id],
  );

  const transferReady =
    transferTarget !== "" && transferConfirm.trim() === tenantName;

  const handleTransfer = useCallback(async () => {
    if (!transferReady) return;
    const target = transferCandidates.find((m) => m.id === transferTarget);
    setTransferBusy(true);
    setTransferError(null);
    try {
      await transferTenantOwner(transferTarget);
      setTransferOpen(false);
      setTransferConfirm("");
      setTransferTarget("");
      setTransferDone(target?.name ?? "");
      // 自己的能力集刚变了(owner → manager),不刷新的话 shell 仍按旧
      // capability 渲染导航,直到下一次整页加载。
      await refreshSession({ silent: true });
      setMembers(await fetchMembers());
    } catch (error) {
      setTransferError(
        error instanceof Error
          ? error.message
          : t("danger.transferOwner.action"),
      );
    } finally {
      setTransferBusy(false);
    }
  }, [refreshSession, t, transferCandidates, transferReady, transferTarget]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [hydrated, settings]);

  const enabledPolicies = (
    Object.keys(DEFAULT_TENANT_SETTINGS) as SettingKey[]
  ).filter((key) => {
    const value = settings[key];
    return typeof value === "boolean"
      ? value
      : value !== DEFAULT_TENANT_SETTINGS[key];
  }).length;

  function updateBooleanSetting(key: BooleanSettingKey, value: boolean) {
    setSettings((current) => ({ ...current, [key]: value }));
    setMessageKey(null);
  }

  function updateSelectSetting(key: SelectSettingKey, value: string) {
    setSettings((current) => ({ ...current, [key]: value }));
    setMessageKey(null);
  }

  function resetDefaults() {
    setSettings(DEFAULT_TENANT_SETTINGS);
    setMessageKey("feedback.reset");
  }

  function saveSettings() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    setMessageKey("feedback.saved");
  }

  function settingStateLabel(row: SettingRow) {
    const value = settings[row.key];
    if (row.type === "switch") {
      return value ? t("states.enabled") : t("states.disabled");
    }

    return t(`options.${row.key}.${value}`);
  }

  /** Policy cell: icon + title + hint. Shared by the settings table and the
   * danger row, which render the same two-line descriptor. */
  const policyCell = (icon: IconName, title: string, hint: string) => (
    <span className="flex min-w-0 items-start gap-sm">
      <Icon
        name={icon}
        size="sm"
        fallback="placeholder"
        aria-hidden="true"
        className="mt-2xs shrink-0 text-muted-foreground"
      />
      <span className="flex min-w-0 flex-col gap-2xs">
        <strong className="text-label-md text-foreground">{title}</strong>
        <span className="text-body-sm text-muted-foreground">{hint}</span>
      </span>
    </span>
  );

  /* Three real column headers exist as i18n keys (table.policy / .state /
   * .value), so this is a genuine table rather than a headerless list. */
  const settingColumns: DataTableColumn<SettingRow>[] = [
    {
      id: "policy",
      header: t("table.policy"),
      cell: (row) =>
        policyCell(
          row.icon,
          t(`rows.${row.key}.title`),
          t(`rows.${row.key}.hint`),
        ),
    },
    {
      id: "state",
      header: t("table.state"),
      cell: (row) => {
        const stateLabel = settingStateLabel(row);
        return (
          <StatusBadge
            tone={stateLabel === t("states.disabled") ? "neutral" : "success"}
            dot
          >
            {stateLabel}
          </StatusBadge>
        );
      },
    },
    {
      id: "value",
      header: t("table.value"),
      align: "right",
      cell: (row) =>
        row.type === "switch" ? (
          <Switch
            checked={Boolean(settings[row.key])}
            disabled
            aria-label={t(`rows.${row.key}.title`)}
            onCheckedChange={(checked) =>
              updateBooleanSetting(row.key as BooleanSettingKey, checked)
            }
          />
        ) : (
          <NativeSelect
            wrapperClassName="w-fit"
            value={String(settings[row.key])}
            disabled
            aria-label={t(`rows.${row.key}.title`)}
            onChange={(event) =>
              updateSelectSetting(
                row.key as SelectSettingKey,
                event.target.value,
              )
            }
          >
            {row.options?.map((option) => (
              <option key={option} value={option}>
                {t(`options.${row.key}.${option}`)}
              </option>
            ))}
          </NativeSelect>
        ),
    },
  ];

  return (
    /* Settings is a form page: the reset / save pair belongs in the template's
     * action bar, not floating in the page header. */
    <FormPageTemplate
      header={
        <div className="flex flex-col gap-md">
          <ViewHeader
            icon="settings"
            title={t("title")}
            description={t("description")}
            secondary={<PlannedBadge />}
          />
          <PlannedNotice variant="controls" />
        </div>
      }
      footer={
        <>
          <Button size="md" variant="outline" disabled onClick={resetDefaults}>
            <Icon name="x" size="xs" fallback="placeholder" />
            <span>{t("reset")}</span>
          </Button>
          <Button size="md" disabled onClick={saveSettings}>
            <Icon name="check" size="xs" fallback="placeholder" />
            <span>{t("save")}</span>
          </Button>
        </>
      }
    >
      {messageKey ? <Banner tone="success" title={t(messageKey)} /> : null}

      <SummaryStrip
        items={[
          {
            label: t("summary.scope"),
            value: t("summary.scopeValue"),
            aside: <Icon name="settings" size="sm" fallback="placeholder" />,
          },
          {
            label: t("summary.enabled"),
            value: t("summary.enabledValue", { count: enabledPolicies }),
            aside: <Icon name="check" size="sm" fallback="placeholder" />,
          },
          {
            label: t("summary.profile"),
            value: t("summary.profileValue"),
            aside: (
              <Icon name="building-library" size="sm" fallback="placeholder" />
            ),
          },
        ]}
      />

      <PageSection
        icon="faders"
        level={2}
        title={t("general.title")}
        description={t("general.count", { count: SETTING_SECTIONS.length })}
      >
        {SETTING_SECTIONS.map((section) => (
          <PageSection
            key={section.key}
            level={3}
            icon={section.icon}
            title={t(`sections.${section.key}.title`)}
            description={t(`sections.${section.key}.count`, {
              count: section.rows.length,
            })}
          >
            <DataTable
              columns={settingColumns}
              rows={section.rows}
              rowKey={(row) => row.key}
            />
          </PageSection>
        ))}
      </PageSection>

      <PageSection
        tone="raised"
        icon="warning"
        level={2}
        title={t("danger.title")}
        description={t("danger.count")}
      >
        {transferDone !== null ? (
          <Banner
            tone="success"
            title={t("danger.transferOwner.success", { name: transferDone })}
          />
        ) : null}

        {/* 转让所有权(owner 2026-08-21 裁定,决策 3 批一)。个人租户整行不渲染:
            它的 owner 即本人,给一个永远点不动的按钮只是噪音。 */}
        {isOrgTenant ? (
          <div className="flex flex-wrap items-center gap-md">
            <span className="min-w-0 flex-1">
              {policyCell(
                "user-switch",
                t("danger.transferOwner.title"),
                isOwner && transferCandidates.length === 0
                  ? t("danger.transferOwner.noCandidates")
                  : t("danger.transferOwner.hint"),
              )}
            </span>
            <StatusBadge tone="warning">
              {t("danger.confirmRequired")}
            </StatusBadge>
            <Button
              size="md"
              variant="outline"
              disabled={!isOwner || transferCandidates.length === 0}
              {...(!isOwner
                ? { title: t("danger.transferOwner.notOwner") }
                : {})}
              onClick={() => {
                setTransferError(null);
                setTransferDone(null);
                setTransferOpen(true);
              }}
            >
              <Icon name="user-switch" size="xs" fallback="placeholder" />
              <span>{t("danger.transferOwner.action")}</span>
            </Button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-md">
          <span className="min-w-0 flex-1">
            {policyCell(
              "x",
              t("danger.cancelTenant.title"),
              t("danger.cancelTenant.confirmHint"),
            )}
          </span>
          <StatusBadge tone="warning">
            {t("danger.confirmRequired")}
          </StatusBadge>
          {/* 注销仍无后端:决策 3 批二待 owner 裁定(前置条件与软删语义会销毁数据)。 */}
          <Button size="md" variant="outline" disabled>
            <Icon name="x" size="xs" fallback="placeholder" />
            <span>{t("danger.cancelTenant.action")}</span>
          </Button>
        </div>
      </PageSection>

      <AlertDialog
        open={transferOpen}
        onOpenChange={(open) => {
          if (!open && !transferBusy) {
            setTransferOpen(false);
            setTransferConfirm("");
            setTransferError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("danger.transferOwner.dialogTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("danger.transferOwner.dialogBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex flex-col gap-md">
            {transferError !== null ? (
              <Banner tone="danger" title={transferError} />
            ) : null}

            <div className="flex flex-col gap-2xs">
              <FieldLabel htmlFor="transfer-owner-target">
                {t("danger.transferOwner.targetLabel")}
              </FieldLabel>
              <NativeSelect
                id="transfer-owner-target"
                value={transferTarget}
                disabled={transferBusy}
                onChange={(event) => setTransferTarget(event.target.value)}
              >
                <option value="">
                  {t("danger.transferOwner.targetPlaceholder")}
                </option>
                {transferCandidates.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {m.email}
                  </option>
                ))}
              </NativeSelect>
            </div>

            {/* 危险两档的重档:输入租户名。选人是可撤销的,点确认不是。 */}
            <div className="flex flex-col gap-2xs">
              <FieldLabel htmlFor="transfer-owner-confirm">
                {t("danger.transferOwner.confirmLabel")}
              </FieldLabel>
              <Input
                id="transfer-owner-confirm"
                value={transferConfirm}
                placeholder={tenantName}
                disabled={transferBusy}
                autoComplete="off"
                onChange={(event) => setTransferConfirm(event.target.value)}
              />
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={transferBusy}>
              {t("danger.transferOwner.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!transferReady || transferBusy}
              onClick={(event) => {
                event.preventDefault();
                void handleTransfer();
              }}
            >
              {t("danger.transferOwner.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FormPageTemplate>
  );
}
