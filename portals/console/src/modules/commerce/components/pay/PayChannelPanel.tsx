"use client";

/**
 * PayChannelPanel — 线下付款渠道面板(订阅单与加油包单共用,批 1)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 渠道切换 + 支付宝收款码 / 对公转账账户 + 「备注订单号」提示 + 渠道全关时的说明。
 * 此前订阅付款页与加油包付款页各写一份(52 行 vs 51 行同形 JSX、两套词条),
 * 渠道白名单还埋在视图里;现在渠道由服务端给什么就画什么,禁用项标「即将开放」。
 */

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  Banner,
  Card,
  Icon,
  DetailList,
  DetailRow,
  SegmentedControl,
} from "@vxture/design-system";
import type { PaymentChannelInfo } from "@/api/console-bff";

const CHANNEL_ORDER = ["balance", "bank_transfer", "alipay", "wechat"];

export type PayChannel = "balance" | "bank_transfer" | "alipay" | "wechat";

export function isPayChannel(value: string): value is PayChannel {
  return ["balance", "bank_transfer", "alipay", "wechat"].includes(value);
}

/** Choose an available channel in display order, skipping an empty wallet. */
export function defaultPayChannel(
  channels: readonly PaymentChannelInfo[],
): PayChannel {
  const first = [...channels]
    .sort(
      (a, b) =>
        CHANNEL_ORDER.indexOf(a.channel) - CHANNEL_ORDER.indexOf(b.channel),
    )
    .find(
      (c) =>
        c.enabled &&
        isPayChannel(c.channel) &&
        (c.channel !== "balance" || Number(c.balance) > 0),
    );
  return first && isPayChannel(first.channel) ? first.channel : "alipay";
}

/** Channel control can live in the section header or the shared panel. */
export function PayChannelSelector({
  channels,
  value,
  onChange,
  previewWechat = false,
}: {
  readonly channels: readonly PaymentChannelInfo[];
  readonly value: PayChannel;
  readonly onChange: (next: PayChannel) => void;
  readonly previewWechat?: boolean;
}) {
  const t = useTranslations("payChannels");
  return (
    <div className="max-w-full overflow-x-auto">
      <SegmentedControl<string>
        className="min-w-max"
        ariaLabel={t("title")}
        value={value}
        onChange={(next) => {
          if (isPayChannel(next)) onChange(next);
        }}
        items={[...channels]
          .sort(
            (a, b) =>
              CHANNEL_ORDER.indexOf(a.channel) -
              CHANNEL_ORDER.indexOf(b.channel),
          )
          .map((c) => ({
            value: c.channel,
            label: (
              <span className="whitespace-nowrap">
                {t(`channel.${c.channel}`)}
              </span>
            ),
            ariaLabel: `${t(`channel.${c.channel}`)}${
              c.enabled ? "" : ` · ${t("comingSoon")}`
            }`,
            disabled: !c.enabled && !(previewWechat && c.channel === "wechat"),
          }))}
      />
    </div>
  );
}

// ============================================================================
// Shared display frame
// ============================================================================

/** Keep every channel the same size while preserving the payment artwork. */
function PaymentDisplayCard({ children }: { readonly children: ReactNode }) {
  return (
    <Card
      data-slot="payment-display-card"
      surface="strong"
      className="mx-auto w-full max-w-overlay-xl shrink-0 gap-0 rounded-lg p-md shadow-raised"
    >
      <div className="relative h-80 w-full">
        <div className="absolute inset-0 flex min-h-0 flex-col items-center justify-center gap-md">
          {children}
        </div>
      </div>
    </Card>
  );
}

// ============================================================================
// Channel panel
// ============================================================================

