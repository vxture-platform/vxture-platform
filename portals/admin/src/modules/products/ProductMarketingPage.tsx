"use client";

/**
 * ProductMarketingPage.tsx - 产品营销配置（独立二级页）。
 * @package @vxture/admin
 * @layer Presentation
 * @category Modules - Products
 *
 * 与产品详情**同级**，不是它的子页——两者互为跳转（owner 2026-09-21：
 * 「独立页面，不是弹出面板」「两者之间是跳转关系，不是隶属关系」）。
 *
 * ── 它替掉了什么 ──
 * 营销内容原先是产品详情页里的一个对话框（`ProductContentEditDialog`）。对话框
 * 装不下这份表单：双语、六个文案字段、三组可增删的数组，还要能看预览。
 *
 * ── admin 在这张表上只能写三样 ──
 * `marketing`（双语富结构）/ `release_stage`（承诺等级）/ `is_customer_visible`
 * （客户端可见）。产品的技术资料（编码/类型/来源/计量/接入）写入面在运维台——
 * 这里**显示但不给输入框**（全站规则：禁用输入框不当展示，用文字）。
 *
 * `is_workforce_visible`（运营端可见）是真字段但 BFF 的写入口不收它，所以它也在
 * 只读区，不做成开关——给一个按不动的开关比不给更糟。
 *
 * ── 成熟度只能向前 ──
 * developing → beta → ga，可跨级，不开倒退口（BFF 侧 409）。要把产品从客户面前
 * 收回去该改可见性，那是另一根轴。界面上把这条写在字段下面，不让人撞了才知道。
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Badge,
  Banner,
  Button,
  Card,
  CardContent,
  EmptyState,
  Icon,
  Input,
  SegmentedControl,
  Section,
  StatusBadge,
  Switch,
  Textarea,
  useToast,
} from "@vxture/design-system";
import {
  RELEASE_STAGE_DEFS,
  RELEASE_STAGES as RELEASE_STAGES_DOMAIN,
} from "@vxture/core-utils";
import { SolutionField } from "./SolutionField";
import { isStepUpCancelled, useStepUp } from "@/providers/StepUpProvider";
import { fetchProductCapability, updateProductContent } from "@/api/admin-bff";
import type {
  ProductCapabilityRecord,
  ProductContentWriteInput,
  ProductMarketingContent,
  ProductMarketingLocale,
} from "@/entities/console";
import { PUBLISH_STATUS_TONE } from "@/modules/shared/publish-tone";
import { useCapabilityTypeLabels } from "@/modules/shared/enum-labels";
import { formatNumber } from "@/modules/tenants/tenant-utils";

/* 值域与标签的权威源在 `@vxture/core-utils`（RELEASE_STAGE_DEFS）。 */
const RELEASE_STAGES = RELEASE_STAGE_DEFS.map((d) => ({
  value: d.value,
  label: d.labelZh,
}));
/* 顺序权威也在 core-utils（RELEASE_STAGES 的数组序 = 承诺链的前进方向），
   这里不再另抄一份：抄一份就会在加档位那天漏掉新值而无人报错。 */
const STAGE_ORDER = RELEASE_STAGES_DOMAIN;

type LocaleForm = {
  tagline: string;
  value: string;
  highlights: string[];
  tags: string[];
  industries: string[];
  detail: string;
};

function toLocaleForm(m?: ProductMarketingLocale): LocaleForm {
  return {
    tagline: m?.tagline ?? "",
    value: m?.value ?? "",
    highlights: [...(m?.highlights ?? [])],
    tags: [...(m?.tags ?? [])],
    industries: [...(m?.industries ?? [])],
    detail: m?.detail ?? "",
  };
}

function toLocale(f: LocaleForm): ProductMarketingLocale {
  const clean = (list: string[]) => list.map((x) => x.trim()).filter(Boolean);
  return {
    tagline: f.tagline.trim(),
    value: f.value.trim(),
    highlights: clean(f.highlights),
    tags: clean(f.tags),
    industries: clean(f.industries),
    detail: f.detail.trim(),
  };
}

