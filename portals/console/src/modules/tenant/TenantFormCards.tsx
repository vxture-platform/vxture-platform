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
 * 可改字段一律随页底「保存」一次提交(草稿态在 TenantPage 里)。没有
 * `tenant.settings.manage` 的成员看到的是同一批字段的只读形态。
 */

import { useTranslations } from "next-intl";
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DetailList,
  DetailRow,
  Icon,
  Input,
  NativeSelect,
  Switch,
  Textarea,
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
  name: string;
  description: string;
  industry: string;
  scale: string;
  website: string;
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

const SCALE_OPTIONS = ["1-10", "11-50", "51-200", "201-500", "500+"];
const CURRENCY_OPTIONS = ["CNY", "USD"];

function TextRow({
  label,
  value,
  onChange,
  readOnly,
  placeholder,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly readOnly: boolean;
  readonly placeholder?: string;
}) {
  return (
    <DetailRow label={label}>
      <Input
        className={CONTROL_CLASS}
        value={value}
        readOnly={readOnly}
        disabled={readOnly}
        {...(placeholder ? { placeholder } : {})}
        onChange={(event) => onChange(event.target.value)}
      />
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
  /** 已认证 / 审核中的组织租户:改名会作废认证,行下给一句提醒。 */
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
          <DetailRow label={t("fields.name")}>
            <span className="flex flex-col gap-2xs">
              <Input
                className={CONTROL_CLASS}
                value={draft.name}
                readOnly={readOnly}
                disabled={readOnly}
                onChange={(event) => onChange({ name: event.target.value })}
              />
              {verified ? (
                <span className="text-body-sm text-warning">
                  {t("fields.nameResetsVerification")}
                </span>
              ) : null}
            </span>
          </DetailRow>
          <DetailRow label={t("fields.description")}>
            <Textarea
              className={CONTROL_CLASS}
              rows={2}
              value={draft.description}
              readOnly={readOnly}
              disabled={readOnly}
              onChange={(event) =>
                onChange({ description: event.target.value })
              }
            />
          </DetailRow>
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

export function TenantContactCard({
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
      icon="user"
      titleKey="cards.contact.title"
      descriptionKey="cards.contact.description"
    >
      <CardRows>
        <DetailList className={DETAIL_LIST_CLASS}>
          <TextRow
            label={t("fields.contactName")}
            value={draft.contactName}
            readOnly={readOnly}
            onChange={(contactName) => onChange({ contactName })}
          />
          <TextRow
            label={t("fields.contactRole")}
            value={draft.contactRole}
            readOnly={readOnly}
            onChange={(contactRole) => onChange({ contactRole })}
          />
          <TextRow
            label={t("fields.contactEmail")}
            value={draft.contactEmail}
            readOnly={readOnly}
            onChange={(contactEmail) => onChange({ contactEmail })}
          />
          <TextRow
            label={t("fields.contactPhone")}
            value={draft.contactPhone}
            readOnly={readOnly}
            onChange={(contactPhone) => onChange({ contactPhone })}
          />
          <TextRow
            label={t("fields.countryCode")}
            value={draft.countryCode}
            readOnly={readOnly}
            onChange={(countryCode) => onChange({ countryCode })}
          />
          <TextRow
            label={t("fields.address")}
            value={draft.address}
            readOnly={readOnly}
            onChange={(address) => onChange({ address })}
          />
          <TextRow
            label={t("fields.postalCode")}
            value={draft.postalCode}
            readOnly={readOnly}
            onChange={(postalCode) => onChange({ postalCode })}
          />
          <DetailRow label={t("fields.isBillingRecipient")}>
            <Switch
              checked={draft.isBillingRecipient}
              disabled={readOnly}
              onCheckedChange={(isBillingRecipient) =>
                onChange({ isBillingRecipient })
              }
              aria-label={t("fields.isBillingRecipient")}
            />
            <span className="text-body-sm text-muted-foreground">
              {t("fields.isBillingRecipientHint")}
            </span>
          </DetailRow>
        </DetailList>
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
              <option value="">{t("common.unset")}</option>
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
              <option value="">{t("common.unset")}</option>
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
              <option value="">{t("common.unset")}</option>
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
 * 租户策略:九条,后端未建。默认折叠、控件不渲染(此前那版是渲染成禁用控件并写
 * localStorage——写了个只有自己看得见的假设置,批 5c 一并去掉)。
 */
export function TenantPolicyCard() {
  const t = useTranslations("tenantInfoPage");
  const groups = ["access", "security", "data"] as const;
  return (
    <TenantSection icon="settings" titleKey="cards.policy.title">
      <CardRows>
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="justify-start">
              <PlannedBadge />
              <span>{t("cards.policy.toggle")}</span>
              <Icon name="chevron-down" size="xs" fallback="placeholder" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="flex flex-col gap-sm pt-sm">
              <PlannedNotice variant="controls" />
              <ul className="flex flex-col gap-xs">
                {groups.map((g) => (
                  <li key={g} className="text-body-sm text-muted-foreground">
                    <span className="text-foreground">
                      {t(`policy.${g}.title`)}
                    </span>
                    {t(`policy.${g}.items`)}
                  </li>
                ))}
              </ul>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardRows>
    </TenantSection>
  );
}
