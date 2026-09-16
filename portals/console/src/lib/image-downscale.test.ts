/**
 * image-downscale.test.ts — 上传前缩图的纯逻辑。
 *
 * ── 为什么这块值得测 ──
 *
 * `downscaleImage` 本身要 canvas，跑不进 vitest；但它做不做、缩到多大、输出成什么
 * 格式，三个判断全在纯函数里，而三个都有明确的**错法**：
 *
 *  1. 把 GIF 也缩了 → 动图悄悄变成一张静帧。不报错，用户传完才发现动画没了。
 *  2. 把小图也缩 → 本来 20KB 的图重编码一遍，画质掉了体积还可能变大。
 *  3. 输出格式跑出服务端白名单（PNG / JPEG / WEBP / GIF）→ 压完反被 415 拒掉，
 *     而这条路径在前端一点征兆都没有。
 *
 * 另有一条边界：极端宽高比缩完短边会算成 0，而 0 宽的 canvas 画不出东西。
 */
import { describe, expect, it } from "vitest";

import {
  MAX_EDGE,
  pickOutputType,
  shouldSkipDownscale,
  targetSize,
} from "./image-downscale";

describe("shouldSkipDownscale", () => {
  it("跳过 GIF —— 过一遍 canvas 只会剩第一帧", () => {
    expect(shouldSkipDownscale("image/gif")).toBe(true);
  });

  it("其余栅格格式都缩", () => {
    expect(shouldSkipDownscale("image/png")).toBe(false);
    expect(shouldSkipDownscale("image/jpeg")).toBe(false);
    expect(shouldSkipDownscale("image/webp")).toBe(false);
  });
});

describe("targetSize", () => {
  it("长边超限时按长边等比缩", () => {
    expect(targetSize(1024, 512)).toEqual({ width: MAX_EDGE, height: 128 });
    expect(targetSize(512, 1024)).toEqual({ width: 128, height: MAX_EDGE });
  });

  it("正方形缩成上限见方", () => {
    expect(targetSize(1000, 1000)).toEqual({
      width: MAX_EDGE,
      height: MAX_EDGE,
    });
  });

  it("本来就不超限的原样返回 —— 不放大、不重编码", () => {
    expect(targetSize(200, 100)).toEqual({ width: 200, height: 100 });
    expect(targetSize(MAX_EDGE, MAX_EDGE)).toEqual({
      width: MAX_EDGE,
      height: MAX_EDGE,
    });
  });

  it("极端宽高比下短边至少留 1px —— 0 宽的 canvas 画不出东西", () => {
    expect(targetSize(2000, 3).height).toBeGreaterThanOrEqual(1);
    expect(targetSize(3, 2000).width).toBeGreaterThanOrEqual(1);
  });

  it("零尺寸不炸也不除零", () => {
    expect(targetSize(0, 0)).toEqual({ width: 0, height: 0 });
  });
});

describe("pickOutputType", () => {
  it("PNG 保持 PNG —— 留住透明通道，logo 多半是透明底", () => {
    expect(pickOutputType("image/png")).toBe("image/png");
  });

  it("WEBP 保持 WEBP", () => {
    expect(pickOutputType("image/webp")).toBe("image/webp");
  });

  it("其余一律 JPEG", () => {
    expect(pickOutputType("image/jpeg")).toBe("image/jpeg");
    expect(pickOutputType("image/bmp")).toBe("image/jpeg");
    expect(pickOutputType("")).toBe("image/jpeg");
  });

  it("输出一定落在服务端白名单内 —— 否则压完反被拒", () => {
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    for (const input of [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/bmp",
      "",
    ]) {
      expect(allowed).toContain(pickOutputType(input));
    }
  });
});
