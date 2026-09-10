/**
 * secret-cipher.ts — 静态密钥的 AES-256-GCM 加解密。
 * @package @vxture/core-utils
 * @layer Domain
 * @category Utils
 *
 * ── 什么时候用它、什么时候不该用 ──
 * 用它的判据只有一条：**这个密钥以后要拿回原文**。
 *
 *   · 要拿回原文 → 用它。HMAC 签名密钥就是——签名时必须有原文,哈希不可用。
 *   · 只需验证「你给的对不对」→ **别用它**,用哈希(bcrypt/argon2)。
 *     OIDC 的 client_secret、运营者口令都属这类,加密存反而多一份可被解开的风险。
 *
 * ── 线格式 ──
 * `v1.<iv>.<tag>.<ct>`,三段都是 base64。带版本前缀是为了以后换算法时能并存——
 * 解密先看版本,不认就抛,而不是拿新算法去解旧密文得到一堆乱码。
 *
 * ── 主密钥 ──
 * 由调用方从配置取,经 SHA-256 派生成 32 字节,所以任意长度的密钥串都能用。
 * **一个系统一个主密钥,不随被加密的对象增长**——这正是它相对「一个对象一个 env 键」
 * 的价值:接一个新产品不需要动容器环境。
 *
 * 本文件由 `bff/auth-bff/src/oidc/operator-secret-cipher.ts` 提升而来(运营者 TOTP
 * 密钥在用)。提升的原因是 provisioning 的 webhook 密钥要用同一套:两处各抄一份
 * 的话,线格式会各自漂移,而「v1」这个前缀恰恰是用来跨实现对齐的。
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;

/** 从配置里的密钥串派生 32 字节 AES 密钥。 */
export function deriveSecretKey(rawKey: string): Buffer {
  return createHash("sha256").update(rawKey, "utf8").digest();
}

/** 加密 → `v1.<iv>.<tag>.<ct>`(全 base64)。 */
export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(".");
}

/** 解密 `v1.<iv>.<tag>.<ct>`;格式错、被篡改、密钥不对都抛。 */
export function decryptSecret(payload: string, key: Buffer): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("invalid_secret_ciphertext");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivB64!, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64!, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64!, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
