"use client";

/* image-downscale.ts — 上传前在浏览器里把图缩到 256px 长边。
 *
 * ## 为什么缩在前端
 *
 * 设计文档（`docs/30-design/identity/050-account.md` §5.3/§5.5）要求重编码、
 * 缩到 ≤256px、剥 EXIF，三件一件都没做：上传的图**原样入库**，用户传 1MB 原图
 * 就原样存 1MB，哪怕最终画在 16px 的列表格子里。
 *
 * owner 2026-09-16 定的做法是浏览器里缩完再传，服务端只校验。理由：上传量极低
 * （一人一次），服务端零新依赖；sharp 要原生二进制、与本仓的 WASM 取向冲突，
 * WASM 编解码为这点量不值。**canvas 重绘还天然丢掉 EXIF**——手机拍的图带 GPS，
 * 那是隐私后果，不是顺带的优化。
 *
 * ## 这里不是一道门
 *
 * 前端不可信：服务端的魔数嗅探与 1MB 上限（`services/identity/account/src/avatar/
 * image-sniff.ts`）一条都不能省。本模块只让正常路径少传些字节。
 *
 * ## 三条明确的不做
 *
 * - **动图不缩**：GIF 一过 canvas 就只剩第一帧，把动图悄悄变成静帧比不压更糟。
 * - **不放大**：本来就小于上限的图原样返回，重编码只会掉画质。
 * - **压完更大就不要**：小图重编码有可能比原文件还大，那就用原文件。
 *
 * 任何一步出错（浏览器没有 canvas、解码失败、toBlob 给了 null）都返回原文件——
 * 缩图是优化，不该把上传本身挡死。
 */

/** 长边上限，取自设计文档 §5.3 的头像尺寸。 */
export const MAX_EDGE = 256;

/** 重编码质量。0.9 对头像这种尺寸肉眼看不出差别，再高就没有压缩意义了。 */
const QUALITY = 0.9;

/** 动图不缩——过一遍 canvas 只会剩下第一帧。 */
export function shouldSkipDownscale(type: string): boolean {
  return type === "image/gif";
}

/**
 * 按长边等比缩放后的尺寸。长边已经不超过上限时原样返回（不放大）。
 *
 * 四舍五入后至少留 1px：极端宽高比（比如 2000×3）缩完短边会算成 0，
 * 而 0 宽的 canvas 画不出东西。
 */
export function targetSize(
  width: number,
  height: number,
  maxEdge: number = MAX_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= 0 || longest <= maxEdge) return { width, height };
  const ratio = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/**
 * 输出格式。**必须落在服务端白名单内**（PNG / JPEG / WEBP / GIF，见 image-sniff.ts），
 * 否则压完反而被拒。
 *
 * PNG 保持 PNG 是为了留住透明通道——logo 十有八九是带透明底的，转成 JPEG 会给它
 * 糊一层黑底。其余一律 JPEG：它是 canvas 各浏览器都稳的那一种。
 */
export function pickOutputType(inputType: string): string {
  if (inputType === "image/png") return "image/png";
  if (inputType === "image/webp") return "image/webp";
  return "image/jpeg";
}

/** 缩图；任何一步不成立都返回原文件。 */
export async function downscaleImage(file: File): Promise<Blob> {
  if (shouldSkipDownscale(file.type)) return file;
  if (
    typeof createImageBitmap !== "function" ||
    typeof document === "undefined"
  ) {
    return file;
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const size = targetSize(bitmap.width, bitmap.height);
    // 本来就够小：重编码只会掉画质，原样送走。
    if (size.width === bitmap.width && size.height === bitmap.height)
      return file;

    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);

    const type = pickOutputType(file.type);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, type, QUALITY);
    });
    if (!blob || blob.size >= file.size) return file;
    return blob;
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}
