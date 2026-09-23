"use client";

/**
 * HealthDrawer.tsx —— 产品页「运行健康」抽屉。
 *
 * ── 三屏，三个问题，各自给一个结论 ──
 *
 *   接入检查   还差哪几件**才能上线**        → 通过 / 还差 N 项
 *   接入认证   这条链**在沙箱里证过没有**    → 已认证 / 认证中 / 待复认证 / 未认证
 *   运行健康   跑起来之后**最近还正常吗**    → 正常 / 劣化 / **无数据**
 *
 * 这一屏此前不存在：端到端链路痕迹与开通回执住在「接入检查」里，画成红色的「未通过」。
 * 于是一个刚上线、还没有客户的产品，打开检查单看到一排红——而那些红的其实只是
 * **「还没有人用过」**。把「没人用」说成「坏了」，运营的第一反应是去修一个根本
 * 没坏的东西。
 *
 * ── 为什么这里没有「未通过」这一档 ──
 *
 * 「通过 / 未通过」是**准入**的说法：有一条线，过了才能往下走。运行健康不是准入，
 * 它**不挡任何动作**——产品已经在卖了，这一屏只是告诉你它跑得怎么样。
 *
 * 所以三态是 正常 / 劣化 / **无数据**，其中「无数据」是正常态：我们此刻什么都不知道，
 * 而那和「知道它坏了」是两件事，下一步也完全不同（等客户来 vs 去查哪一段断了）。
 *
 * ── 和认证的区别：同一份信号，两个问题 ──
 *
 * 认证读的是**沙箱里那一次**（按 sandbox_workspace_id 收口），答「证过没有」；
 * 这一屏读的是**该产品的全部流量**，答「最近还在不在跑」。同一批痕迹，两个视角——
 * 不是同一件事测两遍。
 */

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Drawer,
  Icon,
  SectionHeader,
  StatusBadge,
  useToast,
  type StatusBadgeTone,
} from "@vxture/design-system";
import { formatDateTime } from "@vxture-platform/shared";
import { OperaApiError } from "@/lib/api";
import {
  healthVerdict,
  runLaunchChecks,
  type CheckResult,
  type HealthVerdict,
} from "./launch-checks";

export interface HealthDrawerProduct {
  id: string;
  productCode: string;
  origin: string;
  originProvider: string | null;
}

export interface HealthDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly product: HealthDrawerProduct;
  readonly locale?: string;
}

const VERDICT_META: Record<
  HealthVerdict,
  { label: string; tone: StatusBadgeTone; hint: string }
> = {
  healthy: {
    label: "正常",
    tone: "success",
    hint: "各段最近都有痕迹，这个产品在正常跑。",
  },
  degraded: {
    label: "劣化",
    tone: "warning",
    hint: "有几段最近没有痕迹，链可能断在中间——下一步是去查断的那一段，不是等。",
  },
  unknown: {
    label: "无数据",
    tone: "neutral",
    /* 这句话是这一屏存在的理由，别改成「未通过」之类的说法。 */
    hint: "窗口内没有任何痕迹。这不是故障——多半是还没有客户在用，等有人用了再回来看。",
  },
};

function reason(error: unknown, fallback: string): string {
  return error instanceof OperaApiError && error.message
    ? error.message
    : fallback;
}

export function HealthDrawer({
  open,
  onClose,
  product,
  locale,
}: HealthDrawerProps) {
  const { toast } = useToast();
  const [checks, setChecks] = useState<CheckResult[] | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const measure = useCallback(async () => {
    setRunning(true);
    try {
      /* `exactOptionalPropertyTypes`：locale 可能是 undefined，而那个可选属性不收
         undefined——键不给和给一个 undefined 是两回事。 */
      const results = await runLaunchChecks(
        product,
        locale === undefined ? {} : { locale },
      );
      setChecks(results.filter((r) => r.scope === "health"));
      setCheckedAt(formatDateTime(new Date(), locale));
    } catch (error) {
      /* 读不到就说读不到。把读取失败显示成「无数据」是最坏的一种：两者长得一样，
         而一个是「没人用」、一个是「我们瞎了」。 */
      setChecks(null);
      toast({
        tone: "danger",
        title: "读不到运行痕迹",
        description: reason(error, "读不到运行痕迹"),
      });
    } finally {
      setRunning(false);
    }
  }, [product, locale, toast]);

  useEffect(() => {
    if (!open) return;
    void measure();
  }, [open, measure]);

  const verdict = checks ? healthVerdict(checks) : null;
  const meta = verdict ? VERDICT_META[verdict] : null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title="运行健康"
      description={`${product.productCode} · 最近还正常吗`}
    >
      <div className="flex flex-col gap-xl">
        <div className="flex flex-wrap items-center justify-between gap-sm">
          <div className="flex min-w-0 flex-col gap-2xs">
            <div className="flex items-center gap-sm">
              {running && !checks ? (
                <StatusBadge tone="neutral">读取中</StatusBadge>
              ) : meta ? (
                <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
              ) : (
                <StatusBadge tone="danger">读取失败</StatusBadge>
              )}
              <span className="text-body-sm text-muted-foreground">
                {checkedAt ? `实测于 ${checkedAt}` : "正在实测…"}
              </span>
            </div>
            <p className="text-body-sm text-muted-foreground">
              {meta?.hint ??
                "读不到运行痕迹——这和「没人用」不是一回事，先解决读取失败。"}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={running}
            onClick={() => void measure()}
          >
            <Icon name="refresh" size="sm" aria-hidden="true" />
            {running ? "实测中…" : "重新实测"}
          </Button>
        </div>

        <div className="flex flex-col gap-sm">
          <SectionHeader
            level={3}
            icon="gauge"
            title="最近的痕迹"
            description="读这个产品的全部流量，不限沙箱——认证问「证过没有」，这里问「最近还在不在跑」。"
          />
          {checks && checks.length > 0 ? (
            checks.map((c) => (
              <div
                key={c.id}
                className="flex flex-col gap-2xs border-b border-border py-xs last:border-b-0"
              >
                <div className="flex items-center justify-between gap-sm">
                  <div className="flex min-w-0 items-center gap-sm">
                    {/* 这里**只有两种徽标**：有痕迹 / 没痕迹。没有「未通过」——
                        那是准入的说法，而这一屏不挡任何动作。 */}
                    <StatusBadge
                      tone={c.status === "pass" ? "success" : "neutral"}
                    >
                      {c.status === "pass" ? "有痕迹" : "无痕迹"}
                    </StatusBadge>
                    <span className="text-label-md text-foreground">
                      {c.label}
                    </span>
                    {c.advisory ? (
                      <span className="text-body-sm text-muted-foreground">
                        仅供参考
                      </span>
                    ) : null}
                  </div>
                </div>
                <p className="text-body-sm text-muted-foreground">{c.detail}</p>
              </div>
            ))
          ) : (
            <p className="text-body-sm text-muted-foreground">
              {running ? "实测中…" : "读不到痕迹。"}
            </p>
          )}
        </div>

        {/* 上屏的文案里不写 markdown：星号会原样显示给运营。 */}
        <p className="text-body-sm text-muted-foreground">
          这一屏不挡任何动作。产品能不能上线看「接入检查」，能不能发布套餐看「接入认证」。
        </p>
      </div>
    </Drawer>
  );
}
