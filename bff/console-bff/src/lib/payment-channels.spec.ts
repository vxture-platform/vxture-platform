/**
 * Payment channel availability and deterministic display order.
 * @package @vxture/bff-console
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-11
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPaymentChannels } from "./payment-channels";

afterEach(() => vi.unstubAllEnvs());
describe("offline payment channels", () => {
  it("places bank before Alipay and leaves WeChat unavailable", () => {
    vi.stubEnv("OFFLINE_PAY_ALIPAY_QR", " /qr.png ");
    vi.stubEnv("OFFLINE_PAY_ACCOUNT_NAME", " Company ");
    vi.stubEnv("OFFLINE_PAY_BANK_NAME", " Bank ");
    vi.stubEnv("OFFLINE_PAY_ACCOUNT_NO", " 123 ");
    expect(buildPaymentChannels("ORD-1")).toEqual([
      {
        channel: "bank_transfer",
        enabled: true,
        account: {
          accountName: "Company",
          bankName: "Bank",
          accountNo: "123",
          reference: "ORD-1",
        },
      },
      { channel: "alipay", enabled: true, qrAsset: "/qr.png" },
      { channel: "wechat", enabled: false },
    ]);
  });
  it("does not enable a bank with a blank account field", () => {
    vi.stubEnv("OFFLINE_PAY_ACCOUNT_NAME", " ");
    expect(buildPaymentChannels("ORD-1")[0]).toEqual({
      channel: "bank_transfer",
      enabled: false,
    });
  });
});