/**
 * 可增删可排序的一组短文本（亮点 / 标签 / 适用行业）。
 *
 * owner 2026-09-21：「灵活性要高」。原来这三组是一个 `Textarea` 里「一行一条」
 * ——能用，但看不出边界、也排不了序，长一点的亮点换行后就分不清是两条还是一条。
 */
function StringListField({
  label,
  hint,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  items: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved as string);
    onChange(next);
  };

  return (
    <SolutionField label={label} hint={hint}>
      <div className="grid min-w-0 gap-xs">
        {items.map((item, index) => (
          <div key={index} className="flex min-w-0 items-center gap-xs">
            <Input
              value={item}
              placeholder={placeholder}
              onChange={(event) => {
                const next = [...items];
                next[index] = event.target.value;
                onChange(next);
              }}
            />
            <Button
              variant="ghost"
              size="icon-md"
              aria-label={`${label}第 ${index + 1} 条上移`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <Icon name="chevron-up" size="xs" fallback="placeholder" />
            </Button>
            <Button
              variant="ghost"
              size="icon-md"
              aria-label={`${label}第 ${index + 1} 条下移`}
              disabled={index === items.length - 1}
              onClick={() => move(index, 1)}
            >
              <Icon name="chevron-down" size="xs" fallback="placeholder" />
            </Button>
            <Button
              variant="ghost"
              size="icon-md"
              aria-label={`删除${label}第 ${index + 1} 条`}
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              <Icon name="trash" size="xs" fallback="placeholder" />
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => onChange([...items, ""])}
        >
          <Icon name="plus" size="xs" fallback="placeholder" />
          {`添加${label}`}
        </Button>
      </div>
    </SolutionField>
  );
}

/** 只读一格：显示而不给输入框（全站规则：禁用输入框不当展示）。 */
function ReadOnlyCell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2xs">
      <span className="truncate text-label-sm text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 truncate text-body-sm text-foreground">
        {children}
      </span>
    </div>
  );
}

/**
 * 薄加载器：拉到产品后再渲染表单。
 *
 * 表单的初始值全部从 `product` 派生（成熟度、可见性、双语文案……），所以它必须
 * 在**拿到数据之后**才挂载——把 product 做成可空再到处判空，等于让每个字段自己
 * 处理「还没加载」，而那是加载器的事。
 */
