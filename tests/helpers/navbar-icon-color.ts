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

const SHAPES = ["path", "circle", "rect", "ellipse", "polygon", "polyline", "line", "text"];

// Display values Tailwind's `dark:` variant can switch an element back on with.
const DARK_SHOW =
  /^dark:(block|inline|inline-block|flex|inline-flex|grid|inline-grid|contents|table)$/;

// Which theme an element is shown in, from its class list: "light" for
// `dark:hidden`, "dark" for `hidden` plus a `dark:` display, and null for an
// element shown in both. Hextra prefixes its utilities with `hx:`.
export function themeOnly(cls: string): "light" | "dark" | null {
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

function stylePaint(tag: string, prop: "fill" | "stroke"): string | null {
  const style = attr(tag, "style");
  if (!style) return null;
  const m = style.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "i"));
  return m ? m[1].trim() : null;
}

function paint(tag: string, prop: "fill" | "stroke"): string | null {
  return stylePaint(tag, prop) ?? attr(tag, prop);
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

// Each <svg> in the navbar, with the label of the <a>/<button> it sits in and
// the theme it is shown in. A site can draw an icon twice, one copy per theme,
// for example a black GitHub mark under `hx:dark:hidden` and a white one under
// `hx:hidden hx:dark:inline-block` (kgateway.dev and agentgateway.dev do). Each
// copy is right for the only background it is ever shown on, so `theme` records
// that, from the classes on the <svg> or any element around it.
//
// parse5 rather than a tag scan, because finding the elements an <svg> sits in
// means matching open and close tags, and the navbar can hold comments, inline
// scripts, and void elements.
export function navbarSvgs(
  nav: string,
): { svg: string; label: string; theme: "light" | "dark" | null }[] {
  const out: { svg: string; label: string; theme: "light" | "dark" | null }[] = [];
  const walk = (node: Node, ancestors: Node[]) => {
    if (node.tagName === "svg") {
      const chain = [...ancestors, node];
      const owner = [...ancestors].reverse().find((a) => a.tagName === "a" || a.tagName === "button");
      const label =
        (owner && (nodeAttr(owner, "title") ?? nodeAttr(owner, "aria-label"))) || "(unlabeled)";
      const theme =
        chain.map((a) => themeOnly(nodeAttr(a, "class") ?? "")).find((t) => t !== null) ?? null;
      out.push({ svg: serializeOuter(node as never), label, theme });
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

export function svgProblems(svg: string): string[] {
  const problems: string[] = [];
  const tags = svg.match(/<[a-z][^>]*>/gi) ?? [];
  const root = tags[0] ?? "";

  for (const tag of tags) {
    const name = (tag.match(/^<([a-z]+)/i) ?? [])[1]?.toLowerCase() ?? "";
    for (const prop of ["fill", "stroke"] as const) {
      const v = paint(tag, prop);
      if (v !== null && !SAFE_PAINT.test(v)) {
        problems.push(`<${name}> has hardcoded ${prop}="${v}"`);
      }
    }
  }

  // No fill anywhere up the chain means SVG's initial fill: black. Only a
  // <g fill> or the root can supply one; a <g> with a fill is treated as
  // covering every shape, which is lenient but keeps this a tag scan.
  const rootFill = paint(root, "fill");
  const groupFill = tags.some((t) => /^<g[\s>]/i.test(t) && paint(t, "fill") !== null);
  if (rootFill === null && !groupFill) {
    const unfilled = tags.filter((t) => {
      const name = (t.match(/^<([a-z]+)/i) ?? [])[1]?.toLowerCase() ?? "";
      return SHAPES.includes(name) && paint(t, "fill") === null;
    });
    if (unfilled.length > 0) {
      problems.push(
        `${unfilled.length} shape(s) with no fill on them or on the <svg>, so they paint black; add fill="currentColor"`,
      );
    }
  }
  return problems;
}

export function navbarIconProblems(html: string): IconProblem[] {
  const nav = navbarHtml(html);
  if (!nav) return [];
  const out: IconProblem[] = [];
  for (const { svg, label, theme } of navbarSvgs(nav)) {
    // An icon shown in one theme only is never seen on the other background,
    // so it may use a fixed color.
    if (theme) continue;
    for (const reason of svgProblems(svg)) out.push({ label, reason });
  }
  return out;
}
