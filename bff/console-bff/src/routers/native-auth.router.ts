/**
 * native-auth.router.ts - 原生客户端（桌面端）的会话领取。
 * @package @vxture/bff-console
 * @layer Application
 * @category Router
 *
 * ── 这一层解决什么 ──
 * 桌面端（ruyin）是 RFC 8252 公共客户端：它<b>持不住密钥</b>，所以不能自己向平台
 * 证明「我是谁」，也就不能铸 S2S 票（`oidc.service.ts` 的那条禁令写了理由，本模块
 * 不绕过它）。而它又必须能读本工作区的订阅与能力。
 *
 * 答案与浏览器完全相同：**公共客户端从不持令牌，机密后端替它持**。浏览器拿的是一个
 * 不透明的 `rpsid`，令牌留在服务端（`auth.middleware.ts` 的注释：tokens stay
 * server-side）。桌面端拿同一个 `rpsid`，走同一条中间件、同一批路由。
 *
 * ── 秘密为什么不穿过浏览器 ──
 * 常见做法是让浏览器回跳 `http://127.0.0.1:<port>/cb?code=…`，应用监听 loopback 收码。
 * 那条码会进浏览器历史、可能进日志、本机其他程序在某些平台上看得见；而且回跳白名单
 * 要为此放开一类 `127.0.0.1:*`。自定义协议（`ruyin://`）更糟——RFC 8252 自己点名：
 * **同一台机器上任何程序都能注册同一个协议**然后截走回调。
 *
 * 所以这里反过来：**秘密由桌面端生成，只把它的哈希送出去**。
 *
 *   ① 桌面端生成 `deviceSecret`（高熵），算 `handle = sha256(deviceSecret)`
 *   ② 打开系统浏览器到 `/auth/login?surface=native&handle=<handle>`
 *   ③ 用户正常登录；回调建会话时把 `rpsid` 绑到 `handle` 上，浏览器停在一个
 *      「可以回到应用了」的页面——**浏览器全程没拿到任何可用凭据**
 *   ④ 桌面端直接 HTTPS 轮询本模块的 `claim`，出示 `deviceSecret` 原文换回 `rpsid`
 *
 * `deviceSecret` 只在桌面端与平台之间走过 TLS，从未进过 URL、浏览器或操作系统。
 * 浏览器那一侧只完成「批准了这个 handle」，而批准本身换不到会话。
 *
 * 这是 RFC 8628 设备授权的结构，省掉了让用户手输 user code 那一步——同一台机器上
 * 我们能直接把浏览器开起来。
 *
 * @author AI-Generated
 * @date 2026-09-12
 */

