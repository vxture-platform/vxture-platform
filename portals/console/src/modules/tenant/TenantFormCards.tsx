"use client";

/**
 * TenantFormCards — 租户信息页的四张表单卡:基本信息 / 联系人 / 默认区域 / 租户策略。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 个人租户与组织租户**同结构、同字段**(owner 2026-09-05):字段允许为空,不按类型
 * 藏卡——这样个人转组织时页面不换。缩进与名列宽度复用账号信息页的 CardRows。
 *
 * 走查修正(owner 2026-09-05):
 * - 名称拆两条,与用户的 account / display_name 同构:**租户简称**是日常展示名、自由改;
 *   **租户名称**是认证名,组织租户改它会作废已有认证。
 * - 简介删掉;联系人默认关联所有者,可改为关联别的成员(姓名 / 邮箱 / 电话随成员资料),
 *   不关联才全手填;联系人卡改成一行两块。
 * - 默认区域托底按中国设定;租户策略只标规划中。
 *
 * 可改字段一律随页底「保存」一次提交(草稿态在 TenantPage 里)。没有
 * `tenant.settings.manage` 的成员看到的是同一批字段的只读形态。
 */

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  DetailList,
  DetailRow,
  Input,
  NativeSelect,
  Switch,
} from "@vxture/design-system";
import { PlannedBadge, PlannedNotice } from "@/components/planned";
import {
  CardRows,
  DETAIL_LIST_CLASS,
} from "@/modules/account/profile/CardRows";
import {
  TIMEZONE_OPTIONS,
  formatTimezone,
} from "@/modules/account/profile/format";
import { TenantSection } from "./TenantIdentityCard";

/** 与账号信息页个人偏好同一档宽度(≈300px,owner 2026-09-05)。 */
const CONTROL_CLASS = "w-full max-w-overlay-lg";

export interface TenantDraft {
  /** 认证名(tenancy.tenants.name)。 */
  name: string;
  /** 简称(tenancy.tenants.display_name)。 */
  displayName: string;
  industry: string;
  scale: string;
  website: string;
  /** 联系人关联的成员 id;空串 = 不关联、手填。 */
  contactUserId: string;
  contactName: string;
  contactRole: string;
  contactEmail: string;
  contactPhone: string;
  countryCode: string;
  address: string;
  postalCode: string;
  isBillingRecipient: boolean;
  timezone: string;
  language: string;
  currency: string;
}

export type TenantDraftPatch = Partial<TenantDraft>;

/** 联系人可关联的成员(组织 = 活跃成员;个人租户 = 自己)。 */
export interface ContactOption {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

const SCALE_OPTIONS = ["1-10", "11-50", "51-200", "201-500", "500+"];
const CURRENCY_OPTIONS = ["CNY", "USD"];

function TextRow({
  label,
  value,
  onChange,
  readOnly,
  placeholder,
  hint,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly readOnly: boolean;
  readonly placeholder?: string;
  readonly hint?: ReactNode;
}) {
  return (
    <DetailRow label={label}>
      <span className="flex w-full flex-col gap-2xs">
        <Input
          className={CONTROL_CLASS}
          value={value}
          readOnly={readOnly}
          disabled={readOnly}
          {...(placeholder ? { placeholder } : {})}
          onChange={(event) => onChange(event.target.value)}
        />
        {hint ? (
          <span className="text-body-sm text-muted-foreground">{hint}</span>
        ) : null}
      </span>
    </DetailRow>
  );
}

export function TenantBasicCard({
  draft,
  onChange,
  readOnly,
  verified,
}: {
  readonly draft: TenantDraft;
  readonly onChange: (patch: TenantDraftPatch) => void;
  readonly readOnly: boolean;
  /** 已认证 / 审核中的组织租户:改认证名会作废认证,行下给一句提醒。 */
  readonly verified: boolean;
}) {
  const t = useTranslations("tenantInfoPage");
  return (
    <TenantSection
      icon="buildings"
      titleKey="cards.basic.title"
      descriptionKey="cards.basic.description"
    >
      <CardRows>
        <DetailList className={DETAIL_LIST_CLASS}>
          <TextRow
            label={t("fields.displayName")}
            value={draft.displayName}
            readOnly={readOnly}
            onChange={(displayName) => onChange({ displayName })}
            hint={t("fields.displayNameHint")}
          />
          <TextRow
            label={t("fields.name")}
            value={draft.name}
            readOnly={readOnly}
            onChange={(name) => onChange({ name })}
            hint={
              verified ? (
                <span className="text-warning">
                  {t("fields.nameResetsVerification")}
                </span>
              ) : (
                t("fields.nameHint")
              )
            }
          />
          <TextRow
            label={t("fields.industry")}
            value={draft.industry}
            readOnly={readOnly}
            onChange={(industry) => onChange({ industry })}
          />
          <DetailRow label={t("fields.scale")}>
            <NativeSelect
              wrapperClassName={CONTROL_CLASS}
              value={draft.scale}
              disabled={readOnly}
              onChange={(event) => onChange({ scale: event.target.value })}
              aria-label={t("fields.scale")}
            >
              <option value="">{t("common.unset")}</option>
              {draft.scale && !SCALE_OPTIONS.includes(draft.scale) ? (
                <option value={draft.scale}>{draft.scale}</option>
              ) : null}
              {SCALE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {t("scale.people", { range: s })}
                </option>
              ))}
            </NativeSelect>
          </DetailRow>
          <TextRow
            label={t("fields.website")}
            value={draft.website}
            readOnly={readOnly}
            onChange={(website) => onChange({ website })}
            placeholder="https://"
          />
        </DetailList>
      </CardRows>
    </TenantSection>
  );
}

