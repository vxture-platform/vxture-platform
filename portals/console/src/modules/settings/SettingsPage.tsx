"use client";

import { useEffect, useState } from "react";
import {
  Banner,
  Button,
  DataTable,
  FormPageTemplate,
  Icon,
  NativeSelect,
  StatusBadge,
  Switch,
  ViewHeader,
} from "@vxture/design-system";
import type { DataTableColumn, IconName } from "@vxture/design-system";
import { PageSection, SummaryStrip } from "@/layout/shell";
import { PlannedBadge, PlannedNotice } from "@/components/planned";
import { useTranslations } from "next-intl";

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
          {/* No handler exists behind this action; keep it legible but inert. */}
          <Button size="md" variant="outline" disabled>
            <Icon name="x" size="xs" fallback="placeholder" />
            <span>{t("danger.cancelTenant.action")}</span>
          </Button>
        </div>
      </PageSection>
    </FormPageTemplate>
  );
}
