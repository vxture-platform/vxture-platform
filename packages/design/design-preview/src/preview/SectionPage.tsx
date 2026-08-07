"use client";

/**
 * SectionPage.tsx - 一个大类一页。
 * @package @vxture/design-preview
 *
 * 顶部那组数**只统计本页**。六类堆在一页时，那组数只能是其中一类的汇总，对其余五类
 * 都是错的——这是分页的直接原因，不是顺带的好处。
 *
 * 每类的口径不同：色彩数角色与色阶，图标数名字与档位，文字数排版角色，组件按出处分。
 * 全部现算，不写死。
 */

import * as React from "react";
import {
  ICON_GROUPS,
  iconDictionary,
  StatusBadge,
} from "@vxture/design-system";
import { Section } from "./kit";
import {
  ENTRIES,
  GROUPS,
  type Entry,
  type Layer,
  type Provenance,
} from "./registry";
import { sectionBySlug } from "./sections";
import {
  ICON_SIZES,
  IconGallery,
  PrimitiveRamps,
  SemanticColors,
  TypographyScale,
  useColorTokens,
  useTypeRoles,
} from "./foundation";

export function SectionPage({ slug }: { readonly slug: string }) {
  const section = sectionBySlug(slug);
  if (!section) return null;

  return (
    <>
      <header className="flex flex-col gap-2xs">
        <span className="text-overline text-muted-foreground">
          {section.realm}
        </span>
        <h1 className="text-heading-2 text-foreground">{section.label}</h1>
        <p className="text-body-sm text-muted-foreground">{section.summary}</p>
      </header>

      {section.kind === "color" ? <ColorPage /> : null}
      {section.kind === "icon" ? <IconPage /> : null}
      {section.kind === "type" ? <TypePage /> : null}
      {section.kind === "component" && section.layer ? (
        <ComponentPage layer={section.layer} />
      ) : null}
    </>
  );
}

/* ── 各类页面 ─────────────────────────────────────────────── */

function ColorPage() {
  const tokens = useColorTokens();
  const semantic = tokens.filter((t) => !t.name.startsWith("--vx-"));
  const ramps = new Set(
    tokens
      .map((t) => /^--vx-color-([a-z]+)-\d+$/.exec(t.name)?.[1])
      .filter(Boolean),
  );

  return (
    <>
      <Stats>
        <Stat value={ramps.size} label="原子色阶" note="T1 · 不参与明暗" />
        <Stat value={semantic.length} label="语义角色" note="T2 · 跟随主题" />
        <Stat value={2} label="主题" note="明 / 暗" />
      </Stats>
      <Section id="c-ramps" title="原子色阶（T1）">
        <PrimitiveRamps />
      </Section>
      <Section id="c-semantic" title="语义色板（T2）">
        <SemanticColors />
      </Section>
    </>
  );
}

function IconPage() {
  return (
    <>
      <Stats>
        <Stat
          value={iconDictionary.length}
          label="图标"
          note="iconDictionary"
        />
        <Stat value={ICON_GROUPS.length} label="分组" note="按用途" />
        <Stat
          value={ICON_SIZES.length}
          label="尺寸档位"
          note={`${ICON_SIZES[0]} … ${ICON_SIZES[ICON_SIZES.length - 1]}`}
        />
      </Stats>
      <Section id="c-icons" title="图标全集">
        <IconGallery />
      </Section>
    </>
  );
}

function TypePage() {
  const roles = useTypeRoles();
  const families = new Set(roles.map((r) => r.role.split("-")[0]));

  return (
    <>
      <Stats>
        <Stat value={roles.length} label="排版角色" note="T2 · 跟随字号" />
        <Stat value={families.size} label="族" note="display / heading / …" />
        <Stat value={3} label="字号档位" note="small / default / large" />
      </Stats>
      <Section id="c-type" title="排版角色">
        <TypographyScale />
      </Section>
    </>
  );
}

