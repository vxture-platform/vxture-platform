"use client";

/**
 * TicketCreateDialog.tsx —— 运营代客建单。
 *
 * ── 为什么工单列表此前没有「新建」 ──
 * 不是漏了一颗按钮：**全仓没有任何建单端点**，admin 与 console 都没有，
 * `support.tickets` 至今一行都没有过。所以这颗按钮是和写路径一起才第一次成立的。
 *
 * ── 租户怎么选 ──
 * 运营认客户靠的是**租户号或名字**，不是 UUID。所以这里是一个可搜索下拉
 * （`Combobox` 同时按选项值与标签文字过滤，见 design-ui 实现里的 `keywords`）：
 * 打一段号能搜到，打两个字名字也能搜到。送给 BFF 的值就是屏幕上那个号本身
 * （`tenant_no`），**表单、请求体、地址栏三处都不出现 UUID**。
 *
 * 租户清单读不回来时**不退回一个让人贴 UUID 的输入框**——那是把一条铁律换成
 * 一个当时省事的输入框。退回的是「这张单先建不了，并说清为什么」。
 * 同 ModelPlatformPage 里策略作用域那个下拉的判断。
 *
 * ── 标题与正文的读者是客户 ──
 * 「工单标题」落 `support.tickets.title`、「客户反馈的情况」落 `description`，
 * 两处客户都在自己的工单里原样读得到。内部判断不写在这里；建完单在详情页写成
 * 内部备注（`internal_note`）。
 *
 * 这两个框因此带着**和详情页回复框同一枚徽标**（`ticketAudience.customerVisible`）
 * 加一句字段说明。全屏一条规矩：**客户会读到的字段自己说出来**——运营在这个门户
 * 里只要学一次「带标的会发给客户」，就该在每一屏都成立。不带标的地方
 * （租户、优先级两个下拉）不是漏了：下拉写进去的是值域里的码，
 * 客户看到的是渲染后的状态词而不是运营的原话。
 *
 * ── 报单人姓名也带标（2026-09-29 补）──
 * 初版把它归在「不带标」那一档，理由写的是「姓名栏写不进内部判断」。真正的理由其实是
 * 那一天客户侧**根本没有工单读取路径**，给它加标等于断言一条不存在的路径。
 * 客户侧工单列表现在把 `reporter_name` 画在首列上（租户级可见 ⇒ 「同事里谁提的」
 * 是一列真信息），那条路径存在了，所以徐标在**同一次改动里**补上：
 * 规矩要普遍成立才有用——凡值会进客户可见记录的框，框自己就说出来。
 */

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  Banner,
  Combobox,
  DialogForm,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  NativeSelect,
  StatusBadge,
  Textarea,
} from "@vxture/design-system";
import type { ComboboxItem } from "@vxture/design-system";
import {
  AdminBffError,
  createTicket,
  fetchTenantOperationsStrict,
} from "@/api/admin-bff";
import type {
  SupportTicketRecord,
  TenantOperationRecord,
} from "@/entities/console";
import type { TicketPriority } from "@vxture-platform/shared";
import {
  TICKET_PRIORITIES,
  formatPrincipalNoOr,
} from "@vxture-platform/shared";
import { useTicketPriorityLabels } from "@/modules/shared/enum-labels";

/** `support.tickets.title` 是 varchar(200)——输入框先拦，不等 BFF 退回来。 */
const TITLE_MAX = 200;
/** `description` 是 text，库不设上限；这里给一个人读得完的上限。 */
const DESCRIPTION_MAX = 4000;
/** `reporter_name` 是 varchar(100)。 */
const REPORTER_MAX = 100;

