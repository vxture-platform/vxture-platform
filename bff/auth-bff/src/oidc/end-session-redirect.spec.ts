import { describe, expect, it, vi } from "vitest";
import { OidcService } from "./oidc.service";

/**
 * 登出后的回跳白名单（owner 2026-09-10 走查：会话到期后停在 accounts/logout）。
 *
 * ── 断在哪 ──
 * 回跳地址原本**只**对着「这个会话发过令牌的 client」校验，而那份名单存在会话上：
 *
 *     闲置钟到点 → website-bff 销毁本地 RP 会话 → 跳 IdP end_session
 *       IdP: getOidcSession(sid) → null（中央会话也过期了）
 *            sessionClients      → []
 *            isRegisteredPostLogout(uri, []) → 循环一次都不进 → false
 *       → endSession 返回 null → 路由兜底 `${issuer}/logout`
 *
 * 于是**「会话还在时登出」能回官网，「会话过期后登出」反而回不去**——恰好反了。
 * 修法：RP 一律带上 `client_id`（RP-Initiated Logout 1.0 允许），校验时并进名单。
 *
 * 这一组的两条互为对照：光有第一条的话，一个「不校验、直接回跳」的实现同样能过，
 * 而那是开放重定向。
 */
function build(registered: string[]) {
  const clients = {
    findEnabledByClientId: vi.fn(async (id: string) =>
      id === "website" ? { postLogoutRedirectUris: registered } : null,
    ),
  };
  const service = Object.create(OidcService.prototype) as OidcService;
  Object.assign(service, {
    clients,
    redis: {
      /* 会话已过期:两个读都给空——这正是走查那一幕。 */
      getOidcSession: vi.fn(async () => null),
      getOidcSessionClients: vi.fn(async () => []),
      deleteOidcSession: vi.fn(async () => undefined),
    },
    token: { revokeSession: vi.fn(async () => undefined) },
    durableSession: { revoke: vi.fn(async () => undefined) },
    logger: { warn: vi.fn() },
  });
  return { service, clients };
}

describe("end_session 回跳:会话已过期时", () => {
  it("带 client_id + 地址已注册 → 照常回跳(不再把人扔在 IdP 侧)", async () => {
    const { service } = build(["https://vxture.com/"]);
    const target = await service.endSession(
      ["sid-已过期"],
      "https://vxture.com/",
      undefined,
      "website",
    );
    expect(target).toBe("https://vxture.com/");
  });

  /**
   * 反向对照:白名单**仍然在挡**。
   *
   * 自称 website 不等于能回跳到任何地方——能回哪儿由那个 client 在库里登记的
   * post_logout_redirect_uris 决定。少了这一条,上面那条就只证明了「会回跳」,
   * 而一个开放重定向同样满足它。
   */
  it("带 client_id 但地址没注册 → 仍然拒绝(不是开放重定向)", async () => {
    const { service } = build(["https://vxture.com/"]);
    const target = await service.endSession(
      ["sid-已过期"],
      "https://evil.example.com/",
      undefined,
      "website",
    );
    expect(target).toBeNull();
  });

  /* 不带 client_id 时维持原状:没有任何依据可比,拒绝。
     这条钉的是「修法没有顺手把校验放宽」——它只多给了一个依据,没少一道门。 */
  it("不带 client_id 且会话已过期 → 仍然拒绝", async () => {
    const { service } = build(["https://vxture.com/"]);
    const target = await service.endSession(
      ["sid-已过期"],
      "https://vxture.com/",
    );
    expect(target).toBeNull();
  });

  it("认不出的 client_id → 拒绝(findEnabledByClientId 给 null)", async () => {
    const { service } = build(["https://vxture.com/"]);
    const target = await service.endSession(
      ["sid-已过期"],
      "https://vxture.com/",
      undefined,
      "不存在的客户端",
    );
    expect(target).toBeNull();
  });
});
