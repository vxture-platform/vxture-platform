/**
 * Realm-scoped Aliyun captcha orchestration and local single-use proofs.
 * @package @vxture/bff-auth
 * @layer Application
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
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
// ⚠️ Cross-layer import: generic provider verification belongs to authentication infrastructure.
import { AliyunCaptchaError, AliyunCaptchaVerifier } from "@vxture/core-auth";
import { RedisService } from "../redis/redis.service";

type Realm = "customer" | "workforce";
type PublicConfig =
  | { enabled: false }
  | { enabled: true; sceneId: string; prefix: string; region: "cn" | "sgp" };

@Injectable()
export class HumanCaptchaService {
  private readonly logger = new Logger(HumanCaptchaService.name);
  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  /** Return only public widget configuration; missing config never disables production protection. */
  config(realm: Realm): PublicConfig {
    const enabled = process.env.ALIYUN_CAPTCHA_ENABLED?.trim().toLowerCase();
    if (enabled === "false" && process.env.NODE_ENV !== "production")
      return { enabled: false };
    const customer = process.env.ALIYUN_CAPTCHA_CUSTOMER_SCENE_ID?.trim();
    const workforce = process.env.ALIYUN_CAPTCHA_WORKFORCE_SCENE_ID?.trim();
    const prefix = process.env.ALIYUN_CAPTCHA_PREFIX?.trim();
    const region = process.env.ALIYUN_CAPTCHA_REGION?.trim() ?? "cn";
    if (
      enabled !== "true" ||
      !customer ||
      !workforce ||
      customer === workforce ||
      !prefix ||
      !["cn", "sgp"].includes(region) ||
      !process.env.ALIYUN_CAPTCHA_ACCESS_KEY_ID?.trim() ||
      !process.env.ALIYUN_CAPTCHA_ACCESS_KEY_SECRET?.trim()
    ) {
      throw new ServiceUnavailableException("human_verification_unavailable");
    }
    return {
      enabled: true,
      sceneId: realm === "customer" ? customer : workforce,
      prefix,
      region: region as "cn" | "sgp",
    };
  }

  /**
   * Verify a server-selected scene and mint a two-minute opaque proof.
   * @throws {Error} On invalid input, throttling, store failure or provider rejection.
   */
  async verify(
    realm: Realm,
    param: unknown,
    ip: string,
  ): Promise<{ token: string; expiresIn: number }> {
    const config = this.config(realm);
    if (!config.enabled)
      throw new BadRequestException("human_verification_disabled");
    if (!(await this.redis.reserveCaptchaVerification(ip)))
      throw new HttpException(
        "too_many_attempts",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    let id: string;
    try {
      id = AliyunCaptchaVerifier.identify(param, config.sceneId);
    } catch {
      throw new UnauthorizedException("human_verification_failed");
    }
    if (!(await this.redis.reserveCaptchaCeremony(config.sceneId, id)))
      throw new UnauthorizedException("human_verification_failed");
    try {
      await new AliyunCaptchaVerifier({
        accessKeyId: process.env.ALIYUN_CAPTCHA_ACCESS_KEY_ID!,
        accessKeySecret: process.env.ALIYUN_CAPTCHA_ACCESS_KEY_SECRET!,
        region: config.region,
      }).verify(param as string, config.sceneId);
    } catch (error) {
      const reason =
        error instanceof AliyunCaptchaError ? error.reason : "unexpected";
      // Never include provider messages, SDK parameters, credentials or proofs in logs.
      this.logger.warn(
        `captcha_verification_failed realm=${realm} reason=${reason}`,
      );
      if (reason === "provider-unavailable" || reason === "configuration")
        throw new ServiceUnavailableException("human_verification_unavailable");
      throw new UnauthorizedException("human_verification_failed");
    }
    const token = randomUUID();
    await this.redis.storeCaptchaProof(token, realm);
    return { token, expiresIn: 120 };
  }

  /** Consume a proof only for the caller's server-selected realm. */
  async consume(realm: Realm, token: unknown): Promise<void> {
    if (!this.config(realm).enabled) return;
    if (
      typeof token !== "string" ||
      !/^[0-9a-f-]{36}$/.test(token) ||
      !(await this.redis.consumeCaptchaProof(token, realm))
    )
      throw new UnauthorizedException("human_verification_failed");
  }
}
