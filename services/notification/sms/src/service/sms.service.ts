/**
 * sms.service.ts - 阿里云号码认证服务（PNVS / Dypnsapi）短信验证码
 * @package @vxture/service-sms
 * @description
 *   封装阿里云「号码认证服务」的短信验证码托管能力，目标是手机号登录：
 *     - SendSmsVerifyCode  发码：阿里云生成并存储验证码（模板用 ##code## 占位），
 *                          内置同号频控（Interval，默认 60s）与有效期（ValidTime）。
 *     - CheckSmsVerifyCode 校验：阿里云服务端校验，Model.VerifyResult === "PASS" 通过。
 *   平台不再自行生成 / 存储 / 比对验证码（旧的 Redis 验证码逻辑已下线）。
 *   未配置凭据时降级为控制台输出 + 固定开发验证码 DEV_CODE，便于本地与自动化联调。
 *   Fail-closed in production: when NODE_ENV=production and credentials are
 *   missing, sending throws and verification rejects every code — the public
 *   dev code must never authenticate anyone in production.
 *
 *   端点 dypnsapi.aliyuncs.com，apiVersion 2017-05-25（RPC 风格，沿用通用客户端
 *   @alicloud/pop-core，无需引入产品专用 SDK）。CountryCode 默认 86，手机号传裸 11
 *   位（如 18092907523），国内号无需加 +86。
 *
 * @author AI-Generated
 * @date 2026-06-29
 */

import { Injectable } from "@nestjs/common";

