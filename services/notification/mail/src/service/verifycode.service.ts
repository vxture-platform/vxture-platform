/**
 * Purpose-scoped email OTPs with atomic send budgets and single-use verification.
 * @package @vxture/service-mail
 * @layer Domain
 * @category service
 * @author AI-Generated
 * @date 2026-11-07
 */
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import { createHash, randomInt, randomUUID } from "node:crypto";
import type Redis from "ioredis";
import { REDIS_CLIENT } from "../constants/tokens";
import { MailService } from "./mail.service";

export type EmailCodePurpose = "customer-login";
const CODE_TTL = 600;

// ============================================================================
// Redis operations: reserve before delivery, activate after delivery, consume once
// ============================================================================
const RESERVE = `
local limits = {1, 5, 10}
local ttls = {60, 3600, 86400}
for i=1,3 do
  if tonumber(redis.call('GET', KEYS[i]) or '0') >= limits[i] then return 0 end
end
for i=1,3 do
  local n = redis.call('INCR', KEYS[i])
  if n == 1 then redis.call('EXPIRE', KEYS[i], ttls[i]) end
end
redis.call('HSET', KEYS[4], 'digest', ARGV[1], 'status', 'sending', 'tries', 0, 'owner', ARGV[3])
redis.call('EXPIRE', KEYS[4], ARGV[2])
return 1`;
const FINISH = `
if redis.call('HGET', KEYS[1], 'owner') ~= ARGV[1] then return 0 end
if ARGV[2] == 'ready' then
  redis.call('HSET', KEYS[1], 'status', 'ready')
  return 1
end
return redis.call('DEL', KEYS[1])`;
const CONSUME = `
if redis.call('HGET', KEYS[1], 'status') ~= 'ready' then return 0 end
if redis.call('HGET', KEYS[1], 'digest') == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
if redis.call('HINCRBY', KEYS[1], 'tries', 1) >= 5 then redis.call('DEL', KEYS[1]) end
return 0`;

// ============================================================================
// Service
// ============================================================================
@Injectable()
export class VerifyCodeService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(MailService) private readonly mailService: MailService,
  ) {}

  /**
   * Reserve shared address send limits before delivering a purpose-scoped OTP.
   * @param email - Target address.
   * @param purpose - Trusted server-selected purpose.
   * @returns Once delivery and activation succeed.
   * @throws {Error} On invalid input, throttling, Redis or delivery failure.
   */
  async sendCode(email: string, purpose: EmailCodePurpose): Promise<void> {
    const { address, codeKey, addressKey } = this.keys(email, purpose);
    const code = String(randomInt(0, 1000000)).padStart(6, "0");
    const digest = this.digest(purpose, address, code);
    const owner = randomUUID();
    const reserved = await this.redis.eval(
      RESERVE,
      4,
      `vc:v2:rl:1m:${addressKey}`,
      `vc:v2:rl:1h:${addressKey}`,
      `vc:v2:rl:1d:${addressKey}`,
      codeKey,
      digest,
      CODE_TTL,
      owner,
    );
    if (reserved !== 1)
      throw new HttpException(
        "发送过于频繁，请稍后重试",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    try {
      await this.mailService.sendVerifyCode(address, code);
      if ((await this.redis.eval(FINISH, 1, codeKey, owner, "ready")) !== 1)
        throw new Error("email_code_delivery_expired");
    } catch (error) {
      await this.redis.eval(FINISH, 1, codeKey, owner, "failed");
      throw error;
    }
  }

  /**
   * Consume the matching OTP atomically; five failed guesses invalidate it.
   * @param email - Address used for delivery.
   * @param code - Submitted six-digit code.
   * @param purpose - Trusted server-selected purpose.
   * @returns Whether this request alone consumed a valid OTP.
   * @throws {Error} On invalid purpose/address or Redis failure.
   */
  async verifyCode(
    email: string,
    code: string,
    purpose: EmailCodePurpose,
  ): Promise<boolean> {
    const { address, codeKey } = this.keys(email, purpose);
    if (typeof code !== "string" || !/^\d{6}$/.test(code.trim())) return false;
    return (
      (await this.redis.eval(
        CONSUME,
        1,
        codeKey,
        this.digest(purpose, address, code.trim()),
      )) === 1
    );
  }

  private keys(email: string, purpose: EmailCodePurpose) {
    if (purpose !== "customer-login")
      throw new BadRequestException("invalid_email_code_purpose");
    if (typeof email !== "string")
      throw new BadRequestException("invalid_email");
    const address = email.trim().toLowerCase();
    if (address.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
      throw new BadRequestException("invalid_email");
    const addressKey = createHash("sha256").update(address).digest("hex");
    return {
      address,
      addressKey,
      codeKey: `vc:v2:code:${purpose}:${addressKey}`,
    };
  }

  private digest(purpose: string, address: string, code: string): string {
    return createHash("sha256")
      .update(`${purpose}:${address}:${code}`)
      .digest("hex");
  }
}
