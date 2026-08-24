import { createHash, randomBytes } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  pickSessionForRealm,
  stripSubPrefix,
  verifyPkceS256,
} from "./oidc.service";

// Build a valid PKCE pair the same way an RP would.
function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("hex");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

describe("verifyPkceS256", () => {
  it("accepts a correct verifier", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
  });

  it("rejects a wrong verifier", () => {
    const { challenge } = pkcePair();
    expect(verifyPkceS256("not-the-verifier", challenge)).toBe(false);
  });

  it("rejects empty verifier or challenge", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifyPkceS256("", challenge)).toBe(false);
    expect(verifyPkceS256(verifier, "")).toBe(false);
  });

  it("is not fooled by a plain (non-hashed) challenge", () => {
    const verifier = randomBytes(32).toString("hex");
    // A client that mistakenly sent the verifier as the challenge must fail S256.
    expect(verifyPkceS256(verifier, verifier)).toBe(false);
  });
});

describe("stripSubPrefix", () => {
  it("strips usr_ and opr_ namespaces", () => {
    expect(stripSubPrefix("usr_abc-123")).toBe("abc-123");
    expect(stripSubPrefix("opr_def-456")).toBe("def-456");
  });

  it("returns the input unchanged when no prefix", () => {
    expect(stripSubPrefix("plainid")).toBe("plainid");
  });

  it("only strips at the first underscore", () => {
    expect(stripSubPrefix("usr_a_b")).toBe("a_b");
  });
});

describe("pickSessionForRealm", () => {
  /* 这一组的重点全在"两份 cookie 同时存在"上——单份的情形怎么写都对，
     正是它让 `tenant ?? operator` 看着没问题地活了下来。 */
  it("两份都在时，工作台取运营者会话（不被租户会话遮蔽）", () => {
    expect(
      pickSessionForRealm("workforce", { tenant: "t-1", operator: "o-1" }),
    ).toBe("o-1");
  });

  it("两份都在时，客户侧取租户会话", () => {
    expect(
      pickSessionForRealm("customer", { tenant: "t-1", operator: "o-1" }),
    ).toBe("t-1");
  });

  it("只有对侧那份时返回 undefined —— 不跨 realm 兜底", () => {
    expect(pickSessionForRealm("workforce", { tenant: "t-1" })).toBeUndefined();
    expect(
      pickSessionForRealm("customer", { operator: "o-1" }),
    ).toBeUndefined();
  });

  it("一份都没有时返回 undefined", () => {
    expect(pickSessionForRealm("workforce", {})).toBeUndefined();
  });

  it("未知 realm 按客户侧处理，绝不落到运营者会话上", () => {
    expect(
      pickSessionForRealm("nonesuch", { tenant: "t-1", operator: "o-1" }),
    ).toBe("t-1");
  });
});
