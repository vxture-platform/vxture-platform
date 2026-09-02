"use client";

/**
 * AnimatedHeroBg.tsx - 营销页 Hero 区块动态背景
 *
 * 功能：动态节点连线 + 网格叠层 + 横向扫描光效，支持亮/暗双主题
 * 效果参考控制台登录页左侧视觉面板，适配宽幅 Hero 区块
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-05-06
 */

import { useEffect, useRef } from "react";
import { useTheme } from "@vxture/design-system";

function readHeroCanvasPalette() {
  const styles = getComputedStyle(document.documentElement);
  const nodeRgb = styles.getPropertyValue("--vx-color-hero-node-rgb").trim();
  const lineRgb = styles.getPropertyValue("--vx-color-hero-line-rgb").trim();

  return {
    node: (alpha: number) => `rgb(${nodeRgb} / ${alpha})`,
    line: (alpha: number) => `rgb(${lineRgb} / ${alpha})`,
    scanColor: styles.getPropertyValue("--vx-color-hero-scan").trim(),
  };
}

// ─── 组件 ─────────────────────────────────────────────────────────────────────

export interface AnimatedHeroBgProps {
  /**
   * 节点密度：每多少 px² 一个节点（越大越稀疏）。默认 8500 = 各营销页原样；
   * 目录页 hero 用 ~24000（owner 2026-09-02：点线太密，要稀疏）。
   */
  density?: number;
  /** 运动速度倍率（1 = 原速）。目录页用 0.45。 */
  speed?: number;
  /** 点/线透明度倍率（1 = 原样）。目录页用 0.5（颜色淡化）。 */
  intensity?: number;
  /** 连线距离（px），默认 150。 */
  linkDistance?: number;
  /**
   * 是否渲染自带的三层（渐变底色 / 网格 / 底部渐隐）。目录页 hero 自己铺
   * 底色与渐隐，只借用点线 canvas → false。
   */
  layers?: boolean;
}

/**
 * 全屏自适应动态背景，放在 Hero section 内 absolute inset-0 容器即可
 */
export default function AnimatedHeroBg({
  density = 8500,
  speed = 1,
  intensity = 1,
  linkDistance = 150,
  layers = true,
}: AnimatedHeroBgProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -999, y: -999 });
  const { theme } = useTheme();
  const isDark = theme === "dark";

  // ─── Canvas 动画 ───────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const palette = readHeroCanvasPalette();
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let raf = 0;
    let running = false;
    let width = 0;
    let height = 0;
    let scanY = 0;

    type Node = {
      x: number;
      y: number;
      vx: number;
      vy: number;
      r: number;
      phase: number;
    };
    let nodes: Node[] = [];

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.max(
        density > 8500 ? 12 : 32,
        Math.floor((width * height) / density),
      );
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.3 * speed,
        vy: (Math.random() - 0.5) * 0.3 * speed,
        r: Math.random() * 1.8 + 0.6,
        phase: Math.random() * Math.PI * 2,
      }));
    };

    const LINK_DIST = linkDistance;
    const LINK_DIST_SQ = LINK_DIST * LINK_DIST;
    const SCAN_SPEED = 0.5 * speed;

    const renderFrame = () => {
      ctx.clearRect(0, 0, width, height);
      const mouse = mouseRef.current;

      // 更新节点位置（含鼠标排斥）
      for (const n of nodes) {
        n.phase += 0.012 * speed;
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > width) n.vx *= -1;
        if (n.y < 0 || n.y > height) n.vy *= -1;
        const dx = n.x - mouse.x;
        const dy = n.y - mouse.y;
        const d = Math.hypot(dx, dy);
        if (d > 0 && d < 100) {
          n.x += (dx / d) * 0.5;
          n.y += (dy / d) * 0.5;
        }
      }

      // 绘制节点连线（先用平方距离筛除，命中才开方，省掉绝大多数 sqrt）
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i]!;
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j]!;
          const ddx = a.x - b.x;
          const ddy = a.y - b.y;
          const dsq = ddx * ddx + ddy * ddy;
          if (dsq < LINK_DIST_SQ) {
            const d = Math.sqrt(dsq);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = palette.line(
              (1 - d / LINK_DIST) * 0.28 * intensity,
            );
            ctx.lineWidth = 0.6;
            ctx.stroke();
          }
        }
      }

      // 绘制节点（带脉冲缩放）
      for (const n of nodes) {
        const pulse = Math.sin(n.phase) * 0.5 + 0.5;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * (1 + pulse * 0.35), 0, Math.PI * 2);
        ctx.fillStyle = palette.node((0.4 + pulse * 0.4) * intensity);
        ctx.fill();
      }

      // 绘制下降横向扫描线（淡化模式下不画：稀疏点线上再扫一条线会显得突兀）
      if (intensity >= 1) {
        scanY = (scanY + SCAN_SPEED) % height;
        const scanGrad = ctx.createLinearGradient(0, 0, width, 0);
        scanGrad.addColorStop(0, "transparent");
        scanGrad.addColorStop(0.5, palette.scanColor);
        scanGrad.addColorStop(1, "transparent");
        ctx.fillStyle = scanGrad;
        ctx.fillRect(0, scanY, width, 1.5);
      }
    };

    const loop = () => {
      if (!running) return;
      renderFrame();
      raf = requestAnimationFrame(loop);
    };

    const startLoop = () => {
      if (running || prefersReducedMotion) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };

    const stopLoop = () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    resize();
    // Draw one static frame immediately so the background is present before the
    // first animation tick (and is the final state when motion is reduced).
    renderFrame();

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    // Only animate while the hero is actually on screen — the marketing pages
    // that use this run a 60fps O(n²) canvas that otherwise keeps burning CPU
    // after the user scrolls past.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          startLoop();
        } else {
          stopLoop();
        }
      },
      { threshold: 0 },
    );
    observer.observe(canvas);

    window.addEventListener("resize", resize);
    canvas.addEventListener("pointermove", onMove);

    return () => {
      stopLoop();
      observer.disconnect();
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointermove", onMove);
    };
  }, [isDark, density, speed, intensity, linkDistance]);

  // ─── 渲染 ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
    >
      {/* 渐变底色 */}
      {layers ? <div className="vx-hero-bg-layer absolute inset-0" /> : null}

      {/* 节点连线动画层 */}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* 网格叠层 */}
      {layers ? <div className="vx-hero-grid-layer absolute inset-0" /> : null}

      {/* 底部向下渐隐，与页面内容区平滑过渡 */}
      {layers ? (
        <div className="vx-hero-fade-layer absolute bottom-0 left-0 right-0 h-28" />
      ) : null}
    </div>
  );
}