export function PayChannelPanel({
  channels,
  value,
  onChange,
  orderNo,
  previewWechat = false,
  showSelector = true,
}: {
  readonly showSelector?: boolean;
  readonly channels: readonly PaymentChannelInfo[];
  readonly value: PayChannel;
  readonly onChange: (next: PayChannel) => void;
  /** 转账附言要带的订单号。 */
  readonly orderNo: string;
  /** Subscription checkout may preview the unavailable channel without submitting it. */
  readonly previewWechat?: boolean;
}) {
  const t = useTranslations("payChannels");
  const active = channels.find((c) => c.channel === value);
  const noneEnabled = channels.every((c) => !c.enabled);
  const showReference =
    active?.enabled &&
    ((value === "alipay" && Boolean(active.qrAsset)) ||
      (value === "bank_transfer" && Boolean(active.account)));

  return (
    <>
      {showSelector ? (
        <PayChannelSelector
          channels={channels}
          value={value}
          onChange={onChange}
          previewWechat={previewWechat}
        />
      ) : null}

      {value === "balance" ? (
        <PaymentDisplayCard>
          <Icon
            name="wallet"
            size="2xl"
            className="relative -top-xl size-media-lg shrink-0 text-primary-text"
          />
          <strong
            className="text-center text-heading-2 tabular-nums"
            aria-label={t("balanceAvailable", {
              amount: active?.balance ?? "0.00",
              currency: active?.currency ?? "CNY",
            })}
          >
            {active?.balance ?? "0.00"}
          </strong>
          <p className="text-center text-body-sm text-muted-foreground">
            <span className="block">{t("balanceNote")}</span>
          </p>
        </PaymentDisplayCard>
      ) : null}
      {value === "wechat" ? (
        <div className="flex flex-col items-center gap-md text-center">
          <PaymentDisplayCard>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/assets/payment/vx-wechat-placeholder.png"
              alt={t("wechatPlaceholder")}
              className="h-full min-h-0 w-full object-contain"
            />
          </PaymentDisplayCard>
          <p className="text-body-md text-muted-foreground">
            {t("wechatPlaceholder")}
          </p>
        </div>
      ) : null}
      {value === "alipay" && active?.enabled && active.qrAsset ? (
        <div className="flex flex-col items-center gap-md text-center">
          <PaymentDisplayCard>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={active.qrAsset}
              alt={t("alipayQrAlt")}
              className="h-full min-h-0 w-full object-contain"
            />
          </PaymentDisplayCard>
        </div>
      ) : null}

      {value === "bank_transfer" && active?.enabled ? (
        active.account ? (
          <PaymentDisplayCard>
            {/^(?:中国银行|Bank of China)$/i.test(
              active.account.bankName.trim(),
            ) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src="/assets/payment/bank-of-china.png"
                alt={active.account.bankName}
                className="relative -top-xl h-auto w-full max-w-overlay-md object-contain"
              />
            ) : (
              <Icon name="building-library" size="2xl" />
            )}
            <DetailList
              labelWidth="compact"
              className="w-full [&_dt]:w-media-sm [&_dt]:shrink-0"
            >
              <DetailRow
                label={t("bank.accountName")}
                className="flex-row items-center gap-sm"
              >
                <span className="break-words">
                  {active.account.accountName}
                </span>
              </DetailRow>
              <DetailRow
                label={t("bank.bankName")}
                className="flex-row items-center gap-sm"
              >
                {active.account.bankName}
              </DetailRow>
              <DetailRow
                label={t("bank.accountNo")}
                className="flex-row items-center gap-sm"
              >
                <span className="break-all font-mono tabular-nums">
                  {active.account.accountNo}
                </span>
              </DetailRow>
            </DetailList>
          </PaymentDisplayCard>
        ) : (
          <Banner tone="info" title={t("bank.unavailable")} />
        )
      ) : null}

      {value === "balance" || showReference ? (
        <p className="max-w-full break-all text-center text-body-md text-muted-foreground">
          {t(value === "balance" ? "relatedOrderNote" : "referenceNote", {
            orderNo,
          })}
        </p>
      ) : null}

      {noneEnabled ? (
        <p className="text-body-sm text-muted-foreground">{t("noneEnabled")}</p>
      ) : null}
    </>
  );
}
