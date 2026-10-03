/**
 * pg-user.repository.itest.spec.ts — updateProfile 的 timezone 三态只有真库才验得出。
 *
 * ── 为什么要一条真库锁 ──
 * MockUserRepository 与 PgUserRepository 各写各的三态,单测只能证明 mock 那一半。
 * 2026-10-04 审查实测:SQL 里 `timezone = coalesce(excluded.timezone, …)` 把 '' 存成了
 * 空串、把 null 当成「不改」,于是账号页选「未设置」后保存 200 却悄悄回到旧值——而用量
 * day 档正按这个值切桶,「没设 = 默认 UTC」对设过一次的人永远到不了。
 *
 * 三条判据,各自对应 SQL 的一段:
 *   null → 不改(case when $5 is null then 旧值)
 *   ''   → NULL,不是 ''(nullif($5, ''))
 *   首次 upsert(profile 行不存在)带 '' → 插入的就是 NULL(values 里的 nullif)
 *
 * Gated(需要一个已建库的平台 DB):
 *   ACCOUNT_ITEST=1 DATABASE_URL=postgresql://... pnpm test
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PgUserRepository } from "./pg-user.repository";

const RUN = process.env.ACCOUNT_ITEST === "1";

describe.skipIf(!RUN)(
  "PgUserRepository.updateProfile · timezone 三态(真库)",
  () => {
    let pool: Pool;
    let repo: PgUserRepository;
    let userId: string;

    beforeAll(async () => {
      pool = new Pool({ connectionString: process.env.DATABASE_URL });
      repo = new PgUserRepository(pool);
      // 手机号随机,重跑时不与上一次没清干净的行撞唯一键。
      const phone = `+8613${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
      const user = await repo.createUser({
        account: null,
        email: null,
        emailVerified: false,
        phone,
        phoneVerified: true,
        name: null,
        passwordHash: null,
      });
      userId = user.id;
    });

    afterAll(async () => {
      await pool.query("delete from account.user_profiles where user_id = $1", [
        userId,
      ]);
      await pool.query("delete from loyalty.user_points where user_id = $1", [
        userId,
      ]);
      await pool.query("delete from account.users where id = $1", [userId]);
      await pool.end();
    });

    /** 直接读列:区分「行不在」「NULL」「空串」三种,视图层的 `?? null` 会把前两种抹平。 */
    const storedTimezone = async (): Promise<string | null | "(no row)"> => {
      const r = await pool.query<{ timezone: string | null }>(
        "select timezone from account.user_profiles where user_id = $1",
        [userId],
      );
      if (r.rows.length === 0) return "(no row)";
      return r.rows[0]!.timezone;
    };

    it("设值 → 落库", async () => {
      await repo.updateProfile(userId, { timezone: "Asia/Shanghai" });
      expect(await storedTimezone()).toBe("Asia/Shanghai");
    });

    it("null → 不改", async () => {
      await repo.updateProfile(userId, { timezone: "Asia/Shanghai" });
      await repo.updateProfile(userId, { timezone: null });
      expect(await storedTimezone()).toBe("Asia/Shanghai");
    });

    it("'' → 清成 NULL,不是空串", async () => {
      await repo.updateProfile(userId, { timezone: "Asia/Shanghai" });
      await repo.updateProfile(userId, { timezone: "" });
      expect(await storedTimezone()).toBeNull();
    });

    it("profile 行不存在时带 '' upsert → 插入的就是 NULL", async () => {
      await pool.query("delete from account.user_profiles where user_id = $1", [
        userId,
      ]);
      expect(await storedTimezone()).toBe("(no row)");
      await repo.updateProfile(userId, { timezone: "" });
      expect(await storedTimezone()).toBeNull();
    });

    it("清掉之后再设值 → 又能落库(三态可往返)", async () => {
      await repo.updateProfile(userId, { timezone: "" });
      await repo.updateProfile(userId, { timezone: "Europe/Berlin" });
      expect(await storedTimezone()).toBe("Europe/Berlin");
    });
  },
);
