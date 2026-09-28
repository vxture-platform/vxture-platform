"use client";

/**
 * useDebounced.ts — 文本框的值与**真正发出去的值**分开。
 * @package @vxture/opera
 * @layer Presentation
 *
 * 文本筛选直接进取数的依赖、不防抖，就是**每敲一个字符一次请求**：搜 "invoice" 是
 * 七次，而每次在服务端是一次 COUNT 加一页查询。
 *
 * 2026-09-14 这个钩子第一次出现在 `capability/registry` 页里，当时的注释写着「没做成
 * 共享件：opera 全站此前没有防抖先例，一个用例撑不起一个约定。第二个用例出现时再提」。
 * 2026-09-28 运营通告页的关键词也改成服务端筛选（前端筛的话，条数与三档计数只能按被
 * 截断过的那一段算），第二个用例到了，于是按那条注释自己定的条件抽出来。
 */

import { useEffect, useState } from "react";

export function useDebounced<T>(value: T, delay = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return settled;
}