import {
  BadRequestException,
  Controller,
  Inject,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from "@nestjs/common";
import type Redis from "ioredis";
import { createHash } from "node:crypto";
import { Public } from "../auth/capability";
import { RP_REDIS, RP_RUNTIME, type RpRuntime } from "../oidc/oidc-rp.tokens";

// ============================================================================
// Constants
// ============================================================================

/**
 * 待领会话的存活时间。
 *
 * 覆盖「打开浏览器 → 用户看清楚 → 输密码/过 MFA → 回来」这一段。5 分钟够用；
 * 更长没有价值——桌面端在轮询，领到就删，领不到说明用户放弃了。
 */
export const NATIVE_PENDING_TTL_SEC = 300;

/** `handle` 是 sha256 十六进制：64 个 hex 字符，长度与字符集都固定。 */
const HANDLE_RE = /^[0-9a-f]{64}$/;

/**
 * `deviceSecret` 的最短长度。
 *
 * 桌面端应当给 32 字节随机数的 hex（64 字符）。这里只挡住明显过短的——真正的强度
 * 由桌面端负责，平台无法验证一个它没见过生成过程的值有多随机。挡短是为了让
 * 「实现方偷懒用了一个短串」在接入当天就报错，而不是变成一条没人发现的弱路径。
 */
const MIN_SECRET_LEN = 32;

// ============================================================================
// Key helpers
// ============================================================================

/**
 * 待领绑定的 Redis 键。**按 handle 索引，不按 deviceSecret**。
 *
 * 平台永远不存 `deviceSecret`：它只在 claim 那一刻被算一次哈希、比对、丢弃。
 * 这样即使 Redis 被读走，里面也没有任何能直接换会话的东西——攻击者拿到的是
 * `handle`（哈希）与 `rpsid`，而 `rpsid` 本来就受会话 TTL 与吊销约束。
 */
export function nativePendingKey(prefix: string, handle: string): string {
  return `${prefix}rp:console:native:${handle}`;
}

// ============================================================================
// Types
// ============================================================================

/** 待领绑定的值。 */
export interface NativePending {
  /** 已建立的会话号。 */
  rpsid: string;
  /** 建立时刻（epoch 毫秒），只用于诊断。 */
  createdAt: number;
}

interface ClaimBody {
  deviceSecret?: string;
}

// ============================================================================
// Router
// ============================================================================

@Public()
@Controller("auth/native")
export class NativeAuthRouter {
  constructor(
    @Inject(RP_REDIS) private readonly redis: Redis,
    @Inject(RP_RUNTIME) private readonly rt: RpRuntime,
  ) {}

  /**
   * 领取会话：出示 `deviceSecret` 原文，换回 `rpsid`。
   *
   * 桌面端在打开浏览器之后轮询这个端点。未登录完成时回 404（**不是** 401——401 会
   * 让调用方以为凭据错了，而这里的语义是「还没好，再等等」）。
   *
   * **一次性**：领到即删。重放同一个 `deviceSecret` 得到 404。
   *
   * @throws {BadRequestException} deviceSecret 缺失或过短
   */
  @Post("claim")
  @HttpCode(HttpStatus.OK)
  async claim(
    @Body() body: ClaimBody,
  ): Promise<{ rpsid: string; expiresInSec: number } | never> {
    const secret = (body.deviceSecret ?? "").trim();
    if (secret.length < MIN_SECRET_LEN) {
      throw new BadRequestException({
        code: "NATIVE_SECRET_TOO_SHORT",
        message: `deviceSecret must be at least ${MIN_SECRET_LEN} characters`,
        retryable: false,
      });
    }
    const handle = createHash("sha256").update(secret).digest("hex");
    /* `getdel`：领取与删除是同一次往返，两个桌面端同时轮询同一个 secret 时
       只有一个能拿到。分成 get + del 会开一个双领窗口。 */
    const raw = await this.redis.getdel(
      nativePendingKey(this.rt.keyPrefix, handle),
    );
    if (!raw) {
      /* 404 而不是 400：语义是「还没好」，不是「你传错了」。也不是 401——
         401 会让调用方以为凭据不对而停止重试，而这里正确的反应是继续轮询。 */
      throw new NotFoundException({
        code: "NATIVE_NOT_READY",
        message: "no session pending for this device",
        retryable: true,
      });
    }
    const pending = JSON.parse(raw) as NativePending;
    return {
      rpsid: pending.rpsid,
      expiresInSec: this.rt.config.sessionTtlSec,
    };
  }
}

// ============================================================================
// Binding helper (called from the OIDC callback)
// ============================================================================

/**
 * 把刚建立的会话绑到 handle 上，供桌面端领取。
 *
 * 由 `/auth/callback` 在 `surface=native` 时调用。**不在本 router 里做**是因为
 * 会话是在回调里建的——把绑定动作留在会话创建现场，就不会出现「会话建好了但没绑」
 * 或者「绑了一个还不存在的 rpsid」。
 *
 * @param handle - 桌面端给的 sha256 十六进制；形状不合法直接不绑（静默，见下）
 * @returns 绑上了没有。调用方据此决定回跳到哪个页面
 */
export async function bindNativePending(
  redis: Redis,
  keyPrefix: string,
  handle: string,
  rpsid: string,
): Promise<boolean> {
  if (!HANDLE_RE.test(handle)) return false;
  const value: NativePending = { rpsid, createdAt: Date.now() };
  await redis.setex(
    nativePendingKey(keyPrefix, handle),
    NATIVE_PENDING_TTL_SEC,
    JSON.stringify(value),
  );
  return true;
}
