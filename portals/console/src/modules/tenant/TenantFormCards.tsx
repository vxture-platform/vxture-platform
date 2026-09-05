"use client";

/**
 * TenantFormCards — 租户信息页的四张表单卡:基本信息 / 主管理员 / 默认区域 / 租户策略。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 个人租户与组织租户**同结构、同字段**(owner 2026-09-05):字段允许为空,不按类型
 * 藏卡——这样个人转组织时页面不换。缩进与名列宽度复用账号信息页的 CardRows。
 *
 * 走查修正(owner 2026-09-05 / 06,多轮):
 * - 基本信息与主管理员卡同一模式(第九轮:五行各带「修改」太细):标题行右侧一个
 *   「编辑 / 取消」,五行随卡一起解锁;提示文字放在输入框**后面**。租户名称已认证时
 *   始终只读、行尾「重新认证」(去认证页),未认证才随卡可改。
 * - 主管理员:只有一位,**只能转让、不能解除**(第八轮)。「转让」是标题行右侧的一个
 *   动作(图标 + 按钮,弹窗选一位成员接任),不是字段;姓名 / 性别 / 邮箱 / 电话永远
 *   随其账号资料,只填职务、地址等补充项;个人租户固定是所有者、按钮禁用。
 *   布局仍是「标题 内容」横排、内容框与其它卡全局对齐等宽,只是一行两个。
 *   填写的主管理员默认就是账单接收人。
 * - 默认区域托底按中国设定;租户策略只标规划中。
 *
 * 可改字段一律随页底「保存」一次提交(草稿态在 TenantPage 里)。没有
 * `tenant.settings.manage` 的成员看到的是同一批字段的只读形态。
 */

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  DetailList,
  DetailRow,
  DialogForm,
  EditableRow,
  Field,
  FieldLabel,
  Icon,
  Input,
  NativeSelect,
  StatusBadge,
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
import { GenderMark } from "@/components/gender/GenderRadio";
import { TenantSection } from "./TenantIdentityCard";

/** 与账号信息页个人偏好同一档宽度(≈300px,owner 2026-09-05);四张卡的内容框都用它。 */
const CONTROL_CLASS = "w-full max-w-overlay-lg";

export interface TenantDraft {
  /** 认证名(tenancy.tenants.name)。 */
  name: string;
  /** 简称(tenancy.tenants.display_name)。 */
  displayName: string;
  industry: string;
  scale: string;
  website: string;
  /** 主管理员关联的成员 id;空串只出现在没有关联行的历史数据上。 */
  contactUserId: string;
  contactName: string;
  /** 性别:male / female / 空串未设定(关联成员时随其账号资料)。 */
  contactGender: "" | "male" | "female";
  contactRole: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  address2: string;
  postalCode: string;
  isBillingRecipient: boolean;
  timezone: string;
  language: string;
  currency: string;
}

export type TenantDraftPatch = Partial<TenantDraft>;