function ComponentPage({ layer }: { readonly layer: Layer }) {
  const mine = ENTRIES.filter((e) => e.layer === layer);
  /**
   * 件数按**实际展示到的组件**算，不是条目数——一族并在一条里看是对的，
   * 但不能因此少算。此前统计卡给的是条目数，比真实件数少 15 件且看不出来。
   */
  const shown = mine.reduce((n, e) => n + 1 + (e.covers?.length ?? 0), 0);
  const axisTotal = mine.reduce(
    (n, e) => n + (e.axes?.reduce((m, a) => m + a.values.length, 0) ?? 0),
    0,
  );
  const of = (a: Provenance, b: Provenance) =>
    mine.filter((e) => e.tags[0] === a && e.tags[1] === b).length;

  const groups = GROUPS.map((g) => ({
    group: g,
    items: mine.filter((e) => e.group === g),
  })).filter((g) => g.items.length > 0);

  // GROUPS 之外的分组（临时组件那两件）不会因为漏列而消失，排在最后。
  const known = new Set(GROUPS as readonly string[]);
  const rest = [...new Set(mine.map((e) => e.group))].filter(
    (g) => !known.has(g),
  );
  const all = [
    ...groups,
    ...rest.map((g) => ({
      group: g,
      items: mine.filter((e) => e.group === g),
    })),
  ];

  return (
    <>
      <Stats>
        <Stat value={shown} label="件数" note="含并列展示的" />
        {layer === "pending" ? (
          <Stat
            value={shown}
            label="待重写"
            note="仍挂遗留类名"
            tone="warning"
          />
        ) : (
          <>
            <Stat
              value={of("shadcn", "origin")}
              label="纯上游"
              note={<Tags tags={["shadcn", "origin"]} />}
            />
            <Stat
              value={of("shadcn", "vxture")}
              label="部分定制"
              note={<Tags tags={["shadcn", "vxture"]} />}
            />
            <Stat value={axisTotal} label="变体挡位" note="全部轴合计" />
            <Stat
              value={mine.filter((e) => e.tags[0] === "vxture").length}
              label="完全自建"
              note={
                <Tags
                  tags={[
                    "vxture",
                    layer === "pattern" ? "patterns" : "component",
                  ]}
                />
              }
            />
          </>
        )}
      </Stats>

      {all.map(({ group, items }) => (
        <div key={group} className="flex flex-col gap-xl">
          <h2 className="text-title-md text-foreground">{group}</h2>
          {items.map((e) => (
            <EntrySection key={e.name} entry={e} />
          ))}
        </div>
      ))}
    </>
  );
}

/* ── 通用件 ───────────────────────────────────────────────── */

function EntrySection({ entry }: { readonly entry: Entry }) {
  return (
    <Section
      id={`c-${entry.name}`}
      title={entry.name}
      note={
        <span className="flex flex-wrap items-center gap-sm">
          <Tags tags={entry.tags} />
          {entry.axes?.map((axis) => (
            <span
              key={axis.name}
              className="inline-flex items-center gap-2xs rounded-4xl bg-accent px-sm py-2xs text-label-sm text-muted-foreground"
              title={axis.values.join(" / ")}
            >
              {axis.name}
              <span className="text-foreground">{axis.values.length}</span>
            </span>
          ))}
          {entry.deviation ? (
            <span className="text-body-sm text-muted-foreground">
              {entry.deviation}
            </span>
          ) : null}
        </span>
      }
    >
      {entry.render()}
    </Section>
  );
}

function Stats({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-md lg:grid-cols-5">{children}</div>
  );
}

/**
 * 出处标签。来源枚（shadcn / vxture）用中性语气，性质枚（origin / patterns…）
 * 用语气色：`vxture` 走 ai 色，是"我们改过这里"的提示，要比"照抄上游"更容易被扫到。
 */
const TAG_TONE: Record<Provenance, "neutral" | "brand" | "info" | "warning"> = {
  shadcn: "neutral",
  origin: "neutral",
  vxture: "brand",
  component: "info",
  patterns: "info",
  pending: "warning",
};

function Tags({ tags }: { readonly tags: readonly Provenance[] }) {
  return (
    <>
      {tags.map((t) => (
        <StatusBadge key={t} tone={TAG_TONE[t]}>
          {t}
        </StatusBadge>
      ))}
    </>
  );
}

function Stat({
  value,
  label,
  note,
  tone = "default",
}: {
  readonly value: number;
  readonly label: string;
  readonly note?: React.ReactNode;
  readonly tone?: "default" | "warning";
}) {
  return (
    <div className="flex flex-col gap-2xs rounded-lg border border-border bg-card p-lg shadow-flat">
      <span
        className={
          tone === "warning"
            ? "text-heading-1 text-warning-text"
            : "text-heading-1 text-foreground"
        }
      >
        {value}
      </span>
      <span className="text-label-md text-foreground">{label}</span>
      {note ? (
        <span className="flex flex-wrap items-center gap-2xs text-body-sm text-muted-foreground">
          {note}
        </span>
      ) : null}
    </div>
  );
}
