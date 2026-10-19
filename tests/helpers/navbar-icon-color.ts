// Finds navbar SVG icons whose color can't follow the theme: a hardcoded
// fill/stroke, or a shape with no fill at all (SVG paints that black). Either
// way the icon looks the same in light and dark mode, so on one of them it sits
// dark-on-dark or light-on-light.
//
// Static on purpose: it reads built HTML and needs no browser, so it can run in
// a consumer's per-product content job against the REAL build. That build is
// the one that matters. site.Data.icons is merged from every module and mount,
// so an icon key from an imported OSS site can replace the theme's, and only a
// real build shows which icon actually won.

import { parseFragment, serializeOuter } from "parse5";

// Paint values that inherit or opt out, and so follow the theme.
const SAFE_PAINT = /^(currentcolor|none|inherit|transparent)$/i;

// Fixed colors that vanish on one theme's background: black on the dark navbar,
// white on the light one. Only the literal spellings, so a theme-only icon in
// any other color passes; telling "dark enough" from "light enough" is a guess.
const BLACK_PAINT = /^(black|#000|#000000|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\))$/i;
const WHITE_PAINT = /^(white|#fff|#ffffff|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))$/i;

const SHAPES = ["path", "circle", "rect", "ellipse", "polygon", "polyline", "line", "text"];

// Display values Tailwind's `dark:` variant can switch an element back on with.
const DARK_SHOW =
  /^dark:(block|inline|inline-block|flex|inline-flex|grid|inline-grid|contents|table)$/;

// Which theme an element is shown in, from its class list: "light" for
// `dark:hidden`, "dark" for `hidden` plus a `dark:` display, and null for an
// element shown in both. Hextra prefixes its utilities with `hx:`.
export function themeOnly(cls: string): Theme | null {
  const tokens = cls
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/^hx:/, ""));
  if (tokens.includes("dark:hidden")) return "light";
  if (tokens.includes("hidden") && tokens.some((t) => DARK_SHOW.test(t))) return "dark";
  return null;
}

export type IconProblem = {
  label: string; // the enclosing link's title, or "(unlabeled)"
  reason: string;
};

// The site navbar: the first <nav> on the page, which is the header.
export function navbarHtml(html: string): string | null {
  const start = html.search(/<nav[\s>]/i);
  if (start < 0) return null;
  const end = html.indexOf("</nav>", start);
  return end < 0 ? null : html.slice(start, end);
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  if (!m) return null;
  return (m[2] ?? m[3] ?? m[4] ?? "").trim();
}

type Prop = "fill" | "stroke";

// A fill or stroke and where it came from, for the message. `class` names the
// utility, since that is what the author has to find in the template.
type Paint = { value: string; from?: string };

function stylePaint(tag: string, prop: Prop): Paint | null {
  const style = attr(tag, "style");
  if (!style) return null;
  const m = style.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "i"));
  return m ? { value: m[1].replace(/!important/i, "").trim() } : null;
}

// Tailwind's default palette. `fill-white` and `fill-gray-500` are fixed colors;
// any other name, such as kgateway.dev's `fill-secondary-link`, is a color the
// site defines in its own theme, which can switch with dark mode, so it is
// trusted like `currentColor`.
const TAILWIND_PALETTE = new Set(
  "slate gray zinc neutral stone red orange amber yellow lime green emerald teal cyan sky blue indigo violet purple fuchsia pink rose".split(
    " ",
  ),
);

// Stands for a paint the site's own CSS sets, which this check cannot see.
const SITE_PAINT = "currentColor";