export function TicketCreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (created: SupportTicketRecord) => void;
}) {
  const t = useTranslations("ticketsPage.create");
  /* 「客户可见」这个词只有一份，和详情页那四处徽标读的是同一个键——两屏说的是
     同一件事，就不该有两句各自维护的文案。 */
  const tAudience = useTranslations("ticketAudience");
  const tShared = useTranslations();
  const priorityLabels = useTicketPriorityLabels();

  const [tenants, setTenants] = useState<TenantOperationRecord[]>([]);
  const [tenantsFailed, setTenantsFailed] = useState(false);
  const [tenantCode, setTenantCode] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reporterName, setReporterName] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("p2");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchTenantOperationsStrict()
      .then((records) => {
        if (cancelled) return;
        /* 没有可视码的租户选不了（送出去也解析不到），从候选里去掉——留着会让人
           选中一个提交必失败的选项。 */
        setTenants(records.filter((record) => record.tenantCode.trim()));
        setTenantsFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setTenants([]);
        setTenantsFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /* 选项在 JSX 之外拼：写在 `items={…}` 属性里的一串 map 既每帧重建，也让
     `lint:principal-no` 的语法位置判定一路走到那个属性上。 */
  const tenantItems = useMemo<ComboboxItem[]>(
    () =>
      tenants.map((tenant) => ({
        value: tenant.tenantCode,
        label: `${formatPrincipalNoOr(tenant.tenantCode, "tenant", "—")} · ${tenant.tenantName}`,
      })),
    [tenants],
  );

  const canSubmit =
    tenantCode.trim().length > 0 &&
    title.trim().length > 0 &&
    description.trim().length > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const reporter = reporterName.trim();
      const created = await createTicket({
        tenantCode: tenantCode.trim(),
        title: title.trim(),
        description: description.trim(),
        priority,
        /* 空就不送这个键：送空串等于声称「报单人叫空字符串」，而不送是
           「没指名到人」——那是两件不同的事，库里也是两个不同的值。 */
        ...(reporter ? { reporterName: reporter } : {}),
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof AdminBffError ? err.message : t("failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogForm
      open
      size="lg"
      title={t("title")}
      description={t("description")}
      submitLabel={t("submit")}
      cancelLabel={tShared("actions.cancel")}
      submitting={submitting}
      submitDisabled={!canSubmit}
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
      onSubmit={handleSubmit}
    >
      {tenantsFailed ? (
        <Banner
          tone="danger"
          title={t("tenantsFailed")}
          description={t("tenantsFailedDetail")}
        />
      ) : null}
      <FieldGroup columns={2}>
        <Field>
          <FieldLabel
            required
            requiredLabel={t("required")}
            hint={t("tenantHint")}
            hintLabel={t("hintLabel")}
          >
            {t("tenantLabel")}
          </FieldLabel>
          <Combobox
            className="w-full"
            items={tenantItems}
            value={tenantCode}
            onValueChange={setTenantCode}
            placeholder={t("tenantPlaceholder")}
            searchPlaceholder={t("tenantSearchPlaceholder")}
            emptyText={t("tenantEmpty")}
            disabled={tenantItems.length === 0}
          />
        </Field>
        <Field>
          <FieldLabel
            htmlFor="vx-ticket-create-priority"
            required
            requiredLabel={t("required")}
            hint={t("priorityHint")}
            hintLabel={t("hintLabel")}
          >
            {t("priorityLabel")}
          </FieldLabel>
          <NativeSelect
            id="vx-ticket-create-priority"
            value={priority}
            onChange={(event) =>
              setPriority(event.target.value as TicketPriority)
            }
          >
            {TICKET_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {priorityLabels[value]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel
            htmlFor="vx-ticket-create-reporter"
            hint={t("reporterHint")}
            hintLabel={t("hintLabel")}
          >
            {t("reporterLabel")}{" "}
            <StatusBadge tone="info" icon="eye">
              {tAudience("customerVisible")}
            </StatusBadge>
          </FieldLabel>
          <Input
            id="vx-ticket-create-reporter"
            value={reporterName}
            maxLength={REPORTER_MAX}
            onChange={(event) => setReporterName(event.target.value)}
            placeholder={t("reporterPlaceholder")}
          />
        </Field>
        <Field span="full">
          <FieldLabel
            htmlFor="vx-ticket-create-title"
            required
            requiredLabel={t("required")}
            hint={t("titleHint")}
            hintLabel={t("hintLabel")}
          >
            {t("titleLabel")}{" "}
            <StatusBadge tone="info" icon="eye">
              {tAudience("customerVisible")}
            </StatusBadge>
          </FieldLabel>
          <Input
            id="vx-ticket-create-title"
            value={title}
            maxLength={TITLE_MAX}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("titlePlaceholder")}
            autoFocus
          />
        </Field>
        <Field span="full">
          <FieldLabel
            htmlFor="vx-ticket-create-description"
            required
            requiredLabel={t("required")}
            hint={t("descriptionHint")}
            hintLabel={t("hintLabel")}
          >
            {t("descriptionLabel")}{" "}
            <StatusBadge tone="info" icon="eye">
              {tAudience("customerVisible")}
            </StatusBadge>
          </FieldLabel>
          <Textarea
            id="vx-ticket-create-description"
            value={description}
            maxLength={DESCRIPTION_MAX}
            rows={5}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t("descriptionPlaceholder")}
          />
        </Field>
      </FieldGroup>
      <FieldError>{error}</FieldError>
    </DialogForm>
  );
}
