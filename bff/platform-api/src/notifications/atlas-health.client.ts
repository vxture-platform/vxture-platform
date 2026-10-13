/**
 * atlas-health.client.ts — #562：platform-api 读 Atlas 健康的 S2S 客户端。
 *
 * 两步：① 用 platform-api 自己的机密客户端凭据，经 token-exchange 的 health-reader
 * grant 铸一张 workspace-less 的 `health:atlas` 票（无 subject_token、无 workspace_id）；
 * ② 持票 GET `${ATLAS_API_URL}/s2s/health`，拿回 `ServiceHealthView`。
 *
 * 失败就抛（不静默兜底）：拿不到票、Atlas 非 200、连不上，都抛给调用方
 * （`ModelHealthWatchJob.pass()`），于是作业心跳记 failed、job-health-alert 再发一条
 * 「监测自己停了」——监测瞎了必须有声音，不能假装健康。
 *
 * 未配 secret（OIDC_CLIENT_SECRET 为空）时不抛、返回 null：这是「还没 provision」的
 * 正常中间态，由作业那侧记一条 log 跳过，不把启动拖垮（同 token-exchange 的「空 = 休眠」）。
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { VxConfigService } from "@vxture/core-config";

import type { ServiceHealthView } from "./model-health-notice";

const TOKEN_EXCHANGE_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:token-exchange";
/** 票 TTL 300s，缓存压到 240s，绝不转发过期票。 */
const TOKEN_CACHE_TTL_MS = 240_000;
/** 读健康的 HTTP 超时：监测不该为一次慢响应把作业挂住。 */
const HEALTH_FETCH_TIMEOUT_MS = 10_000;

@Injectable()
export class AtlasHealthClient {
  private readonly logger = new Logger(AtlasHealthClient.name);
  private cached: { token: string; expiresAtMs: number } | undefined;

  constructor(
    @Inject(VxConfigService) private readonly config: VxConfigService,
  ) {}

  /** 未配 secret = 监测休眠。调用方据此跳过本轮（不报错）。 */
  isConfigured(): boolean {
    return Boolean(this.config.platform.OIDC_CLIENT_SECRET);
  }

  /** 铸 `health:atlas` 票，缓存到期前复用。拿不到抛。 */
  private async mintToken(): Promise<string> {
    if (this.cached && this.cached.expiresAtMs > Date.now()) {
      return this.cached.token;
    }
    const authBase = this.config.platform.AUTH_BFF_URL.replace(/\/+$/, "");
    const params = new URLSearchParams({
      grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
      client_id: this.config.platform.OIDC_CLIENT_ID,
      client_secret: this.config.platform.OIDC_CLIENT_SECRET,
      audience: "atlas",
      // 故意不带 workspace_id / org_id：健康票无租户上下文（health-reader grant
      // 对带了的直接 invalid_request）。
    });
    const res = await fetch(`${authBase}/oidc/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!res.ok) {
      throw new Error(
        `health-reader token exchange rejected (status=${res.status})`,
      );
    }
    const body = (await res.json()) as { access_token?: string };
    if (!body.access_token) {
      throw new Error("health-reader token exchange returned no access_token");
    }
    this.cached = {
      token: body.access_token,
      expiresAtMs: Date.now() + TOKEN_CACHE_TTL_MS,
    };
    return body.access_token;
  }

  /** 读一份健康快照。未配 secret 返回 null；其余失败抛。 */
  async getHealth(): Promise<ServiceHealthView | null> {
    if (!this.isConfigured()) {
      this.logger.warn(
        "模型健康监测未配 OIDC_CLIENT_SECRET —— 本轮跳过（provision 后自动生效）。",
      );
      return null;
    }
    const token = await this.mintToken();
    const base = this.config.platform.ATLAS_API_URL.replace(/\/+$/, "");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), HEALTH_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${base}/s2s/health`, {
        headers: { authorization: `Bearer ${token}` },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401) {
      // 票被拒：别用过期缓存继续撞，清掉，让下一轮重铸。
      this.cached = undefined;
      throw new Error("Atlas /s2s/health rejected the health token (401)");
    }
    if (!res.ok) {
      throw new Error(`Atlas /s2s/health returned status ${res.status}`);
    }
    return (await res.json()) as ServiceHealthView;
  }
}