// Tailwind's paint utilities, with or without Hextra's `hx:` prefix.
// agentgateway.dev draws its GitHub icon as `<svg class="w-5 h-5 fill-current">`,
// which is `fill: currentColor`. A `dark:` paint utility on the same element
// (`fill-black dark:fill-white`) switches with the theme, so the element counts
// as theme-following. Other variants (`hover:`, `md:`, `[&_circle]:`) are left
// alone. This trusts the site's CSS to define the class, which a build that
// compiles Tailwind from its templates does.
function classPaint(tag: string, prop: Prop): Paint | null {
  const tokens = (attr(tag, "class") ?? "").split(/\s+/).map((t) => t.replace(/^hx:/, ""));
  if (tokens.some((t) => t.startsWith(`dark:${prop}-`))) return { value: SITE_PAINT };
  for (const t of tokens) {
    if (!t.startsWith(`${prop}-`)) continue;
    const name = t.slice(prop.length + 1);
    const from = `class "${t}"`;
    if (name === "current") return { value: "currentColor" };
    if (name === "none" || name === "inherit" || name === "transparent") return { value: name };
    const arbitrary = name.match(/^\[(.+)\]$/);
    if (arbitrary) {
      const v = arbitrary[1].replace(/_/g, " ");
      // `stroke-[2px]` and `stroke-[length:var(--w)]` set the stroke width.
      if (/^(length:|number:)/i.test(v) || /^[\d.]+[a-z%]*$/i.test(v)) continue;
      return { value: v.replace(/^color:/i, ""), from };
    }
    // `stroke-2` is a stroke width too.
    if (/^\d/.test(name)) continue;
    const base = name.replace(/\/.*$/, ""); // drop an opacity modifier: `fill-white/50`
    if (base === "black" || base === "white") return { value: base, from };
    if (TAILWIND_PALETTE.has(base.replace(/-\d+$/, ""))) return { value: base, from };
    return { value: SITE_PAINT };
  }
  return null;
}

// The order the browser applies them in: an inline style beats a stylesheet
// rule, which beats a presentation attribute. So `<svg fill="#000"
// class="fill-current">` renders in currentColor.
function paint(tag: string, prop: Prop): Paint | null {
  const a = attr(tag, prop);
  return stylePaint(tag, prop) ?? classPaint(tag, prop) ?? (a === null ? null : { value: a });
}

function paintNote(p: Paint): string {
  return p.from ? ` (from ${p.from})` : "";
}

type Node = {
  nodeName: string;
  tagName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: Node[];
  content?: Node;
};

function nodeAttr(node: Node, name: string): string | null {
  return node.attrs?.find((a) => a.name === name)?.value ?? null;
}

export type Theme = "light" | "dark";

// The fill and stroke an <svg> inherits from the HTML around it. Both are
// inherited CSS properties, so `<a class="fill-current"><svg>` paints in
// currentColor. Only CSS counts here: a `fill` attribute on an HTML element
// does nothing.
export type Inherited = { fill: Paint | null; stroke: Paint | null };

const NOTHING_INHERITED: Inherited = { fill: null, stroke: null };

export type NavbarSvg = {
  svg: string;
  label: string; // the enclosing link's title, or "(unlabeled)"
  theme: Theme | null; // the only theme the icon is shown in, or null for both
  inherited: Inherited;
};

// An element's start tag rebuilt from parse5's attributes, for the tag readers.
function startTag(node: Node): string {
  const attrs = (node.attrs ?? []).map((a) => ` ${a.name}="${a.value.replace(/"/g, "&quot;")}"`);
  return `<${node.tagName}${attrs.join("")}>`;
}

function inheritedPaint(ancestors: Node[]): Inherited {
  const nearest = (prop: Prop): Paint | null => {
    for (const a of [...ancestors].reverse()) {
      const tag = startTag(a);
      const p = stylePaint(tag, prop) ?? classPaint(tag, prop);
      if (p) return p.from ? { ...p, from: `${p.from} on <${a.tagName}>` } : p;
    }
    return null;
  };
  return { fill: nearest("fill"), stroke: nearest("stroke") };
}

// Each <svg> in the navbar, with the label of the <a>/<button> it sits in and
// the theme it is shown in. A site can draw an icon twice, one copy per theme,
// for example a black GitHub mark under `hx:dark:hidden` and a white one under
// `hx:hidden hx:dark:inline-block`, as kgateway.dev does. Each copy only has to
// suit the one background it is shown on, so `theme` records which, from the
// classes on the <svg> or any element around it.
//
// parse5 rather than a tag scan, because finding the elements an <svg> sits in
// means matching open and close tags, and the navbar can hold comments, inline
// scripts, and void elements.
export function navbarSvgs(nav: string): NavbarSvg[] {
  const out: NavbarSvg[] = [];
  const walk = (node: Node, ancestors: Node[]) => {
    if (node.tagName === "svg") {
      const chain = [...ancestors, node];
      const owner = [...ancestors].reverse().find((a) => a.tagName === "a" || a.tagName === "button");
      const label =
        (owner && (nodeAttr(owner, "title") ?? nodeAttr(owner, "aria-label"))) || "(unlabeled)";
      const theme =
        chain.map((a) => themeOnly(nodeAttr(a, "class") ?? "")).find((t) => t !== null) ?? null;
      const inherited = inheritedPaint(ancestors.filter((a) => a.tagName));
      out.push({ svg: serializeOuter(node as never), label, theme, inherited });
      return;
    }
    if (node.tagName === "script" || node.tagName === "style") return;
    const next = node.tagName ? [...ancestors, node] : ancestors;
    for (const child of node.childNodes ?? []) walk(child, next);
    if (node.content) walk(node.content, next);
  };
  walk(parseFragment(nav) as unknown as Node, []);
  return out;
}

