/**
 * Checkout channel order, defaults and unavailable channel preview.
 * @package @vxture/console
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-11
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/zh-CN.json";
import { defaultPayChannel, PayChannelPanel } from "./PayChannelPanel";
import type { PaymentChannelInfo } from "@/api/console-bff";

vi.mock("../../../../../public/assets/payment/vx-alipay.png", () => ({
  default: { src: "/_next/static/media/vx-alipay.content-hash.png" },
}));

const channels: PaymentChannelInfo[] = [
  { channel: "wechat", enabled: false },
  { channel: "alipay", enabled: true, qrAsset: "/qr.png" },
  { channel: "balance", enabled: true, balance: "12.00", currency: "CNY" },
  {
    channel: "bank_transfer",
    enabled: true,
    account: {
      accountName: "Example Company",
      bankName: "Example Bank",
      accountNo: "1234567890123456",
      reference: "ORD-1",
    },
  },
];
function markup(
  value: "balance" | "bank_transfer" | "alipay" | "wechat",
  showSelector = true,
) {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale="zh-CN"
      timeZone="Asia/Shanghai"
      messages={messages}
    >
      <PayChannelPanel
        channels={channels}
        showSelector={showSelector}
        value={value}
        onChange={() => {}}
        orderNo="ORD-1"
        previewWechat
      />
    </NextIntlClientProvider>,
  );
}
describe("payment channel panel", () => {
  it("uses a content-versioned URL for the bundled QR, preserving custom QR URLs", () => {
    const localChannels = channels.map((channel) =>
      channel.channel === "alipay"
        ? { ...channel, qrAsset: "/assets/payment/vx-alipay.png" }
        : channel,
    );
    const html = renderToStaticMarkup(
      <NextIntlClientProvider
        locale="zh-CN"
        timeZone="Asia/Shanghai"
        messages={messages}
      >
        <PayChannelPanel
          channels={localChannels}
          value="alipay"
          onChange={() => {}}
          orderNo="ORD-1"
        />
      </NextIntlClientProvider>,
    );
    expect(html).toContain("/_next/static/media/vx-alipay.content-hash.png");
    expect(markup("alipay")).toContain('src="/qr.png"');
  });
  it("shows the balance as a large number with a complete accessible label", () => {
    const html = markup("balance");
    expect(html).toContain("关联订单：ORD-1");
    expect(html).toMatch(
      /<strong[^>]*text-heading-2[^>]*aria-label="可用余额：12.00 CNY"[^>]*>12.00<\/strong>/,
    );
  });
  it("keeps the payment display when its channel selector moves to the header", () => {
    const html = markup("alipay", false);
    expect(html).not.toContain('role="radiogroup"');
    expect(html).toContain('src="/qr.png"');
    expect(html).toContain("转账备注：");
  });
  it("defaults to a funded wallet, then bank when the wallet is empty", () => {
    expect(defaultPayChannel(channels)).toBe("balance");
    expect(
      defaultPayChannel(
        channels.map((c) =>
          c.channel === "balance" ? { ...c, balance: "0.00" } : c,
        ),
      ),
    ).toBe("bank_transfer");
  });
  it("renders balance, bank, Alipay and WeChat in the requested order", () => {
    const html = markup("balance");
    const labels = ["账户余额", "银行转账", "支付宝", "微信支付"];
    const positions = labels.map((s) => html.indexOf(s));
    expect(positions.every((n) => n >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
  it("centers the Alipay QR and places a short reference below it", () => {
    const html = markup("alipay");
    expect(html).toContain("items-center gap-md text-center");
    expect(html.indexOf('src="/qr.png"')).toBeLessThan(
      html.indexOf("转账备注："),
    );
    expect(html).toContain("ORD-1");
  });
  it("shows bank details with one shared order reference", () => {
    const html = markup("bank_transfer");
    expect(html).toContain("Example Company");
    expect(html).toContain("Example Bank");
    expect(html).toContain("1234567890123456");
    expect(html.match(/ORD-1/g)).toHaveLength(1);
    expect(html).not.toContain("转账附言");
  });
  it("shows WeChat as a placeholder without a real payment code", () => {
    const html = markup("wechat");
    expect(html).toContain(messages.payChannels.wechatPlaceholder);
    expect(html).toContain('src="/assets/payment/vx-wechat-placeholder.png"');
    expect(html).not.toContain('src="/qr.png"');
    expect(html).toContain('aria-label="微信支付 · 即将开放"');
  });
});
