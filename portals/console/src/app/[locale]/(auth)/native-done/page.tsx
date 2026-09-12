import { getTranslations } from "next-intl/server";

/**
 * 桌面端登录完成后的终点页。
 *
 * ## 为什么需要这一页
 *
 * 桌面端的登录，浏览器这一侧做的是**批准**，不是**持有**：回调里平台把会话绑到
 * 设备交来的 handle 上，然后由应用自己拿从未外露的 `deviceSecret` 去领。所以浏览器
 * 走到这里就没事了——它既不该拿到 cookie，也不该跳回任何带凭据的地址。
 *
 * ## 为什么不在 /auth/ 下
 *
 * 第一版 BFF 跳的是 `/auth/native-done`，而那个路径**到不了页面层**：nginx 把
 * `/auth/` 整段代理给 console-bff，console 的 i18n middleware 又在 matcher 里排除了
 * `auth`。两侧各有各的道理，合起来的结果是登录成功的用户看到一个 404。
 *
 * 那是这条链上最坏的一种失败：**事情办成了，而画面说它没办成**。用户会回去重登，
 * 重登会再绑一次、再领一次，他看到的还是 404——没有任何一处告诉他其实早就好了。
 *
 * 所以这一页落在 `/native-done`（`/auth/` 之外），走 `/` 那条 location 到 Next，
 * 由 i18n middleware 补上语言前缀。
 */
export default async function NativeDonePage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  /* `ok=0` 只有一个来源：handle 形状不合法，绑定没做成。这种情况应用会一直轮询到
     超时，用户如果不知情就会一直等着——所以失败必须让他看见，不能静默回同一页。 */
  const { ok } = await searchParams;
  const failed = ok === "0";
  const t = await getTranslations("nativeDone");

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md text-center">
        <h1 className="text-xl font-semibold text-[var(--vx-text-primary)]">
          {failed ? t("failedTitle") : t("title")}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--vx-text-secondary)]">
          {failed ? t("failedBody") : t("body")}
        </p>
      </div>
    </main>
  );
}
