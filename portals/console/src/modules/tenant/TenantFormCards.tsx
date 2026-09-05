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
 * 走查修正(owner 2026-09-05,两轮):
 * - 基本信息与账号信息页同一模式:每行默认只读,右侧「修改」才解锁;提示文字放在
 *   输入框**后面**。租户名称已认证时操作换成「重新认证」(去认证页),未认证才可修改。
 * - 联系人:「关联成员」是标题行右侧的一个动作(图标 + 按钮,弹窗选人),不是字段;
 *   关联后姓名 / 邮箱 / 电话随成员资料锁定,只填补充项;个人租户固定关联所有者、按钮禁用。
 *   布局仍是「标题 内容」横排、内容框与其它卡全局对齐等宽,只是一行两个。
 *   填写的联系人默认就是账单接收人。
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
  Icon,
  Input,
  Label,
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
import { GenderRadio, genderLabel } from "@/components/gender/GenderRadio";
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
  /** 联系人关联的成员 id;空串 = 不关联、手填。 */
  contactUserId: string;
  contactName: string;
  /** 称呼:mr / ms / 空串未设定。 */
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

/** 联系人可关联的成员(组织 = 活跃成员;个人租户 = 自己)。 */
export interface ContactOption {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

const SCALE_OPTIONS = ["1-10", "11-50", "51-200", "201-500", "500+"];
const CURRENCY_OPTIONS = ["CNY", "USD"];

// ── 基本信息// ── 基本信息 ────────────────────────────────────────────────────────────────

type BasicField = "displayName" | "name" | "industry" | "scale" | "website";

/**
 * 每行默认只读;右侧「修改」解锁该行,「取消」把该行退回已保存值并重新锁上。
 * 解锁后的改动仍随页底「保存」一起提交(TenantPage 在保存 / 放弃后用 key 重置本卡)。
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
  const [editing, setEditing] = useState<ReadonlySet<BasicField>>(new Set());
  // DS EditableRow(10.1.0):展示态是文字、点「修改」才变控件;文案由门户传
  const rowLabels = { edit: t("common.modify"), cancel: t("common.cancel") };

  const isEditing = (f: BasicField) => editing.has(f);
  const start = (f: BasicField) => {
    // 官网(走查 2026-09-05):空值解锁时预填「https://」当起始内容,用户接着补齐、
    // 也可改成 http;存的就是框里的内容,不做前缀拼接。
    if (f === "website" && draft.website.trim() === "") {
      onChange({ website: "https://" });
    }
    setEditing((s) => new Set([...s, f]));
  };
  const cancel = (f: BasicField) => {
    onChange({ [f]: saved[f] } as TenantDraftPatch);
    setEditing((s) => {
      const next = new Set(s);
      next.delete(f);
      return next;
    });
  };
  const textRow = (f: BasicField, hint?: ReactNode) => (
    <EditableRow
      label={t(`fields.${f}`)}
      value={draft[f]}
      editing={isEditing(f)}
      onEdit={() => start(f)}
      onCancel={() => cancel(f)}
      labels={rowLabels}
      readOnly={readOnly}
      disabled={loading}
      hint={hint}
    >
      <Input
        className={CONTROL_CLASS}
        value={draft[f]}
        onChange={(event) =>
          onChange({ [f]: event.target.value } as TenantDraftPatch)
        }
        autoFocus
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
    >
      <CardRows>
        <DetailList className={DETAIL_LIST_CLASS}>
          {textRow("displayName", t("fields.displayNameHint"))}

          {/* 租户名称:已认证 → 操作是「重新认证」;未认证 → 可修改(走查第 6 条) */}
          <EditableRow
            label={t("fields.name")}
            value={draft.name}
            editing={!verified && isEditing("name")}
            onEdit={() => start("name")}
            onCancel={() => cancel("name")}
            labels={rowLabels}
            readOnly={readOnly}
            disabled={loading}
            hint={
              verified ? t("fields.nameVerifiedHint") : t("fields.nameHint")
            }
            {...(verified
              ? {
                  action: (
                    <Button variant="ghost" size="sm" onClick={onGoVerify}>
                      <Icon
                        name="shield-check"
                        size="xs"
                        fallback="placeholder"
                      />
                      <span>{t("fields.reverify")}</span>
                    </Button>
                  ),
                }
              : {})}
          >
            <Input
              className={CONTROL_CLASS}
              value={draft.name}
              onChange={(event) => onChange({ name: event.target.value })}
              autoFocus
            />
          </EditableRow>

          {textRow("industry")}

          <EditableRow
            label={t("fields.scale")}
            value={scaleText}
            editing={isEditing("scale")}
            onEdit={() => start("scale")}
            onCancel={() => cancel("scale")}
            labels={rowLabels}
            readOnly={readOnly}
            disabled={loading}
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
 * 主管理员(走查 2026-09-05 第四轮):与账号基本信息同构。
 * - 标题后紧跟「已关联 xx」徽章与「关联成员」按钮;右侧是卡级「编辑 / 取消」——
 *   展示态全是文字,点编辑才变控件(EditableRow),编辑期间关联信息(姓名 / 性别 /
 *   邮箱 / 电话随成员账号)仍是文字、不在这里改;地址两段式;填写的主管理员默认
 *   就是账单接收人。
 * - 个人租户:固定关联所有者,「关联成员」禁用。
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
  /** 个人租户:主管理员固定是所有者,「关联成员」禁用。 */
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
  // 关联了成员:姓名 / 性别 / 邮箱 / 电话取自成员账号(锁定);未关联才手填。
  const locked = Boolean(draft.contactUserId);
  const name = linked ? linked.name : draft.contactName;
  const email = linked ? (linked.email ?? "") : draft.contactEmail;
  const phone = linked ? (linked.phone ?? "") : draft.contactPhone;
  const editable = editing && !readOnly;
  const editableUnlinked = editable && !locked;

  function link(id: string) {
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
      {locked ? (
        <StatusBadge tone="neutral" icon="user">
          {t("contact.linked", { name: name || draft.contactUserId })}
        </StatusBadge>
      ) : null}
      {readOnly ? null : (
        <Button
          variant="outline"
          size="sm"
          disabled={isPersonal || loading}
          onClick={() => {
            setPick(draft.contactUserId);
            setPickerOpen(true);
          }}
        >
          <Icon name="users" size="xs" fallback="placeholder" />
          <span>{t("contact.link")}</span>
        </Button>
      )}
      {locked && !isPersonal && editable ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ contactUserId: "" })}
        >
          {t("contact.unlink")}
        </Button>
      ) : null}
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
    value: string,
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
              {/* 姓名 + 性别同一行(走查):关联成员时随成员账号,只读 */}
              <EditableRow
                label={t("fields.contactName")}
                value={
                  <span className="flex flex-wrap items-center gap-md">
                    <span>{name || "—"}</span>
                    <span className="text-muted-foreground">
                      {genderLabel(draft.contactGender, genderLabels)}
                    </span>
                  </span>
                }
                editing={editableUnlinked}
                labels={rowLabels}
                action={null}
              >
                <span className="flex w-full flex-wrap items-center gap-md">
                  <Input
                    className={CONTROL_CLASS}
                    value={name}
                    onChange={(event) =>
                      onChange({ contactName: event.target.value })
                    }
                  />
                  <GenderRadio
                    value={draft.contactGender}
                    onChange={(contactGender) => onChange({ contactGender })}
                    labels={genderLabels}
                    ariaLabel={t("fields.contactGender")}
                  />
                </span>
              </EditableRow>
              {row(
                t("fields.contactEmail"),
                email,
                editableUnlinked,
                <Input
                  className={CONTROL_CLASS}
                  value={email}
                  onChange={(event) =>
                    onChange({ contactEmail: event.target.value })
                  }
                />,
              )}
              {text("address")}
              {text("address2")}
            </DetailList>
            <DetailList className={DETAIL_LIST_CLASS}>
              {text("contactRole")}
              {row(
                t("fields.contactPhone"),
                phone,
                editableUnlinked,
                <Input
                  className={CONTROL_CLASS}
                  value={phone}
                  onChange={(event) =>
                    onChange({ contactPhone: event.target.value })
                  }
                />,
              )}
              {text("postalCode")}
              <EditableRow
                label={t("fields.isBillingRecipient")}
                value={
                  draft.isBillingRecipient ? t("common.yes") : t("common.no")
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
        title={t("contact.pickTitle")}
        description={t("contact.pickDescription")}
        submitLabel={t("contact.confirm")}
        cancelLabel={t("common.cancel")}
        submitDisabled={!pick}
        onOpenChange={setPickerOpen}
        onSubmit={(event) => {
          event.preventDefault();
          link(pick);
          setPickerOpen(false);
        }}
      >
        <Label>
          {t("contact.pickLabel")}
          <NativeSelect
            value={pick}
            onChange={(event) => setPick(event.target.value)}
            aria-label={t("contact.pickLabel")}
          >
            <option value="">{t("common.unset")}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.email ? ` · ${o.email}` : ""}
              </option>
            ))}
          </NativeSelect>
        </Label>
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
