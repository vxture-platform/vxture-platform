"use client";

/* useLocaleSwitch.ts — 切语言。
 *
 * ## 为什么是 refresh 而不是就地换词条
 *
 * admin 那套的做法是把**两本词条都发给客户端**，切换时换 state、不刷新，切得
 * 是快。代价是每个访问者都下载了自己不看的那一本，而且客户端从此有了一份
 * 需要和服务端保持一致的语言状态。
 *
 * 这里改成：写 cookie → `router.refresh()` → 服务端按新 cookie 重渲染。客户端
 * 只拿一本；「谁是权威」也只有一个答案——cookie。代价是切换要等一次 RSC 往返，
 * 对一个一天切不了一次的偏好来说，这个代价买到的是少一半载荷和少一处状态。
 *
 * ## 为什么写偏好而不是直接写 cookie
 *
 * `setGlobalLocalePreference` 同时写 localStorage 与 `NEXT_LOCALE` cookie
 * （见 `@vxture/platform-browser` 的 preferences.utils）。cookie 是服务端读的那一份，
 * localStorage 是跨门户沿用的那一份——同一个账号在 console 里选了英文，来
 * opera 也该是英文。只写 cookie 会让后半句不成立。
 */

import { useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import type { Locale } from "@vxture-platform/shared";
import { setGlobalLocalePreference } from "@vxture/platform-browser";

export function useLocaleSwitch(): {
  locale: Locale;
  switching: boolean;
  switchLocale: (next: Locale) => void;
} {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [switching, startTransition] = useTransition();

  const switchLocale = useCallback(
    (next: Locale) => {
      if (next === locale) return;
      setGlobalLocalePreference(next);
      startTransition(() => {
        router.refresh();
      });
    },
    [locale, router],
  );

  return { locale, switching, switchLocale };
}