/** 主管理员可转让给的成员(组织 = 活跃成员;个人租户 = 自己)。 */
export interface ContactOption {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

const SCALE_OPTIONS = ["1-10", "11-50", "51-200", "201-500", "500+"];
const CURRENCY_OPTIONS = ["CNY", "USD"];

// ── 基本信息 ────────────────────────────────────────────────────────────────

type BasicField = "displayName" | "name" | "industry" | "scale" | "website";
const BASIC_FIELDS: readonly BasicField[] = [
  "displayName",
  "name",
  "industry",
  "scale",
  "website",
];

/**
 * 卡级编辑,与主管理员卡同一模式(owner 2026-09-06:五行各带「修改」太细):标题行右侧
 * 一个「编辑 / 取消」——展示态全是文字,点编辑五行一起变控件;「取消」把五项退回已保存值
 * 并重新锁上。解锁后的改动仍随页底「保存」一起提交(TenantPage 在保存 / 放弃后用 key
 * 重置本卡)。租户名称已认证时始终只读,行尾操作是「重新认证」。
 */
export function TenantBasicCard({
  draft,
  saved,
  onChange,
  readOnly,
  verified,
  loading,
  onGoVerify,
}: {
  readonly draft: TenantDraft;
  readonly saved: TenantDraft;
  readonly onChange: (patch: TenantDraftPatch) => void;
  readonly readOnly: boolean;
  /** 已认证 / 审核中的组织租户:认证名不可直接改,操作换成「重新认证」。 */
  readonly verified: boolean;
  readonly loading: boolean;
  readonly onGoVerify: () => void;
}) {
  const t = useTranslations("tenantInfoPage");
  const [editing, setEditing] = useState(false);
  // DS EditableRow(10.1.0):展示态是文字、编辑态才是控件;行不带自己的按钮(action=null)
  const rowLabels = { edit: t("common.modify"), cancel: t("common.cancel") };
  const editable = editing && !readOnly;

  const cancelAll = () => {
    const revert: TenantDraftPatch = {};
    for (const f of BASIC_FIELDS) revert[f] = saved[f];
    onChange(revert);
    setEditing(false);
  };

  const action = readOnly ? null : editing ? (
    <Button variant="ghost" size="sm" onClick={cancelAll}>
      {t("common.cancel")}
    </Button>
  ) : (
    <Button
      variant="ghost"
      size="sm"
      disabled={loading}
      onClick={() => setEditing(true)}
    >
      <Icon name="edit" size="xs" fallback="placeholder" />
      <span>{t("common.edit")}</span>
    </Button>
  );

  const textRow = (f: BasicField, hint?: ReactNode) => (
    <EditableRow
      label={t(`fields.${f}`)}
      value={draft[f]}
      editing={editable}
      labels={rowLabels}
      action={null}
      hint={hint}
    >
      <Input
        className={CONTROL_CLASS}
        value={draft[f]}
        onChange={(event) =>
          onChange({ [f]: event.target.value } as TenantDraftPatch)
        }
        // 官网(走查 2026-09-05):空值时预填「https://」当起始内容,用户接着补齐、也可改成
        // http;存的就是框里的内容,不做前缀拼接。卡级编辑下改在**聚焦到这一框**时才补——
        // 一点「编辑」就填进去,会把只想改行业的人的官网悄悄存成一个空前缀。
        onFocus={
          f === "website"
            ? () => {
                if (draft.website.trim() === "")
                  onChange({ website: "https://" });
              }
            : undefined
        }
      />
    </EditableRow>
  );
  const scaleText = draft.scale
    ? SCALE_OPTIONS.includes(draft.scale)
      ? t("scale.people", { range: draft.scale })
      : draft.scale
    : "";

  return (
    <TenantSection
      icon="buildings"
      titleKey="cards.basic.title"
      descriptionKey="cards.basic.description"
      action={action}
    >
      <CardRows>
        <DetailList className={DETAIL_LIST_CLASS}>
          {textRow("displayName", t("fields.displayNameHint"))}

          {/* 租户名称:已认证 → 只读、行尾「重新认证」;未认证 → 随卡编辑(走查第 6 条) */}
          <EditableRow
            label={t("fields.name")}
            value={draft.name}
            editing={!verified && editable}
            labels={rowLabels}
            action={
              verified && !readOnly ? (
                <Button variant="ghost" size="sm" onClick={onGoVerify}>
                  <Icon name="shield-check" size="xs" fallback="placeholder" />
                  <span>{t("fields.reverify")}</span>
                </Button>
              ) : null
            }
            hint={
              verified ? t("fields.nameVerifiedHint") : t("fields.nameHint")
            }
          >
            <Input
              className={CONTROL_CLASS}
              value={draft.name}
              onChange={(event) => onChange({ name: event.target.value })}
            />
          </EditableRow>

          {textRow("industry")}

          <EditableRow
            label={t("fields.scale")}
            value={scaleText}
            editing={editable}
            labels={rowLabels}
            action={null}
          >
            <NativeSelect
              wrapperClassName={CONTROL_CLASS}
              value={draft.scale}
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
          </EditableRow>

          {textRow("website")}
        </DetailList>
      </CardRows>
    </TenantSection>
  );
}

// ── 主管理员 ────────────────────────────────────────────────────────────────

/**
 * 主管理员(走查 2026-09-05 第四轮 + 第八轮):与账号基本信息同构。
 * - **只有一位、只能转让、不能解除**:标题后紧跟「当前 xx」徽章与「转让」按钮
 *   (弹窗选一位成员接任);姓名 / 性别 / 邮箱 / 电话永远随其账号资料,这里不改。
 * - 右侧是卡级「编辑 / 取消」——展示态全是文字,点编辑才变控件(EditableRow),
 *   能编的只有职务、地址两段、邮编、账单接收人;地址两段式;填写的主管理员默认
 *   就是账单接收人。
 * - 个人租户:主管理员固定是所有者,「转让」禁用(没有别的成员)。
 */
export function TenantContactCard({
  draft,
  options,
  onChange,
  readOnly,
  isPersonal,
  loading,
}: {
  readonly draft: TenantDraft;
  readonly options: readonly ContactOption[];
  readonly onChange: (patch: TenantDraftPatch) => void;
  readonly readOnly: boolean;
  /** 个人租户:主管理员固定是所有者,「转让」禁用。 */
  readonly isPersonal: boolean;
  readonly loading: boolean;
}) {
  const t = useTranslations("tenantInfoPage");
  const rowLabels = { edit: t("common.modify"), cancel: t("common.cancel") };
  const genderLabels = {
    male: t("gender.male"),
    female: t("gender.female"),
    unset: t("gender.unset"),
  };
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pick, setPick] = useState("");