function tagName(tag: string): string {
  return (tag.match(/^<([a-z]+)/i) ?? [])[1]?.toLowerCase() ?? "";
}

type Found = { name: string; prop: Prop; paint: Paint; inherited?: boolean };

// Shapes that set no `prop` on themselves, the root, or a <g>. A <g> with the
// prop is treated as covering every shape, which is lenient but keeps this a
// tag scan.
function uncovered(tags: string[], prop: Prop): number {
  const covered =
    paint(tags[0] ?? "", prop) !== null || tags.some((t) => /^<g[\s>]/i.test(t) && paint(t, prop) !== null);
  if (covered) return 0;
  return tags.filter((t) => SHAPES.includes(tagName(t)) && paint(t, prop) === null).length;
}

// Every fill/stroke the icon sets, on any element, plus what it inherits from
// the HTML around it where that reaches a shape.
function paints(tags: string[], inherited: Inherited): Found[] {
  const out: Found[] = [];
  for (const tag of tags) {
    for (const prop of ["fill", "stroke"] as const) {
      const p = paint(tag, prop);
      if (p !== null) out.push({ name: tagName(tag), prop, paint: p });
    }
  }
  for (const prop of ["fill", "stroke"] as const) {
    const p = inherited[prop];
    if (p && uncovered(tags, prop) > 0) out.push({ name: "svg", prop, paint: p, inherited: true });
  }
  return out;
}

// No fill on a shape, the root, a <g>, or the HTML around the icon means SVG's
// initial fill: black.
function unfilledShapes(tags: string[], inherited: Inherited): number {
  return inherited.fill ? 0 : uncovered(tags, "fill");
}

function svgTags(svg: string): string[] {
  return svg.match(/<[a-z][^>]*>/gi) ?? [];
}

function hardcoded(f: Found): string {
  const verb = f.inherited ? "inherits" : "has";
  return `<${f.name}> ${verb} hardcoded ${f.prop}="${f.paint.value}"${paintNote(f.paint)}`;
}

// An icon shown in both themes: every paint must follow the theme.
export function svgProblems(svg: string, inherited: Inherited = NOTHING_INHERITED): string[] {
  const tags = svgTags(svg);
  const problems = paints(tags, inherited)
    .filter((f) => !SAFE_PAINT.test(f.paint.value))
    .map(hardcoded);
  const unfilled = unfilledShapes(tags, inherited);
  if (unfilled > 0) {
    problems.push(
      `${unfilled} shape(s) with no fill on them or on the <svg>, so they paint black; add fill="currentColor"`,
    );
  }
  return problems;
}

// An icon shown in one theme only may use a fixed color, but not the one that
// disappears on that theme's background: black (set, or by having no fill) on
// dark, or white on light. The likely slip is copying a black/white pair and
// leaving the white copy without its fill.
export function themeOnlySvgProblems(
  svg: string,
  theme: Theme,
  inherited: Inherited = NOTHING_INHERITED,
): string[] {
  const tags = svgTags(svg);
  const [bad, color] = theme === "dark" ? [BLACK_PAINT, "black"] : [WHITE_PAINT, "white"];
  const problems = paints(tags, inherited)
    .filter((f) => bad.test(f.paint.value))
    .map(
      (f) =>
        `<${f.name}> ${f.inherited ? "inherits" : "has"} ${f.prop}="${f.paint.value}"${paintNote(f.paint)}, which is ${color} on the ${theme} navbar it is shown on`,
    );
  if (theme === "dark") {
    const unfilled = unfilledShapes(tags, inherited);
    if (unfilled > 0) {
      problems.push(
        `${unfilled} shape(s) with no fill, so they paint black on the dark navbar this copy is shown on; add a fill`,
      );
    }
  }
  return problems;
}

export function navbarIconProblems(html: string): IconProblem[] {
  const nav = navbarHtml(html);
  if (!nav) return [];
  const out: IconProblem[] = [];
  for (const { svg, label, theme, inherited } of navbarSvgs(nav)) {
    const problems = theme ? themeOnlySvgProblems(svg, theme, inherited) : svgProblems(svg, inherited);
    for (const reason of problems) out.push({ label, reason });
  }
  return out;
}
