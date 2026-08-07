"use client";

/**
 * Shell.tsx - 预览面外壳：可收缩的大类导航 + 三根模式轴。
 * @package @vxture/design-preview
 *
 * 导航一级是六个大类，**只有当前所在的那一类展开**二级——六类的条目全摊开有五十多
 * 条，那不叫导航，叫目录溢出。再点当前这一类则收起，只留六行；换页时恢复展开，
 * 收起是当下这一眼的意图，不是要记住的偏好。
 *
 * 模式轴（明暗 / 密度 / 字号）不是 provider，是 `<html>` 上的类名，和产品运行时的
 * 机制一致。它们挂在外壳上，切页不重置。
 */

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, useTheme } from "@vxture/design-system";
import { SECTIONS } from "./sections";
import { ENTRIES, GROUPS } from "./registry";
import {
  DENSITIES,
  FONT_SIZES,
  useRootClass,
  type Density,
  type FontSize,
} from "./kit";

/** 本大类页内的锚点清单。基础三类没有条目，只有一页内容。 */
function entriesOf(slug: string) {
  const section = SECTIONS.find((s) => s.slug === slug);
  if (!section || section.kind !== "component" || !section.layer) return [];
  const mine = ENTRIES.filter((e) => e.layer === section.layer);
  const order = (g: string) => {
    const i = GROUPS.indexOf(g as (typeof GROUPS)[number]);
    return i < 0 ? GROUPS.length : i;
  };
  return [...mine].sort((a, b) => order(a.group) - order(b.group));
}