/** 联系人卡的一格:标签在上、控件在下,两格一行。 */
function GridField({
  label,
  children,
  span,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly span?: boolean;
}) {
  return (
    <label
      className={`flex min-w-0 flex-col gap-2xs ${span ? "sm:col-span-2" : ""}`}
    >
      <span className="text-label-sm text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function TenantContactCard({
  draft,
  options,
  onChange,
  readOnly,
}: {
  readonly draft: TenantDraft;
  readonly options: readonly ContactOption[];
  readonly onChange: (patch: TenantDraftPatch) => void;
  readonly readOnly: boolean;
}) {
  const t = useTranslations("tenantInfoPage");
  const linked = draft.contactUserId
    ? options.find((o) => o.id === draft.contactUserId)
    : undefined;
  // 关联了成员:姓名 / 邮箱 / 电话取自成员资料(只读);未关联才手填。
  const derivedLocked = Boolean(draft.contactUserId);
  const name = linked ? linked.name : draft.contactName;
  const email = linked ? (linked.email ?? "") : draft.contactEmail;
  const phone = linked ? (linked.phone ?? "") : draft.contactPhone;

  function link(id: string) {
    const option = options.find((o) => o.id === id);
    onChange(
      option
        ? {
            contactUserId: id,
            contactName: option.name,
            contactEmail: option.email ?? "",
            contactPhone: option.phone ?? "",
          }
        : { contactUserId: "" },
    );
  }

  return (
    <TenantSection
      icon="user"
      titleKey="cards.contact.title"
      descriptionKey="cards.contact.description"
    >
      <CardRows>
        <div className="grid gap-md sm:grid-cols-2">
          <GridField label={t("fields.contactUser")}>
            <NativeSelect
              value={draft.contactUserId}
              disabled={readOnly}
              onChange={(event) => link(event.target.value)}
              aria-label={t("fields.contactUser")}
            >
              <option value="">{t("fields.contactUserNone")}</option>
              {draft.contactUserId && !linked ? (
                <option value={draft.contactUserId}>
                  {draft.contactName || draft.contactUserId}
                </option>
              ) : null}
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </NativeSelect>
          </GridField>
          <GridField label={t("fields.contactRole")}>
            <Input
              value={draft.contactRole}
              readOnly={readOnly}
              disabled={readOnly}
              onChange={(event) =>
                onChange({ contactRole: event.target.value })
              }
            />
          </GridField>

          <GridField label={t("fields.contactName")}>
            <Input
              value={name}
              readOnly={readOnly || derivedLocked}
              disabled={readOnly || derivedLocked}
              onChange={(event) =>
                onChange({ contactName: event.target.value })
              }
            />
          </GridField>
          <GridField label={t("fields.contactEmail")}>
            <Input
              value={email}
              readOnly={readOnly || derivedLocked}
              disabled={readOnly || derivedLocked}
              onChange={(event) =>
                onChange({ contactEmail: event.target.value })
              }
            />
          </GridField>

          <GridField label={t("fields.contactPhone")}>
            <Input
              value={phone}
              readOnly={readOnly || derivedLocked}
              disabled={readOnly || derivedLocked}
              onChange={(event) =>
                onChange({ contactPhone: event.target.value })
              }
            />
          </GridField>
          <GridField label={t("fields.countryCode")}>
            <Input
              value={draft.countryCode}
              readOnly={readOnly}
              disabled={readOnly}
              onChange={(event) =>
                onChange({ countryCode: event.target.value })
              }
            />
          </GridField>

          <GridField label={t("fields.address")}>
            <Input
              value={draft.address}
              readOnly={readOnly}
              disabled={readOnly}
              onChange={(event) => onChange({ address: event.target.value })}
            />
          </GridField>
          <GridField label={t("fields.postalCode")}>
            <Input
              value={draft.postalCode}
              readOnly={readOnly}
              disabled={readOnly}
              onChange={(event) => onChange({ postalCode: event.target.value })}
            />
          </GridField>

          {derivedLocked ? (
            <span className="text-body-sm text-muted-foreground sm:col-span-2">
              {t("fields.contactLinkedHint")}
            </span>
          ) : null}

          <div className="flex items-center gap-sm sm:col-span-2">
            <Switch
              checked={draft.isBillingRecipient}
              disabled={readOnly}
              onCheckedChange={(isBillingRecipient) =>
                onChange({ isBillingRecipient })
              }
              aria-label={t("fields.isBillingRecipient")}
            />
            <span className="text-body-sm text-foreground">
              {t("fields.isBillingRecipient")}
            </span>
            <span className="text-body-sm text-muted-foreground">
              {t("fields.isBillingRecipientHint")}
            </span>
          </div>
        </div>
      </CardRows>
    </TenantSection>
  );
}

