/**
 * back-channel-logout-participation.spec.ts —— `slo_participation` 是判据，不再是声明。
 *
 * ── 为什么这三条值得钉住 ──
 * 2026-09-30 之前 `sendBackChannelLogouts` **只看 `backChannelLogoutUri` 非空**，
 * 于是 `slo_participation` 全仓零读者——而通则里「新登记的客户端
 * slo_participation=none，收不到后台登出」引用的正是这个不存在的判据：照它去请
 * 运维改那一列的人，什么也改不到。owner 2026-09-30 裁定让 IdP 真的读它。
 *
 * 加判据的代价是**存量必须先补齐**：实测 dev 库 13 个客户端全是 `'none'`，其中 11 个
 * URI 非空、今天确实在收。少了迁移 `2026-11-27`，这一行就是一次谁都不会报错的
 * 全站回归——所以第三条钉的是「跳过时留了一条 warn」，那是唯一能让它现形的东西。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OidcService } from "./oidc.service";

type Client = {
  clientId: string;
  backChannelLogoutUri: string | null;
  sloParticipation: "none" | "back_channel" | "front_channel";
};

function build(clientsById: Record<string, Client>) {
  const warn = vi.fn();
  const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const service = Object.create(OidcService.prototype) as OidcService;
  Object.assign(service, {
    clients: {
      findEnabledByClientId: vi.fn(
        async (id: string) => clientsById[id] ?? null,
      ),
    },
    keys: { sign: vi.fn(() => "signed.logout.token") },
    logger: { warn },
  });
  /* 私有方法：行为就住在它里面，而它的两个公开入口（endSession /
     endOperatorSessions）各自还要一整套 redis + token 的替身。钉行为不钉门面。 */
  const send = (
    service as unknown as {
      sendBackChannelLogouts: (
        sid: string,
        sub: string,
        clientIds: string[],
      ) => Promise<void>;
    }
  ).sendBackChannelLogouts.bind(service);
  return { send, fetchMock, warn };
}

describe("sendBackChannelLogouts · 参与方式", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("back_channel + 有地址 ⇒ 投递", async () => {
    const { send, fetchMock } = build({
      console: {
        clientId: "console",
        backChannelLogoutUri: "https://console.example/auth/backchannel-logout",
        sloParticipation: "back_channel",
      },
    });
    await send("sid-1", "usr_1", ["console"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { body: string },
    ];
    expect(url).toBe("https://console.example/auth/backchannel-logout");
    expect(init.body).toContain("logout_token=");
  });

  /** 这一条是本次改动的全部意义：有地址 ≠ 参与。 */
  it("有地址但 none ⇒ 不投递，并留一条 warn", async () => {
    const { send, fetchMock, warn } = build({
      console: {
        clientId: "console",
        backChannelLogoutUri: "https://console.example/auth/backchannel-logout",
        sloParticipation: "none",
      },
    });
    await send("sid-1", "usr_1", ["console"]);
    expect(fetchMock).not.toHaveBeenCalled();
    /* warn 不是装饰:唯一能把「迁移没跑到」这件事变可见的东西就是它。
       丢了它，全站停收登出通知而日志里一个字都没有。 */
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("slo_participation=none");
  });

  it("没有地址 ⇒ 不投递，也不 warn（这是正常状态，不是异常）", async () => {
    const { send, fetchMock, warn } = build({
      ruyin: {
        clientId: "ruyin",
        backChannelLogoutUri: null,
        sloParticipation: "none",
      },
    });
    await send("sid-1", "usr_1", ["ruyin"]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("多个客户端 ⇒ 只投递参与的那些，不因为一个不参与就整批停", async () => {
    const { send, fetchMock, warn } = build({
      console: {
        clientId: "console",
        backChannelLogoutUri: "https://console.example/auth/backchannel-logout",
        sloParticipation: "back_channel",
      },
      admin: {
        clientId: "admin",
        backChannelLogoutUri: "https://admin.example/auth/backchannel-logout",
        sloParticipation: "none",
      },
      ruyin: {
        clientId: "ruyin",
        backChannelLogoutUri: null,
        sloParticipation: "none",
      },
    });
    await send("sid-1", "usr_1", ["console", "admin", "ruyin"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("front_channel ⇒ 不走后端通道（库里有这一档，我们没实现它）", async () => {
    const { send, fetchMock, warn } = build({
      x: {
        clientId: "x",
        backChannelLogoutUri: "https://x.example/auth/backchannel-logout",
        sloParticipation: "front_channel",
      },
    });
    await send("sid-1", "usr_1", ["x"]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