// pop-core 没有内置类型，手动声明最小接口
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PopCore = require("@alicloud/pop-core") as new (config: {
  accessKeyId: string;
  accessKeySecret: string;
  endpoint: string;
  apiVersion: string;
}) => {
  request(
    action: string,
    params: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
};

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const DYPNS_ENDPOINT = "https://dypnsapi.aliyuncs.com";
const DYPNS_API_VERSION = "2017-05-25";
/** 短信服务（业务通知，SendSms）：与号码认证服务同一 apiVersion，不同 endpoint。 */
const DYSMS_ENDPOINT = "https://dysmsapi.aliyuncs.com";

/** 验证码位数；须与前端校验位数一致（前端要求 6 位）。可被 env 覆盖。 */
const DEFAULT_CODE_LENGTH = 6;
/** 验证码有效期秒；同步用于模板 ${min} 变量。可被 env 覆盖。 */
const DEFAULT_VALID_SECONDS = 300;

/** Dev fallback code when credentials are unset (non-production only; production fails closed). */
const DEV_CODE = "888888";

// ─── 类型 ─────────────────────────────────────────────────────────────────────

interface DypnsResponse {
  Code: string;
  Message?: string;
  RequestId?: string;
  Success?: boolean;
  Model?: {
    VerifyResult?: string;
    VerifyCode?: string;
    BizId?: string;
    OutId?: string;
  };
}

interface DysmsResponse {
  Code: string;
  Message?: string;
  RequestId?: string;
  BizId?: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class SmsService {
  /**
   * 发送验证码短信（阿里云生成验证码）。
   * @param phone 目标手机号（国内裸 11 位，如 18092907523）
   * @throws Error 当阿里云返回非 OK 状态时
   */
  async sendVerifyCode(phone: string): Promise<void> {
    if (!this.isConfigured()) {
      // Fail closed in production: never fall back to the public dev code.
      if (process.env["NODE_ENV"] === "production") {
        throw new Error(
          "短信服务未配置（ALIYUN_SMS_*），生产环境拒绝发送验证码",
        );
      }
      console.log(
        `[SMS Dev] send code to phone=${phone} (dev code=${DEV_CODE})`,
      );
      return;
    }

    const validSeconds =
      Number(process.env["ALIYUN_SMS_VALID_SECONDS"]) || DEFAULT_VALID_SECONDS;
    const codeLength =
      Number(process.env["ALIYUN_SMS_CODE_LENGTH"]) || DEFAULT_CODE_LENGTH;
    const validMinutes = Math.max(1, Math.round(validSeconds / 60));

    const params: Record<string, unknown> = {
      PhoneNumber: phone,
      SignName: process.env["ALIYUN_SMS_SIGN_NAME"]!,
      TemplateCode: process.env["ALIYUN_SMS_TEMPLATE_CODE"]!,
      // ##code## 触发阿里云生成验证码写入 ${code}；${min} 为有效期分钟数。
      // 模板：您的验证码为${code}。…以上验证码${min}分钟内有效…
      TemplateParam: JSON.stringify({
        code: "##code##",
        min: String(validMinutes),
      }),
      CodeLength: codeLength,
      ValidTime: validSeconds,
    };
    const schemeName = process.env["ALIYUN_SMS_SCHEME_NAME"];
    if (schemeName) params["SchemeName"] = schemeName;

    const response = (await this.client().request("SendSmsVerifyCode", params, {
      method: "POST",
    })) as DypnsResponse;

    if (response.Code !== "OK") {
      throw new Error(
        `验证码发送失败：${response.Message ?? ""}（${response.Code}）`,
      );
    }
  }

  /**
   * 校验验证码（阿里云服务端校验，命中即在阿里云侧失效）。
   * @param phone 目标手机号（与发码时一致）
   * @param code 用户输入的验证码
   * @returns 通过返回 true，否则 false
   */
  async checkVerifyCode(phone: string, code: string): Promise<boolean> {
    if (!this.isConfigured()) {
      // Fail closed in production: missing SMS credentials must never let the
      // publicly-known dev code pass phone-code login.
      if (process.env["NODE_ENV"] === "production") {
        console.error(
          "[SMS] ALIYUN_SMS_* not configured in production — rejecting all verification codes",
        );
        return false;
      }
      return code.trim() === DEV_CODE;
    }

    const params: Record<string, unknown> = {
      PhoneNumber: phone,
      VerifyCode: code.trim(),
    };
    const schemeName = process.env["ALIYUN_SMS_SCHEME_NAME"];
    if (schemeName) params["SchemeName"] = schemeName;

    const response = (await this.client().request(
      "CheckSmsVerifyCode",
      params,
      { method: "POST" },
    )) as DypnsResponse;

    return response.Code === "OK" && response.Model?.VerifyResult === "PASS";
  }

  /**
   * 业务通知短信（product_330 P2-i）：阿里云「短信服务」Dysmsapi SendSms，走已报备的通知类模板。
   * 与验证码路径（号码认证服务 Dypnsapi 预置模板）不同：通知模板须在短信服务控制台按条报备，
   * 签名用 ALIYUN_SMS_NOTIFY_SIGN_NAME（未设回落 ALIYUN_SMS_SIGN_NAME）。同一把 AccessKey 须有
   * Dysmsapi 权限（AliyunDysmsFullAccess）。
   * 未配置凭据：生产抛错（fail-closed），非生产只打印。
   * @returns 阿里云 BizId（notification_logs.provider_message_id）
   */
  async sendTemplate(input: {
    phone: string;
    templateCode: string;
    params: Record<string, string>;
    outId?: string;
  }): Promise<string | null> {
    const signName =
      process.env["ALIYUN_SMS_NOTIFY_SIGN_NAME"] ||
      process.env["ALIYUN_SMS_SIGN_NAME"];
    if (
      !process.env["ALIYUN_SMS_ACCESS_KEY_ID"] ||
      !process.env["ALIYUN_SMS_ACCESS_KEY_SECRET"] ||
      !signName
    ) {
      if (process.env["NODE_ENV"] === "production") {
        throw new Error(
          "短信服务未配置（ALIYUN_SMS_*），生产环境拒绝发送通知短信",
        );
      }
      console.log(
        `[SMS Dev] notify phone=${input.phone} template=${input.templateCode} params=${JSON.stringify(input.params)}`,
      );
      return null;
    }
    const params: Record<string, unknown> = {
      PhoneNumbers: input.phone,
      SignName: signName,
      TemplateCode: input.templateCode,
      TemplateParam: JSON.stringify(input.params),
    };
    if (input.outId) params["OutId"] = input.outId;
    const response = (await this.client(DYSMS_ENDPOINT).request(
      "SendSms",
      params,
      { method: "POST" },
    )) as DysmsResponse;
    if (response.Code !== "OK") {
      throw new Error(
        `通知短信发送失败：${response.Message ?? ""}（${response.Code}）`,
      );
    }
    return response.BizId ?? null;
  }

  // ─── 私有方法 ─────────────────────────────────────────────────────────────

  private client(endpoint: string = DYPNS_ENDPOINT) {
    return new PopCore({
      accessKeyId: process.env["ALIYUN_SMS_ACCESS_KEY_ID"]!,
      accessKeySecret: process.env["ALIYUN_SMS_ACCESS_KEY_SECRET"]!,
      endpoint,
      apiVersion: DYPNS_API_VERSION,
    });
  }

  private isConfigured(): boolean {
    return Boolean(
      process.env["ALIYUN_SMS_ACCESS_KEY_ID"] &&
      process.env["ALIYUN_SMS_ACCESS_KEY_SECRET"] &&
      process.env["ALIYUN_SMS_SIGN_NAME"] &&
      process.env["ALIYUN_SMS_TEMPLATE_CODE"],
    );
  }
}
