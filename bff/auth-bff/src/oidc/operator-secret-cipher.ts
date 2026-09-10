/**
 * operator-secret-cipher.ts — 运营者 TOTP 密钥的静态加密。
 * @package @vxture/bff-auth
 *
 * 加密运营者 TOTP 密钥,使 base32 原文不落 admin.operator_mfa.totp_secret
 * (identity-platform-operator.md §6.1/§9)。主密钥来自 OPERATOR_TOTP_ENC_KEY。
 *
 * ── 实现已提升到 @vxture/core-utils ──
 * provisioning 的 webhook 密钥要用同一套(2026-09-10,产品接入配置化)。
 * 两处各留一份实现的话,`v1.<iv>.<tag>.<ct>` 这个线格式会各自漂移——而那个版本
 * 前缀存在的意义恰恰是跨实现对齐。本文件保留为**转发**:调用方一个字不用改。
 */
export {
  deriveSecretKey,
  encryptSecret,
  decryptSecret,
} from "@vxture/core-utils";
