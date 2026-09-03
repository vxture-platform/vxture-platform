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

import { useTranslations } from "next-intl";
import {
  Banner,
  DetailList,
  DetailRow,
  SegmentedControl,
} from "@vxture/design-system";
import type { PaymentChannelInfo } from "@/api/console-bff";

export type PayChannel = "alipay" | "bank_transfer";

export function isPayChannel(value: string): value is PayChannel {
  return value === "alipay" || value === "bank_transfer";
}

/** 默认渠道 = 服务端给的第一个可用渠道;都不可用时回落第一个。 */
export function defaultPayChannel(
  channels: readonly PaymentChannelInfo[],
): PayChannel {
  const first = channels.find((c) => c.enabled && isPayChannel(c.channel));
  return first && isPayChannel(first.channel) ? first.channel : "alipay";
}

export function PayChannelPanel({
  channels,
  value,
  onChange,
  orderNo,
}: {
  readonly channels: readonly PaymentChannelInfo[];
  readonly value: PayChannel;
  readonly onChange: (next: PayChannel) => void;
  /** 转账附言要带的订单号。 */
  readonly orderNo: string;
}) {
  const t = useTranslations("payChannels");
  const active = channels.find((c) => c.channel === value);
  const noneEnabled = channels.every((c) => !c.enabled);

  return (
    <>
      <SegmentedControl<string>
        ariaLabel={t("title")}
        value={value}
        onChange={(next) => {
          if (isPayChannel(next)) onChange(next);
        }}
        items={channels.map((c) => ({
          value: c.channel,
          label: `${t(`channel.${c.channel}`)}${
            c.enabled ? "" : ` · ${t("comingSoon")}`
          }`,
          disabled: !c.enabled,
        }))}
      />

      {value === "alipay" && active?.enabled && active.qrAsset ? (
        <div className="flex flex-wrap items-start gap-md">
          <div className="flex shrink-0 justify-center rounded-lg bg-accent p-md">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={active.qrAsset}
              alt={t("alipayQrAlt")}
              className="h-auto w-media-2xl max-w-full"
            />
          </div>
          <p className="min-w-0 flex-1 text-body-md text-muted-foreground">
            {t("referenceNote", { orderNo })}
          </p>
        </div>
      ) : null}

      {value === "bank_transfer" && active?.enabled ? (
        active.account ? (
          <>
            <DetailList>
              <DetailRow label={t("bank.accountName")}>
                {active.account.accountName}
              </DetailRow>
              <DetailRow label={t("bank.bankName")}>
                {active.account.bankName}
              </DetailRow>
              <DetailRow label={t("bank.accountNo")}>
                <span className="font-mono tabular-nums">
                  {active.account.accountNo}
                </span>
              </DetailRow>
              <DetailRow label={t("bank.reference")}>
                <span className="font-mono">{active.account.reference}</span>
              </DetailRow>
            </DetailList>
            <p className="text-body-sm text-muted-foreground">
              {t("referenceNote", { orderNo })}
            </p>
          </>
        ) : (
          <Banner tone="info" title={t("bank.unavailable")} />
        )
      ) : null}

      {noneEnabled ? (
        <p className="text-body-sm text-muted-foreground">{t("noneEnabled")}</p>
      ) : null}
    </>
  );
}
