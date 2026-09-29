"use client";

/**
 * TicketComposeDialog.tsx — 提交工单。**全 console 只有这一个提单表单。**
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * owner 2026-09-29 第 5 条裁决：「其他页面的求助只做跳转入口，不许再出现第二个
 * 提单表单」。所以订单行、账单行、订阅卡上的「就这件事求助」不是三个小表单，
 * 它们只是三条带着可视码的链接（`lib/ticket-compose.ts`），落到这一页、开这一个
 * 对话框、把标题替客户写好第一句。顶栏抽屉底部那颗「提交工单」也走同一条路。
 *
 * ── 预填只填标题，不填正文 ──
 * 标题填成「关于订单 SO… 的问题」，正文**留空**。理由是正文里客户要写的是"出了
 * 什么事"，那句话我们替他编不出来；预填一段"我在使用订单 SO… 时遇到问题"看着
 * 贴心，实际是让客户在一段套话上继续写，运营读到的第一行永远是我们自己写的字。
 * 标题不一样：它要回答"这是关于哪个对象的"，而那个答案我们手上正好有。
 *
 * ── 为什么标题预填之后仍然可改 ──
 * 它是客户的话，不是我们的元数据。真正把"这张单关于哪个对象"记成结构化字段是
 * 另一件事（`support.tickets` 上没有那一列，加列要 owner 裁），本批不做：
 * 见 PR 正文里点名的那一处。
 */

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  DialogForm,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Textarea,
} from "@vxture/design-system";
import {
  ConsoleBffError,
  createMyTicket,
  type ConsoleTicket,
} from "@/api/console-bff";
import type { TicketSubject } from "@/lib/ticket-compose";

/** 与 `support.tickets.title` 的列宽同口径（varchar(200)）。 */
const TITLE_MAX = 200;
/** 与运营侧写入路径的 `requireTicketText(…, 10000)` 同口径。 */
const DESCRIPTION_MAX = 10_000;

export interface TicketComposeDialogProps {
  readonly open: boolean;
  /** 这张单是关于哪个对象的（来自跳转入口）；没有就是一张空白单。 */
  readonly subject: TicketSubject | null;
  readonly onClose: () => void;
  readonly onCreated: (ticket: ConsoleTicket) => void;
}

export function TicketComposeDialog({
  open,
  subject,
  onClose,
  onCreated,
}: TicketComposeDialogProps) {
  const t = useTranslations("tickets.compose");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* 预填的三种句子各写一条完整句（不拼「关于」+ 对象名 + 「的问题」三段）：
     插值拼句在英文下语序会散架，而这三句在两种语言里都是整句。 */
  const prefillTitle = (s: TicketSubject): string => {
    switch (s.type) {
      case "order":
        return t("prefillOrder", { code: s.code });
      case "bill":
        return t("prefillBill", { code: s.code });
      case "subscription":
        return t("prefillSubscription", { code: s.code });
    }
  };

  /* 每次打开都按当前 subject 重置。不在 subject 变化时改已经打开的框:
     客户可能已经在里面写了字。 */
  useEffect(() => {
    if (!open) return;
    setTitle(subject ? prefillTitle(subject) : "");
    setDescription("");
    setError(null);
    // subject 与 t 在同一次打开内不变；只跟 open 走，免得预填覆盖客户输入。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const trimmedTitle = title.trim();
  const trimmedDescription = description.trim();
  const canSubmit =
    trimmedTitle.length > 0 && trimmedDescription.length > 0 && !submitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createMyTicket({
        title: trimmedTitle,
        description: trimmedDescription,
      });
      onCreated(created);
    } catch (err) {
      /* 后端的具体原因带出来（标题太长、正文为空…都是客户自己能改的）；
         它没给话才落到通用那一句。 */
      const detail = err instanceof ConsoleBffError ? err.message : "";
      setError(detail || t("failed"));
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
      cancelLabel={t("cancel")}
      submitting={submitting}
      submitDisabled={!canSubmit}
      onOpenChange={(next) => {
        if (!next && !submitting) onClose();
      }}
      onSubmit={(event) => void handleSubmit(event)}
    >
      <Field>
        <FieldLabel htmlFor="vx-ticket-title">{t("titleLabel")}</FieldLabel>
        <Input
          id="vx-ticket-title"
          value={title}
          maxLength={TITLE_MAX}
          placeholder={t("titlePlaceholder")}
          onChange={(event) => setTitle(event.target.value)}
        />
        <FieldDescription>{t("titleHint")}</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="vx-ticket-description">
          {t("bodyLabel")}
        </FieldLabel>
        <Textarea
          id="vx-ticket-description"
          value={description}
          rows={6}
          maxLength={DESCRIPTION_MAX}
          placeholder={t("bodyPlaceholder")}
          onChange={(event) => setDescription(event.target.value)}
        />
        <FieldDescription>{t("bodyHint")}</FieldDescription>
      </Field>
      <FieldError>{error}</FieldError>
    </DialogForm>
  );
}