export function TenantRegionCard({
  draft,
  onChange,
  readOnly,
}: {
  readonly draft: TenantDraft;
  readonly onChange: (patch: TenantDraftPatch) => void;
  readonly readOnly: boolean;
}) {
  const t = useTranslations("tenantInfoPage");
  return (
    <TenantSection
      icon="globe"
      titleKey="cards.region.title"
      descriptionKey="cards.region.description"
    >
      <CardRows>
        <DetailList className={DETAIL_LIST_CLASS}>
          <DetailRow label={t("fields.language")}>
            <NativeSelect
              wrapperClassName={CONTROL_CLASS}
              value={draft.language}
              disabled={readOnly}
              onChange={(event) => onChange({ language: event.target.value })}
              aria-label={t("fields.language")}
            >
              <option value="zh-CN">{t("language.zhCN")}</option>
              <option value="en-US">{t("language.enUS")}</option>
            </NativeSelect>
          </DetailRow>
          <DetailRow label={t("fields.timezone")}>
            <NativeSelect
              wrapperClassName={CONTROL_CLASS}
              value={draft.timezone}
              disabled={readOnly}
              onChange={(event) => onChange({ timezone: event.target.value })}
              aria-label={t("fields.timezone")}
            >
              {draft.timezone && !TIMEZONE_OPTIONS.includes(draft.timezone) ? (
                <option value={draft.timezone}>
                  {formatTimezone(draft.timezone, draft.timezone)}
                </option>
              ) : null}
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz} value={tz}>
                  {formatTimezone(tz, tz)}
                </option>
              ))}
            </NativeSelect>
          </DetailRow>
          <DetailRow label={t("fields.currency")}>
            <NativeSelect
              wrapperClassName={CONTROL_CLASS}
              value={draft.currency}
              disabled={readOnly}
              onChange={(event) => onChange({ currency: event.target.value })}
              aria-label={t("fields.currency")}
            >
              {CURRENCY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </DetailRow>
        </DetailList>
      </CardRows>
    </TenantSection>
  );
}

/**
 * 租户策略:板块保留、只标「规划中」(owner 走查 2026-09-05:内部细节删掉——那九条
 * 的定位还没定,列出来反而像承诺)。后端未建,不渲染任何控件。
 */
export function TenantPolicyCard() {
  return (
    <TenantSection
      icon="settings"
      titleKey="cards.policy.title"
      descriptionKey="cards.policy.description"
    >
      <CardRows>
        <div className="flex flex-col gap-sm">
          <span>
            <PlannedBadge />
          </span>
          <PlannedNotice variant="controls" />
        </div>
      </CardRows>
    </TenantSection>
  );
}
