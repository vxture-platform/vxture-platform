"use client";

/**
 * ReviewDialog — 客户评价：产品 / 价格 / 服务三项，5 分制五角星，外加一段留言。
 *
 * 外壳走 DS `DialogForm`，字段走 `Field` + `FieldLabel`（标签在上、控件在下）。
 * 星级用 DS `Rating`（12.15.0 起）——不在门户里再手搓一份。
 *
 * ── 三项都可以留空 ──
 * 表上三条 CHECK 各自允许 NULL，只要求「至少评一项」。空**不是 0 分**：聚合走
 * `AVG`，NULL 自然跳过，于是只评了产品的客户不会把价格分的分母也撑大。所以这里
 * 的初值是 `null` 而不是 3，提交时也只送评了的那几项。
 *
 * ── 语气 ──
 * owner 2026-09-20：「语气需要友好，不能生硬，欢迎… 感谢… 隐性表达评价这一次」。
 * 所以「一次订阅只能评一次」这句话**不明写**——开头用「这一程」把一次性说成陪伴
 * 的节点，结尾道谢；限制从语气里读得出来，不必挑明。真撞上重复提交时服务端回
 * 409，那时才说「这一程已经评价过了，续订之后可以再聊」。
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  DialogForm,
  Field,
  FieldDescription,
  FieldLabel,
  Rating,
  Textarea,
} from "@vxture/design-system";
import type { FormEvent } from "react";
import { submitReview } from "@/api/console-bff";
import { ConsoleBffError } from "@/api/console-bff";

const COMMENT_MAX = 512;

/** 三项各一行：标签 + 星级 + 一句说明。说明放标签下、星级上方。 */
interface ScoreRowProps {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly value: number | null;
  readonly onChange: (next: number | null) => void;
  readonly optionLabels: readonly string[];
  readonly labels: Record<string, string>;
}

function ScoreRow({
  id,
  label,
  hint,
  value,
  onChange,
  optionLabels,
  labels,
}: ScoreRowProps) {
  return (
    <Field>
      {/* 左右布局：左边「项目 + 一句说明」，右边星星。
          此前三者竖着堆三层——文字全挤在左边，星星另起一行，右边整片空白，
          三项排下来页面又高又空（owner 2026-09-20 实看）。
          横排还带来一个好处：三行星星在同一条竖直线上，一眼能比出哪项给低了。
          窄屏下 flex-wrap 让它自己退回上下两段，不写断点。 */}
      <div className="flex flex-wrap items-center justify-between gap-md">
        <span className="flex min-w-0 flex-col gap-2xs">
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <FieldDescription>{hint}</FieldDescription>
        </span>
        <Rating
          className="shrink-0"
          aria-label={label}
          value={value}
          onValueChange={onChange}
          optionLabels={optionLabels}
          labels={labels}
        />
      </div>
    </Field>
  );
}

export function ReviewDialog({
  open,
  subscriptionId,
  productName,
  onClose,
  onSubmitted,
}: {
  readonly open: boolean;
  readonly subscriptionId: string;
  readonly productName: string;
  readonly onClose: () => void;
  /** 提交成功后父页把这条订阅标成「已评价」，不必整页重拉。 */
  readonly onSubmitted: () => void;
}) {
  const t = useTranslations("subscriptionHub.review");
  const [product, setProduct] = useState<number | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [service, setService] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const scoreLabels = [
    t("scoreLabels.0"),
    t("scoreLabels.1"),
    t("scoreLabels.2"),
    t("scoreLabels.3"),
    t("scoreLabels.4"),
  ];
  // 件内文案的中文覆盖。DS 的默认值是英文托底，不传就会把英文漏到界面上。
  const ratingLabels = {
    // optionTemplate 是 optionLabels 缺位时的兜底;这里三项都传了词,它轮不到。
    optionTemplate: "{score} / {max}",
    roleDescription: t("roleDescription"),
    valueTemplate: "{value} / {max}",
    emptyLabel: t("notRated"),
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (product === null && price === null && service === null) {
      setError(t("emptyError"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // 只送评了的那几项——送 0 会被表上的 1..5 CHECK 拒掉，而且 0 分与"没评"
      // 本来就是两回事。
      await submitReview({
        subscriptionId,
        ...(product === null ? {} : { productScore: product }),
        ...(price === null ? {} : { priceScore: price }),
        ...(service === null ? {} : { serviceScore: service }),
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      onSubmitted();
      onClose();
    } catch (cause) {
      // 409 是「这次机会已经用过」，不是请求写错——换一句它自己的话。
      setError(
        cause instanceof ConsoleBffError && cause.status === 409
          ? t("duplicateError")
          : cause instanceof Error
            ? cause.message
            : t("emptyError"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogForm
      open
      size="lg"
      title={t("title", { product: productName })}
      description={t("intro")}
      submitLabel={t("submit")}
      cancelLabel={t("cancel")}
      submitting={submitting}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      onSubmit={handleSubmit}
    >
      <ScoreRow
        id="review-product"
        label={t("productLabel")}
        hint={t("productHint")}
        value={product}
        onChange={setProduct}
        optionLabels={scoreLabels}
        labels={ratingLabels}
      />
      <ScoreRow
        id="review-price"
        label={t("priceLabel")}
        hint={t("priceHint")}
        value={price}
        onChange={setPrice}
        optionLabels={scoreLabels}
        labels={ratingLabels}
      />
      <ScoreRow
        id="review-service"
        label={t("serviceLabel")}
        hint={t("serviceHint")}
        value={service}
        onChange={setService}
        optionLabels={scoreLabels}
        labels={ratingLabels}
      />
      <Field>
        <FieldLabel htmlFor="review-comment">{t("commentLabel")}</FieldLabel>
        <Textarea
          id="review-comment"
          value={comment}
          maxLength={COMMENT_MAX}
          placeholder={t("commentPlaceholder")}
          onChange={(event) => setComment(event.target.value)}
          rows={3}
        />
      </Field>
      <p className="text-body-sm text-muted-foreground">
        {t("outro", { product: productName })}
      </p>
      {error ? (
        <p className="text-body-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </DialogForm>
  );
}