export function ProductMarketingPage({ productCode }: { productCode: string }) {
  const [product, setProduct] = useState<ProductCapabilityRecord | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchProductCapability(productCode)
      .then((record) => {
        if (active) setProduct(record);
      })
      .catch(() => {
        if (active) setProduct(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [productCode]);

  if (!product) {
    return (
      <div className="grid min-w-0 gap-xl">
        <EmptyState
          title={loading ? "正在加载产品" : "产品不存在"}
          description={
            loading ? "正在读取产品营销配置。" : "该产品不存在或已被删除。"
          }
        />
      </div>
    );
  }
  return <MarketingForm product={product} />;
}

function MarketingForm({
  product: initial,
}: {
  product: ProductCapabilityRecord;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { runWithStepUp } = useStepUp();
  const capabilityTypeLabels = useCapabilityTypeLabels();

  const [product, setProduct] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeLocale, setActiveLocale] = useState<"zh" | "en">("zh");

  const [releaseStage, setReleaseStage] = useState(product.releaseStage);
  const [visible, setVisible] = useState(product.visibility === "public");
  /* 推荐度 0–3（语言无关，顶层字段）：官网未订阅产品卡右上角按数量画奖章。 */
  const [recommend, setRecommend] = useState(
    Math.max(
      0,
      Math.min(3, Math.round(Number(product.marketing?.recommend ?? 0)) || 0),
    ),
  );
  /* 预期发布日期（顶层，语言无关）：开发中的产品官网卡底部显示「预期发布：日期」；
     上线后官网自动改用 released_at，此字段不再展示。 */
  const [expectedReleaseAt, setExpectedReleaseAt] = useState(
    product.marketing?.expectedReleaseAt ?? "",
  );
  const [zh, setZh] = useState<LocaleForm>(() =>
    toLocaleForm(product.marketing?.zh),
  );
  const [en, setEn] = useState<LocaleForm>(() =>
    toLocaleForm(product.marketing?.en),
  );

  const form = activeLocale === "zh" ? zh : en;
  const setForm = activeLocale === "zh" ? setZh : setEn;
  const patch = <K extends keyof LocaleForm>(
    key: K,
    value: LocaleForm[K],
  ): void => setForm((prev) => ({ ...prev, [key]: value }));

  /* 承诺等级只向前：当前档之前的都不可选。把规则画在控件上，而不是等 BFF 409。 */
  const stageItems = useMemo(() => {
    const current = STAGE_ORDER.indexOf(
      product.releaseStage as (typeof STAGE_ORDER)[number],
    );
    return RELEASE_STAGES.map((stage) => ({
      value: stage.value,
      label: stage.label,
      disabled:
        STAGE_ORDER.indexOf(stage.value as (typeof STAGE_ORDER)[number]) <
        Math.max(0, current),
    }));
  }, [product.releaseStage]);

  async function save() {
    setSubmitting(true);
    setError(null);
    const marketing: ProductMarketingContent = {
      zh: toLocale(zh),
      en: toLocale(en),
      recommend,
      ...(expectedReleaseAt ? { expectedReleaseAt } : {}),
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
      toast({ tone: "success", title: "营销配置已保存" });
      setProduct(updated);
    } catch (err) {
      if (isStepUpCancelled(err)) return;
      setError(err instanceof Error ? err.message : "保存失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-xl">
      <nav
        className="flex min-w-0 items-center gap-2xs text-body-sm text-muted-foreground"
        aria-label="面包屑"
      >
        <Link
          className="font-extrabold text-primary-text no-underline"
          href="/products"
        >
          产品目录
        </Link>
        <Icon name="chevron-right" size="xs" fallback="placeholder" />
        <Link
          className="min-w-0 truncate font-extrabold text-primary-text no-underline"
          href={`/products/${encodeURIComponent(product.productCode)}`}
        >
          {product.productName}
        </Link>
        <Icon name="chevron-right" size="xs" fallback="placeholder" />
        <span className="text-foreground">营销配置</span>
      </nav>

      {/* 只读身份行：这是谁。改不了的东西不给输入框。 */}
      <header className="flex min-w-0 flex-wrap items-center gap-sm">
        <h1 className="m-0 min-w-0 truncate text-title-xl font-semibold text-foreground">
          {product.productName}
        </h1>
        <span className="shrink-0 text-body-sm font-extrabold text-muted-foreground">
          {product.productCode}
        </span>
        <div className="flex flex-wrap items-center gap-xs">
          <Badge variant="outline">
            {capabilityTypeLabels[product.productType]}
          </Badge>
          <Badge variant="outline">
            {product.source === "self" ? "自建" : "三方接入"}
          </Badge>
          <StatusBadge tone={PUBLISH_STATUS_TONE[product.status]}>
            {product.status === "active"
              ? "已上线"
              : product.status === "draft"
                ? "草稿"
                : "已归档"}
          </StatusBadge>
        </div>
        <div className="ml-auto inline-flex shrink-0 items-center gap-sm">
          <Button
            variant="outline"
            disabled={submitting}
            onClick={() =>
              router.push(
                `/products/${encodeURIComponent(product.productCode)}`,
              )
            }
          >
            取消
          </Button>
          <Button disabled={submitting} onClick={() => void save()}>
            {submitting ? "保存中…" : "保存"}
          </Button>
        </div>
      </header>

      {error ? <Banner tone="danger" title={error} /> : null}

      <Section
        tone="glass"
        level={2}
        icon="rocket"
        title="发布控制"
        className="min-w-0"
        description="决定这个产品在官网与客户控制台如何出现。"
      >
        <div className="grid min-w-0 gap-lg lg:grid-cols-2">
          <SolutionField
            label="成熟度"
            hint="只能向前：开发中 → 公测版 → 正式版，可跨级。改到更高档后无法回退——要把产品从客户面前收回，请改下面的客户端可见。"
          >
            <SegmentedControl
              items={stageItems}
              value={releaseStage}
              onChange={(next) => setReleaseStage(next)}
              aria-label="成熟度"
            />
          </SolutionField>

          <SolutionField
            label="客户端可见"
            hint="关掉后官网与客户控制台的目录里不再出现；已订阅的客户不受影响。"
          >
            <div className="flex items-center gap-sm">
              <Switch
                checked={visible}
                onCheckedChange={setVisible}
                aria-label="客户端可见"
              />
              <span className="text-body-sm text-foreground">
                {visible ? "在目录中出现" : "不在目录中出现"}
              </span>
            </div>
          </SolutionField>

          <SolutionField
            label="推荐度"
            hint="0–3。官网未订阅的产品卡右上角按这个数量画奖章。"
          >
            <SegmentedControl
              items={[0, 1, 2, 3].map((n) => ({
                value: String(n),
                label: n === 0 ? "不推荐" : `${n} 级`,
              }))}
              value={String(recommend)}
              onChange={(next) => setRecommend(Number(next))}
              aria-label="推荐度"
            />
          </SolutionField>

          <SolutionField
            label="预期发布日期"
            hint="只在「开发中」时用：官网卡底部显示「预期发布」。上线后官网自动改用真实发布时间，这一项不再展示。"
          >
            <Input
              type="date"
              value={expectedReleaseAt}
              onChange={(event) => setExpectedReleaseAt(event.target.value)}
              disabled={releaseStage !== "preview"}
            />
          </SolutionField>
        </div>
      </Section>

      <Section
        tone="glass"
        level={2}
        icon="edit"
        title="营销文案"
        className="min-w-0"
        description="官网与客户控制台展示的内容。中英文各存一份，不走 i18n 词条。"
        action={
          /* 语言切换而不是并排两栏：并排会把每个字段挤成半宽，长文案没法写。 */
          <SegmentedControl
            items={[
              { value: "zh", label: "中文" },
              { value: "en", label: "English" },
            ]}
            value={activeLocale}
            onChange={(next) => setActiveLocale(next as "zh" | "en")}
            aria-label="文案语言"
          />
        }
      >
        <div className="grid min-w-0 gap-lg">
          <SolutionField
            label="一句话主张"
            count={{ value: form.tagline, max: 60 }}
          >
            <Input
              value={form.tagline}
              maxLength={60}
              placeholder={
                activeLocale === "zh" ? "把智能装进每一件事" : "One line pitch"
              }
              onChange={(event) => patch("tagline", event.target.value)}
            />
          </SolutionField>

          <SolutionField
            label="价值说明"
            hint="两三句话说清它解决什么问题。"
            count={{ value: form.value, max: 300 }}
          >
            <Textarea
              value={form.value}
              maxLength={300}
              rows={3}
              onChange={(event) => patch("value", event.target.value)}
            />
          </SolutionField>

          <StringListField
            label="亮点"
            hint="官网卡片上逐条列出，顺序就是展示顺序。"
            items={form.highlights}
            placeholder="一条亮点"
            onChange={(next) => patch("highlights", next)}
          />
          <StringListField
            label="标签"
            items={form.tags}
            placeholder="一个标签"
            onChange={(next) => patch("tags", next)}
          />
          <StringListField
            label="适用行业"
            items={form.industries}
            placeholder="一个行业"
            onChange={(next) => patch("industries", next)}
          />

          <SolutionField
            label="详情正文"
            hint="产品详情页的长文。"
            count={{ value: form.detail, max: 2000 }}
          >
            <Textarea
              value={form.detail}
              maxLength={2000}
              rows={8}
              onChange={(event) => patch("detail", event.target.value)}
            />
          </SolutionField>
        </div>
      </Section>

      <Section
        tone="glass"
        level={2}
        icon="eye"
        title="官网预览"
        className="min-w-0"
        description="示意，不是官网的真组件——按当前成熟度画官网会呈现的那一档。"
      >
        <Card className="min-w-0 max-w-panel-sm">
          <CardContent className="grid min-w-0 gap-sm">
            <div className="flex min-w-0 items-start gap-sm">
              <span className="grid min-w-0 gap-2xs">
                <span className="min-w-0 truncate text-title-md font-semibold text-foreground">
                  {form.tagline || product.productName}
                </span>
                <span className="text-body-sm text-muted-foreground">
                  {form.value || "（价值说明未填）"}
                </span>
              </span>
              {recommend > 0 ? (
                <span className="ml-auto inline-flex shrink-0 items-center gap-2xs">
                  {Array.from({ length: recommend }, (_, i) => (
                    <Icon
                      key={i}
                      name="star"
                      size="xs"
                      fallback="placeholder"
                      aria-hidden="true"
                      className="text-primary"
                    />
                  ))}
                </span>
              ) : null}
            </div>
            {form.highlights.filter(Boolean).length ? (
              <ul className="m-0 grid list-none gap-2xs p-0">
                {form.highlights.filter(Boolean).map((item, index) => (
                  <li
                    key={index}
                    className="flex min-w-0 items-center gap-xs text-body-sm text-foreground"
                  >
                    <Icon
                      name="check"
                      size="xs"
                      fallback="placeholder"
                      aria-hidden="true"
                      className="shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 truncate">{item}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap items-center gap-xs">
              {form.tags.filter(Boolean).map((tag, index) => (
                <Badge key={index} variant="outline">
                  {tag}
                </Badge>
              ))}
            </div>
            <span className="text-body-sm text-muted-foreground">
              {releaseStage === "preview"
                ? expectedReleaseAt
                  ? `预期发布：${expectedReleaseAt}`
                  : "敬请期待"
                : releaseStage === "beta"
                  ? "公测中，可申请试用"
                  : releaseStage === "sunset"
                    ? "已停售：老客户照常使用与续订，不再接受新订阅"
                    : "可直接订阅"}
            </span>
            {!visible ? (
              <span className="text-body-sm text-destructive-text">
                客户端可见已关闭——官网目录里不会出现这张卡。
              </span>
            ) : null}
          </CardContent>
        </Card>
      </Section>

      <Section
        tone="glass"
        level={2}
        icon="info"
        title="产品信息（只读）"
        className="min-w-0"
        description="这些在运维台的产品接入页维护，此处只读。"
      >
        <div className="grid min-w-0 gap-lg sm:grid-cols-2 lg:grid-cols-3">
          <ReadOnlyCell label="产品分类">
            {product.categoryName || "—"}
          </ReadOnlyCell>
          <ReadOnlyCell label="产品类型">
            {capabilityTypeLabels[product.productType]}
          </ReadOnlyCell>
          <ReadOnlyCell label="英文名称">
            {product.productNameEn || "—"}
          </ReadOnlyCell>
          <ReadOnlyCell label="合作方">
            {product.originProvider || "—"}
          </ReadOnlyCell>
          <ReadOnlyCell label="产品版本">
            {product.releaseVersion || "—"}
          </ReadOnlyCell>
          {/* 运营端可见是真字段，但 BFF 的写入口不收它——给一个按不动的开关比
              不给更糟，所以放在只读区。 */}
          <ReadOnlyCell label="运营端可见">
            {product.isWorkforceVisible ? "可见" : "不可见"}
          </ReadOnlyCell>
          <ReadOnlyCell label="正式套餐">
            {`${formatNumber(product.publishedPlanCount)} / ${formatNumber(product.planCount)} 个`}
          </ReadOnlyCell>
          <ReadOnlyCell label="订阅开放">
            {product.planCount
              ? `${formatNumber(product.publicPlanCount)} 个套餐`
              : "—"}
          </ReadOnlyCell>
          <ReadOnlyCell label="计量项">
            {`${formatNumber(product.metrics.length)} 项`}
          </ReadOnlyCell>
        </div>
      </Section>
    </div>
  );
}
