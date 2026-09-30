/**
 * oidc-client-back-channel-logout.spec.ts —— 后端通道登出这一对字段的入口校验。
 *
 * 为什么单独一份：库上有 `chk_oidc_clients_bclo_uri`
 * （`slo_participation <> 'back_channel' OR back_channel_logout_uri IS NOT NULL`）兜底，
 * 但它冒出来是一条看不懂的约束名 + 500。这里钉的是**入口给的是字段级 400**，
 * 以及那两条只有库才知道的不变式在入口也成立。
 *
 * 背景（2026-09-30，owner 裁定）：这两列此前**库里有、IdP 在读、没有任何地方能填**，
 * 通则里「运营台目前登记不了…找平台运维补登记」就是这个洞。
 */
import { describe, expect, it } from "vitest";
import { validateClientInput } from "./oidc-client.router";

const OK = {
  clientId: "acme",
  redirectUris: ["https://acme.vxture.com/api/auth/oidc/callback"],
};

/** 取抛出来的字段级 400 的 `field`，拿不到就返回它本来的样子好让断言说人话。 */
function fieldOfThrown(fn: () => void): string {
  try {
    fn();
  } catch (e) {
    const anyE = e as { field?: string; response?: { field?: string } };
    return anyE.field ?? anyE.response?.field ?? JSON.stringify(e);
  }
  return "(did not throw)";
}

describe("validateClientInput · 后端通道登出", () => {
  it("两个都不给：过（绝大多数产品不参与全域登出）", () => {
    expect(() =>
      validateClientInput({ ...OK }, { creating: true }),
    ).not.toThrow();
  });

  it("给地址、不给参与方式：过（= 登记好了先不启用）", () => {
    expect(() =>
      validateClientInput(
        {
          ...OK,
          backChannelLogoutUri:
            "https://acme.vxture.com/auth/backchannel-logout",
        },
        { creating: true },
      ),
    ).not.toThrow();
  });

  it("地址 + back_channel：过", () => {
    expect(() =>
      validateClientInput(
        {
          ...OK,
          backChannelLogoutUri:
            "https://acme.vxture.com/auth/backchannel-logout",
          sloParticipation: "back_channel",
        },
        { creating: true },
      ),
    ).not.toThrow();
  });

  /** 这一条是库上 CHECK 的入口镜像——它冒到库里就是 500。 */
  it("选了 back_channel 却没给地址：400，指到地址那一栏", () => {
    expect(
      fieldOfThrown(() =>
        validateClientInput(
          { ...OK, sloParticipation: "back_channel" },
          { creating: true },
        ),
      ),
    ).toBe("backChannelLogoutUri");
  });

  it("地址是空白串也算没给", () => {
    expect(
      fieldOfThrown(() =>
        validateClientInput(
          {
            ...OK,
            backChannelLogoutUri: "   ",
            sloParticipation: "back_channel",
          },
          { creating: true },
        ),
      ),
    ).toBe("backChannelLogoutUri");
  });

  it("地址解析不了：400", () => {
    expect(
      fieldOfThrown(() =>
        validateClientInput(
          { ...OK, backChannelLogoutUri: "not a url" },
          { creating: true },
        ),
      ),
    ).toBe("backChannelLogoutUri");
  });

  /**
   * 公共客户端（RFC 8252）没有服务端能接这个 POST：回调是 loopback 或自定义 scheme，
   * IdP 从平台侧打不到它。seed 也刻意不给 ruyin 派 back-channel 端点。
   */
  it("公共客户端填了地址：400", () => {
    expect(
      fieldOfThrown(() =>
        validateClientInput(
          {
            ...OK,
            redirectUris: ["http://127.0.0.1:7777/cb"],
            tokenEndpointAuthMethod: "none",
            backChannelLogoutUri:
              "https://acme.vxture.com/auth/backchannel-logout",
          },
          { creating: true },
        ),
      ),
    ).toBe("backChannelLogoutUri");
  });

  /**
   * `front_channel` 在库的 CHECK 值域里，但**全仓没有实现它的地方**。
   * 登记面不开放它——一个选了什么都不会发生的选项比灰掉更糟。
   */
  it("front_channel：400（库里有这一档，我们没实现）", () => {
    expect(
      fieldOfThrown(() =>
        validateClientInput(
          {
            ...OK,
            // 越过 TS 的值域去打运行时那道门：真实请求体是 JSON，什么都能送。
            sloParticipation: "front_channel" as unknown as "back_channel",
          },
          { creating: true },
        ),
      ),
    ).toBe("sloParticipation");
  });
});
