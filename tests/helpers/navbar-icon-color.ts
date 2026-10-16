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

// Paint values that inherit or opt out, and so follow the theme.
const SAFE_PAINT = /^(currentcolor|none|inherit|transparent)$/i;

const SHAPES = ["path", "circle", "rect", "ellipse", "polygon", "polyline", "line", "text"];

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

// One <svg>…</svg> and the label of the <a>/<button> it sits in.
export function navbarSvgs(nav: string): { svg: string; label: string }[] {
  const out: { svg: string; label: string }[] = [];
  const re = /<svg[\s>][\s\S]*?<\/svg>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(nav))) {
    // The nearest <a>/<button> opened before the <svg> and not yet closed.
    const before = nav.slice(0, m.index).toLowerCase();
    const open = Math.max(before.lastIndexOf("<a "), before.lastIndexOf("<button "));
    const closed = Math.max(before.lastIndexOf("</a>"), before.lastIndexOf("</button>"));
    const owner = open > closed ? nav.slice(open, nav.indexOf(">", open) + 1) : "";
    const label = attr(owner, "title") ?? attr(owner, "aria-label") ?? "(unlabeled)";
    out.push({ svg: m[0], label });
  }
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
  for (const { svg, label } of navbarSvgs(nav)) {
    for (const reason of svgProblems(svg)) out.push({ label, reason });
  }
  return out;
}
