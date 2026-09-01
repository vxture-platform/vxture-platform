"use client";

/**
 * ProductContentEditDialog —— 产品目录:营销内容与呈现编辑框。
 *
 * @package @vxture/admin
 * @layer Presentation
 * @category Products
 *
 * 非技术人员友好:成熟度(下拉)、上站可见性(下拉)、双语营销内容(中/英切换,
 * 每语:标语/业务价值/能力亮点/标签/行业/详情)。写 marketing/release_stage/
 * is_customer_visible 三类业务字段(PATCH content,step-up)。技术注册在运维台。
 */

import { useState, type FormEvent } from "react";
import {
  Banner,
  Button,
  DialogForm,
  Input,
  NativeSelect,
  Textarea,
  useToast,
} from "@vxture/design-system";
import { SolutionField } from "./SolutionField";
import { isStepUpCancelled, useStepUp } from "@/providers/StepUpProvider";
import { updateProductContent } from "@/api/admin-bff";
import type {
  ProductCapabilityRecord,
  ProductContentWriteInput,
  ProductMarketingContent,
  ProductMarketingLocale,
} from "@/entities/console";

// 与 @vxture/core-utils RELEASE_STAGES 保持一致(admin 未依赖 core-utils,3 值本地镜像)。
const RELEASE_STAGE_OPTIONS = [
  { value: "ga", label: "正式版" },
  { value: "beta", label: "公测版" },
  { value: "developing", label: "开发中" },
] as const;

type LocaleForm = {
  tagline: string;
  value: string;
  highlights: string; // 一行一条
  tags: string;
  industries: string;
  detail: string;
};

function toLocaleForm(m?: ProductMarketingLocale): LocaleForm {
  return {
    tagline: m?.tagline ?? "",
    value: m?.value ?? "",
    highlights: (m?.highlights ?? []).join("\n"),
    tags: (m?.tags ?? []).join("\n"),
    industries: (m?.industries ?? []).join("\n"),
    detail: m?.detail ?? "",
  };
}

const lines = (s: string): string[] =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

function toLocale(f: LocaleForm): ProductMarketingLocale {
  return {
    tagline: f.tagline.trim(),
    value: f.value.trim(),
    highlights: lines(f.highlights),
    tags: lines(f.tags),
    industries: lines(f.industries),
    detail: f.detail.trim(),
  };
}

export function ProductContentEditDialog({
  product,
  open,
  onOpenChange,
  onSaved,
}: {
  product: ProductCapabilityRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (updated: ProductCapabilityRecord) => void;
}) {
  const { toast } = useToast();
  const { runWithStepUp } = useStepUp();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeLocale, setActiveLocale] = useState<"zh" | "en">("zh");

  const [releaseStage, setReleaseStage] = useState(product.releaseStage);
  const [visible, setVisible] = useState(product.visibility === "public");
  const [zh, setZh] = useState<LocaleForm>(() =>
    toLocaleForm(product.marketing?.zh),
  );
  const [en, setEn] = useState<LocaleForm>(() =>
    toLocaleForm(product.marketing?.en),
  );

  const form = activeLocale === "zh" ? zh : en;
  const setForm = activeLocale === "zh" ? setZh : setEn;
  const patch = (key: keyof LocaleForm, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const marketing: ProductMarketingContent = {
      zh: toLocale(zh),
      en: toLocale(en),
    };
    const body: ProductContentWriteInput = {
      marketing,
      releaseStage,
      isCustomerVisible: visible,
    };
    try {
      const updated = await runWithStepUp(() =>
        updateProductContent(product.productCode, body),
      );
      toast({ tone: "success", title: "营销内容已更新" });
      onSaved(updated);
      onOpenChange(false);
    } catch (err) {
      if (isStepUpCancelled(err)) return;
      setError(err instanceof Error ? err.message : "更新失败,请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogForm
      open={open}
      size="xl"
      title={`编辑营销内容 · ${product.productName}`}
      description="成熟度、上站可见性与双语营销内容。技术注册(编码/类型/来源)在运维台维护。"
      submitLabel="保存"
      cancelLabel="取消"
      submitting={submitting}
      onOpenChange={onOpenChange}
      onSubmit={(event) => void submit(event)}
    >
      {error ? <Banner tone="danger" title={error} /> : null}

      <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
        <SolutionField label="成熟度">
          <NativeSelect
            value={releaseStage}
            onChange={(e) => setReleaseStage(e.target.value)}
          >
            {RELEASE_STAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </SolutionField>
        <SolutionField
          label="上站可见"
          hint="开发中/公测/正式都可上站;下站则官网不展示。"
        >
          <NativeSelect
            value={visible ? "on" : "off"}
            onChange={(e) => setVisible(e.target.value === "on")}
          >
            <option value="on">上站(展示)</option>
            <option value="off">下站(隐藏)</option>
          </NativeSelect>
        </SolutionField>
      </div>

      <div className="mt-md inline-flex gap-xs">
        <Button
          type="button"
          size="sm"
          variant={activeLocale === "zh" ? "default" : "outline"}
          onClick={() => setActiveLocale("zh")}
        >
          中文
        </Button>
        <Button
          type="button"
          size="sm"
          variant={activeLocale === "en" ? "default" : "outline"}
          onClick={() => setActiveLocale("en")}
        >
          English
        </Button>
      </div>

      <SolutionField label="类型标语 / Tagline">
        <Input
          value={form.tagline}
          onChange={(e) => patch("tagline", e.target.value)}
          placeholder={
            activeLocale === "zh"
              ? "如:数字员工 · 通用类"
              : "e.g. Digital Employee · General"
          }
        />
      </SolutionField>
      <SolutionField label="业务价值 / Value">
        <Textarea
          rows={2}
          value={form.value}
          onChange={(e) => patch("value", e.target.value)}
        />
      </SolutionField>
      <div className="grid grid-cols-1 gap-md sm:grid-cols-3">
        <SolutionField label="能力亮点" hint="一行一条">
          <Textarea
            rows={4}
            value={form.highlights}
            onChange={(e) => patch("highlights", e.target.value)}
          />
        </SolutionField>
        <SolutionField label="标签" hint="一行一条">
          <Textarea
            rows={4}
            value={form.tags}
            onChange={(e) => patch("tags", e.target.value)}
          />
        </SolutionField>
        <SolutionField label="行业" hint="一行一条">
          <Textarea
            rows={4}
            value={form.industries}
            onChange={(e) => patch("industries", e.target.value)}
          />
        </SolutionField>
      </div>
      <SolutionField label="详情 / Detail" hint="产品描述页长文案(可留空)">
        <Textarea
          rows={4}
          value={form.detail}
          onChange={(e) => patch("detail", e.target.value)}
        />
      </SolutionField>
    </DialogForm>
  );
}