  const linked = draft.contactUserId
    ? options.find((o) => o.id === draft.contactUserId)
    : undefined;
  // 关联信息随成员账号(永远只读);没有关联行的历史数据仍显示存下来的文字。
  const name = linked ? linked.name : draft.contactName;
  const email = linked ? (linked.email ?? "") : draft.contactEmail;
  const phone = linked ? (linked.phone ?? "") : draft.contactPhone;
  const editable = editing && !readOnly;
  const candidates = options.filter((o) => o.id !== draft.contactUserId);

  function transferTo(id: string) {
    const option = options.find((o) => o.id === id);
    if (!option) return;
    onChange({
      contactUserId: id,
      contactName: option.name,
      contactEmail: option.email ?? "",
      contactPhone: option.phone ?? "",
    });
  }

  const titleExtra = (
    <>
      {name ? (
        <StatusBadge tone="neutral" icon="user">
          {t("contact.current", { name })}
        </StatusBadge>
      ) : null}
      {readOnly ? null : (
        <Button
          variant="outline"
          size="sm"
          disabled={isPersonal || loading || candidates.length === 0}
          onClick={() => {
            setPick("");
            setPickerOpen(true);
          }}
        >
          <Icon name="user-switch" size="xs" fallback="placeholder" />
          <span>{t("contact.transfer")}</span>
        </Button>
      )}
    </>
  );

  const action = readOnly ? null : editing ? (
    <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
      {t("common.cancel")}
    </Button>
  ) : (
    <Button
      variant="ghost"
      size="sm"
      disabled={loading}
      onClick={() => setEditing(true)}
    >
      <Icon name="edit" size="xs" fallback="placeholder" />
      <span>{t("common.edit")}</span>
    </Button>
  );

  /** 卡级编辑:各行不出自己的修改 / 取消(action=null),只跟随卡的编辑态。 */
  const row = (
    label: string,
    value: ReactNode,
    editingRow: boolean,
    control: ReactNode,
  ) => (
    <EditableRow
      label={label}
      value={value}
      editing={editingRow}
      labels={rowLabels}
      action={null}
    >
      {control}
    </EditableRow>
  );
  const text = (field: "contactRole" | "address" | "address2" | "postalCode") =>
    row(
      t(`fields.${field}`),
      draft[field],
      editable,
      <Input
        className={CONTROL_CLASS}
        value={draft[field]}
        onChange={(event) =>
          onChange({ [field]: event.target.value } as TenantDraftPatch)
        }
      />,
    );
  /** 随成员账号的只读行:展示态永远是文字,编辑期间也不给控件。 */
  const locked = (label: string, value: ReactNode) =>
    row(label, value, false, null);