export function Shell({ children }: { readonly children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname.split("/")[1] ?? "";
  const { theme, setTheme } = useTheme();
  const [density, setDensity] = React.useState<Density>("default");
  const [fontSize, setFontSize] = React.useState<FontSize>("default");
  const [collapsed, setCollapsed] = React.useState(false);

  /**
   * 当前主题只有客户端知道——它存在 localStorage 里，服务端渲染时无从得知，于是
   * SSR 把 light 标成选中、hydration 时发现应该是 dark，React 报 hydration mismatch。
   * 密度与字号没这个问题：它们是本组件的 state，两端都从 default 起步。
   *
   * 挂载前不标任何一档，挂载后再显示——这是 next-themes 官方给的做法。
   */
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  // 换页即恢复展开——收起只对当前这一眼有效。
  React.useEffect(() => setCollapsed(false), [active]);

  useRootClass("density-", density, DENSITIES);
  useRootClass("vx-font-", fontSize, FONT_SIZES);

  return (
    <div className="flex min-h-screen">
      {/* 透明模式 V2：侧栏与内容同底、零分隔——预览外壳自己就是这条规则的活演示。 */}
      <aside className="sticky top-none hidden h-screen w-sidebar-expanded shrink-0 flex-col gap-lg overflow-y-auto p-lg lg:flex">
        <div className="flex flex-col gap-2xs">
          <span className="text-label-lg text-foreground">Design Preview</span>
          <span className="text-body-sm text-muted-foreground">
            仅开发用，不发布不部署
          </span>
        </div>

        <nav className="flex flex-col gap-2xs">
          {/* 临时组件分区随 pending 清零而隐藏；登记机制保留，再欠债时它自己回来。 */}
          {SECTIONS.filter(
            (s) => s.slug !== "pending" || entriesOf(s.slug).length > 0,
          ).map((s) => {
            const here = s.slug === active;
            const open = here && !collapsed;
            const hasChildren = entriesOf(s.slug).length > 0;
            return (
              <div key={s.slug} className="flex flex-col gap-2xs">
                <Link
                  href={`/${s.slug}`}
                  aria-current={here ? "page" : undefined}
                  {...(hasChildren ? { "aria-expanded": open } : {})}
                  onClick={(e) => {
                    // 已经在这一类上：点击不再是导航，是开合。
                    if (!here || !hasChildren) return;
                    e.preventDefault();
                    setCollapsed((v) => !v);
                  }}
                  className={
                    here
                      ? "flex items-center justify-between rounded-md bg-surface-selected px-sm py-xs text-label-md text-foreground"
                      : "flex items-center justify-between rounded-md px-sm py-xs text-label-md text-muted-foreground transition-colors duration-fast ease-standard hover:bg-accent hover:text-foreground"
                  }
                >
                  <span className="flex min-w-0 items-baseline gap-xs">
                    <span className="text-body-sm text-muted-foreground">
                      {s.realm}
                    </span>
                    <span className="truncate">{s.label}</span>
                  </span>
                  <Icon
                    name={open ? "chevron-down" : "chevron-right"}
                    size={16}
                    aria-hidden="true"
                  />
                </Link>

                {open ? <SubNav slug={s.slug} /> : null}
              </div>
            );
          })}
        </nav>

        {/* 模式轴原先浮在正文右上角，色阶铺满一行之后每滚一屏都压住最右一列色块——
            一个常驻的全局开关不该跟被观察的内容抢同一块地方。它和导航是同一类东西
            （切什么、怎么看），归到侧栏底部，正文让回整幅宽度。 */}
        {/* pb 加在这里而不是靠 aside 的内边距：sticky 贴的是滚动容器的 padding-box
            底沿，容器自己的 bottom padding 顶不开它。 */}
        {/* bg-background 而非透明：sticky 块要盖住从它底下滚过的导航项。 */}
        <div className="sticky bottom-none mt-auto flex flex-col gap-sm border-t border-dashed border-primary/10 bg-background pb-sm pt-lg dark:border-primary/20">
          <Axis
            label="主题"
            value={mounted ? (theme ?? "") : ""}
            options={["light", "dark", "system"]}
            onChange={(v) => setTheme(v as typeof theme)}
          />
          <Axis
            label="密度"
            value={density}
            options={DENSITIES}
            onChange={(v) => setDensity(v as Density)}
          />
          <Axis
            label="字号"
            value={fontSize}
            options={FONT_SIZES}
            onChange={(v) => setFontSize(v as FontSize)}
          />
        </div>
      </aside>

      {/* pb-6xl 不是审美留白，是功能性的：二级导航是锚点跳转，没有这段富余，最后
          一节永远顶不到视口上沿，点它等于没跳；页底也不该紧贴着最后一行结束。 */}
      <main className="flex min-w-0 flex-1 flex-col gap-xl p-xl pb-6xl">
        {children}
      </main>
    </div>
  );
}

function SubNav({ slug }: { readonly slug: string }) {
  const items = entriesOf(slug);
  if (items.length === 0) return null;

  let lastGroup = "";
  return (
    <div className="flex flex-col gap-2xs pb-sm pl-sm">
      {items.map((e) => {
        const head = e.group !== lastGroup ? e.group : null;
        lastGroup = e.group;
        return (
          <React.Fragment key={e.name}>
            {head ? (
              <span className="px-sm pt-xs text-overline text-muted-foreground">
                {head}
              </span>
            ) : null}
            <a
              href={`#c-${e.name}`}
              className="flex items-center justify-between rounded-md px-sm py-2xs text-body-sm text-muted-foreground transition-colors duration-fast ease-standard hover:bg-accent hover:text-foreground"
            >
              {e.name}
              {e.tags[0] === "vxture" || e.tags[1] === "vxture" ? (
                <span
                  className="size-2xs rounded-full bg-primary"
                  aria-label="含本仓改动"
                />
              ) : null}
            </a>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function Axis({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly string[];
  readonly onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2xs">
      <span className="text-body-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2xs">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            className={
              o === value
                ? "rounded-md bg-primary px-sm py-2xs text-label-sm text-primary-foreground"
                : "rounded-md px-sm py-2xs text-label-sm text-muted-foreground transition-colors duration-fast ease-standard hover:bg-accent hover:text-foreground"
            }
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