  return (
    <>
      <TenantSection
        icon="user"
        titleKey="cards.contact.title"
        descriptionKey="cards.contact.description"
        titleExtra={titleExtra}
        action={action}
      >
        <CardRows>
          {/* 「标题 内容」横排、与其它卡同一名列宽与内容框宽;一行两个 */}
          <div className="grid gap-x-lg xl:grid-cols-2">
            <DetailList className={DETAIL_LIST_CLASS}>
              {/* 姓名 + 性别同一行(走查):随成员账号,只读 */}
              {locked(
                t("fields.contactName"),
                <span className="flex flex-wrap items-center gap-md">
                  <span>{name || "—"}</span>
                  <GenderMark
                    value={draft.contactGender}
                    labels={genderLabels}
                  />
                </span>,
              )}
              {locked(t("fields.contactEmail"), email)}
              {text("address")}
              {text("address2")}
            </DetailList>
            <DetailList className={DETAIL_LIST_CLASS}>
              {text("contactRole")}
              {locked(t("fields.contactPhone"), phone)}
              {text("postalCode")}
              <EditableRow
                label={t("fields.isBillingRecipient")}
                value={
                  // 走查(owner 2026-09-05):用圈圈对勾图标,不写「是」
                  <span
                    role="img"
                    aria-label={
                      draft.isBillingRecipient
                        ? t("common.yes")
                        : t("common.no")
                    }
                    title={
                      draft.isBillingRecipient
                        ? t("common.yes")
                        : t("common.no")
                    }
                    className={
                      draft.isBillingRecipient
                        ? "inline-flex text-success-text"
                        : "inline-flex text-muted-foreground"
                    }
                  >
                    <Icon
                      name={
                        draft.isBillingRecipient
                          ? "seal-check"
                          : "circle-dashed"
                      }
                      size="sm"
                      fallback="placeholder"
                    />
                  </span>
                }
                editing={editable}
                labels={rowLabels}
                action={null}
                hint={t("fields.isBillingRecipientHint")}
              >
                <Switch
                  checked={draft.isBillingRecipient}
                  onCheckedChange={(isBillingRecipient) =>
                    onChange({ isBillingRecipient })
                  }
                  aria-label={t("fields.isBillingRecipient")}
                />
              </EditableRow>
            </DetailList>
          </div>
        </CardRows>
      </TenantSection>

      <DialogForm
        open={pickerOpen}
        size="sm"
        title={t("contact.transferTitle")}
        description={t("contact.transferDescription")}
        submitLabel={t("contact.transferConfirm")}
        cancelLabel={t("common.cancel")}
        submitDisabled={!pick}
        onOpenChange={setPickerOpen}
        onSubmit={(event) => {
          event.preventDefault();
          transferTo(pick);
          setPickerOpen(false);
        }}
      >
        {/* 标签在上、控件在下(DS Field,与其它对话框一致)。走查第八轮:此前把标签文字
            与下拉同塞进一个 Label——DS Label 是横排 flex,下拉占满一行,标题被挤到只剩
            一个字宽、逐字换行。 */}
        <Field>
          <FieldLabel htmlFor="contact-transfer-target">
            {t("contact.pickLabel")}
          </FieldLabel>
          <NativeSelect
            id="contact-transfer-target"
            value={pick}
            onChange={(event) => setPick(event.target.value)}
          >
            <option value="">{t("contact.pickPlaceholder")}</option>
            {candidates.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.email ? ` · ${o.email}` : ""}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </DialogForm>
    </>
  );
}

// ── 默认区域 ────────────────────────────────────────────────────────────────

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

// ── 租户策略 ────────────────────────────────────────────────────────────────

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
