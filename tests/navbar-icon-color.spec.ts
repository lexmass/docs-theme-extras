import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { navbarHtml, navbarIconProblems, navbarSvgs, svgProblems } from "./helpers/navbar-icon-color";
import { target } from "./helpers/target";

// Navbar icons must take their color from the theme.
//
// The docs hub's agentgateway navbar showed a black GitHub icon on the dark
// navbar. The icon came from agentgateway.dev's data/icons.yaml, which the hub
// mounts, and it replaced Hextra's `github` key. That icon has no `fill`, so it
// painted black in both themes. The theme, fixture, and every other spec were
// fine: only the real product build had the leaked icon.
//
// So this is a content-project spec. It reads the consumer's built HTML (one
// product per job on the hub) and checks every <svg> in the navbar:
//   - no hardcoded fill/stroke (only currentColor, none, inherit, transparent)
//   - no shape left with no fill at all, since SVG paints that black
// An icon shown in one theme only (a `dark:hidden` copy and a
// `hidden dark:inline-block` copy, as kgateway.dev draws its GitHub icon) may
// use a fixed color, but not black on dark (set, or by having no fill) or
// white on light.
//
// The navbar comes from the same menu and icon data on every page of a build,
// so a sample of pages is enough and keeps this fast on large builds.

const ENABLED = target.shouldRun("navbarIconColor");
const SAMPLE = 40;

// ── Unit tests on the helper ────────────────────────────────────────

test.describe("navbar-icon-color helper", () => {
  test("currentColor fill and stroke icons pass", () => {
    expect(svgProblems(`<svg fill="currentColor" viewBox="0 0 24 24"><path d="M0"/></svg>`)).toEqual([]);
    expect(
      svgProblems(`<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M0"/></svg>`),
    ).toEqual([]);
    expect(svgProblems(`<svg viewBox="0 0 24 24"><path fill="currentColor" d="M0"/></svg>`)).toEqual([]);
  });

  test("an unfilled shape is flagged, because SVG paints it black", () => {
    // The leaked agentgateway.dev / kgateway.dev `github` icon, trimmed.
    const leaked = `<svg height=24 width="98" height="96" viewBox="0 0 98 96"><path fill-rule="evenodd" d="M48"/></svg>`;
    expect(svgProblems(leaked)).toHaveLength(1);
    expect(svgProblems(leaked)[0]).toMatch(/paint black/);
  });

  test("hardcoded colors are flagged, in attributes and style", () => {
    expect(svgProblems(`<svg fill="#000"><path d="M0"/></svg>`)).toHaveLength(1);
    expect(svgProblems(`<svg fill="currentColor"><path style="fill: white" d="M0"/></svg>`)).toHaveLength(1);
    expect(svgProblems(`<svg fill="none"><path stroke="black" d="M0"/></svg>`)).toHaveLength(1);
  });

  test("a <g> fill covers its shapes", () => {
    expect(svgProblems(`<svg viewBox="0 0 1 1"><g fill="currentColor"><path d="M0"/></g></svg>`)).toEqual([]);
  });

  test("Tailwind's fill-current and stroke-current classes count as currentColor", () => {
    // agentgateway.dev's navbar GitHub icon, trimmed.
    expect(svgProblems(`<svg class="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M12"/></svg>`)).toEqual([]);
    expect(svgProblems(`<svg class="hx:fill-none hx:stroke-current"><path d="M0"/></svg>`)).toEqual([]);
  });

  test("Tailwind palette colors are hardcoded; a site's own color names are trusted", () => {
    expect(svgProblems(`<svg class="fill-white"><path d="M0"/></svg>`)).toEqual([
      `<svg> has hardcoded fill="white" (from class "fill-white")`,
    ]);
    expect(svgProblems(`<svg class="hx:fill-gray-500/50"><path d="M0"/></svg>`)).toEqual([
      `<svg> has hardcoded fill="gray-500" (from class "fill-gray-500/50")`,
    ]);
    // kgateway.dev's templates use `fill-secondary-link`, a color from its own theme.
    expect(svgProblems(`<svg class="fill-secondary-link"><path d="M0"/></svg>`)).toEqual([]);
  });

  test("a dark: paint class switches with the theme", () => {
    expect(svgProblems(`<svg class="fill-black dark:fill-white"><path d="M0"/></svg>`)).toEqual([]);
    expect(svgProblems(`<svg fill="#000" class="hx:dark:fill-white"><path d="M0"/></svg>`)).toEqual([]);
    // Other variants are states, not themes.
    expect(svgProblems(`<svg class="fill-black hover:fill-white"><path d="M0"/></svg>`)).toHaveLength(1);
  });

  test("a class beats a fill attribute, and an inline style beats both, as in the browser", () => {
    expect(svgProblems(`<svg fill="#000" class="fill-current"><path d="M0"/></svg>`)).toEqual([]);
    expect(svgProblems(`<svg class="fill-current" style="fill: #000"><path d="M0"/></svg>`)).toEqual([
      `<svg> has hardcoded fill="#000"`,
    ]);
  });

  test("an arbitrary Tailwind color is reported as the hardcoded color, not as unfilled", () => {
    expect(svgProblems(`<svg class="hx:fill-[#4a154b]"><path d="M0"/></svg>`)).toEqual([
      `<svg> has hardcoded fill="#4a154b" (from class "fill-[#4a154b]")`,
    ]);
    expect(svgProblems(`<svg class="fill-[color:#fff]"><path d="M0"/></svg>`)).toEqual([
      `<svg> has hardcoded fill="#fff" (from class "fill-[color:#fff]")`,
    ]);
    expect(svgProblems(`<svg class="fill-[currentColor]"><path d="M0"/></svg>`)).toEqual([]);
    // These set the stroke width, not its color.
    for (const width of ["stroke-[2px]", "stroke-[1.5]", "stroke-[length:var(--w)]", "stroke-2"]) {
      expect(svgProblems(`<svg fill="none" stroke="currentColor" class="${width}"><path d="M0"/></svg>`)).toEqual([]);
    }
  });

  test("fill-rule is not mistaken for fill", () => {
    expect(svgProblems(`<svg fill="currentColor"><path fill-rule="evenodd" d="M0"/></svg>`)).toEqual([]);
  });

  test("only the first <nav> is scanned, and icons are labeled by their link", () => {
    const html =
      `<nav><a href="/" title="GitHub"><svg><path d="M0"/></svg></a></nav>` +
      `<nav class="sidebar"><svg fill="red"></svg></nav>`;
    expect(navbarIconProblems(html)).toEqual([
      { label: "GitHub", reason: expect.stringMatching(/paint black/) },
    ]);
  });

  // kgateway.dev draws the GitHub icon twice: black for the light theme, white
  // for the dark one. Each copy is only ever shown on the
  // background it was drawn for. Trimmed from kgateway.dev's built navbar.
  const pair =
    `<nav><a href="https://github.com/kgateway-dev" title="GitHub">` +
    `<span class="hx:inline-block hx:dark:hidden"><svg height=24 viewBox="0 0 98 96"><path fill-rule="evenodd" d="M48"/></svg></span>` +
    `<span class="hx:hidden hx:dark:inline-block github-white-icon"><svg height=24 viewBox="0 0 98 96"><path fill="#fff" d="M48"/></svg></span>` +
    `</a></nav>`;

  test("a light/dark pair of fixed-color icons passes", () => {
    expect(navbarIconProblems(pair)).toEqual([]);
  });

  test("each copy of the pair is tagged with its theme", () => {
    const nav = navbarHtml(pair)!;
    expect(navbarSvgs(nav).map((s) => [s.label, s.theme])).toEqual([
      ["GitHub", "light"],
      ["GitHub", "dark"],
    ]);
  });

  test("theme classes count on the <svg> itself and without the hx: prefix", () => {
    expect(
      navbarIconProblems(`<nav><a title="X"><svg class="dark:hidden"><path d="M0"/></svg></a></nav>`),
    ).toEqual([]);
    expect(
      navbarIconProblems(
        `<nav><a title="X"><div class="hidden dark:block"><span><svg><path fill="#fff" d="M0"/></svg></span></div></a></nav>`,
      ),
    ).toEqual([]);
  });

  test("hiding by breakpoint is not hiding by theme", () => {
    // Shown in both themes from md up, so it must still follow the theme.
    const html = `<nav><a title="GitHub"><span class="hx:hidden hx:md:inline-block"><svg><path d="M0"/></svg></span></a></nav>`;
    expect(navbarIconProblems(html)).toEqual([
      { label: "GitHub", reason: expect.stringMatching(/paint black/) },
    ]);
  });

  test("a dark-only copy with no fill is flagged, since it paints black on dark", () => {
    // The pair with the white copy's fill left off.
    expect(navbarIconProblems(pair.replace(` fill="#fff"`, ""))).toEqual([
      { label: "GitHub", reason: expect.stringMatching(/paint black on the dark navbar/) },
    ]);
  });

  test("a theme-only copy in the color that vanishes on its background is flagged", () => {
    const dark = `<nav><a title="X"><span class="hidden dark:block"><svg fill="#000"><path d="M0"/></svg></span></a></nav>`;
    const light = `<nav><a title="X"><svg class="hx:dark:hidden"><path fill="white" d="M0"/></svg></a></nav>`;
    expect(navbarIconProblems(dark)).toEqual([
      { label: "X", reason: `<svg> has fill="#000", which is black on the dark navbar it is shown on` },
    ]);
    expect(navbarIconProblems(light)).toEqual([
      { label: "X", reason: `<path> has fill="white", which is white on the light navbar it is shown on` },
    ]);
    // Any other fixed color passes: only the literal black and white are known to vanish.
    expect(
      navbarIconProblems(`<nav><a title="X"><span class="hidden dark:block"><svg fill="#333"><path d="M0"/></svg></span></a></nav>`),
    ).toEqual([]);
  });

  test("a fill set on the HTML around the icon is inherited", () => {
    // CSS fill inherits from HTML parents into an inline <svg>.
    expect(
      navbarIconProblems(`<nav><a title="X" class="fill-current"><svg><path d="M0"/></svg></a></nav>`),
    ).toEqual([]);
    expect(
      navbarIconProblems(`<nav><a title="X"><span style="fill:#4a154b"><svg><path d="M0"/></svg></span></a></nav>`),
    ).toEqual([{ label: "X", reason: `<svg> inherits hardcoded fill="#4a154b"` }]);
    expect(
      navbarIconProblems(`<nav><a title="X"><span class="hidden dark:block fill-black"><svg><path d="M0"/></svg></span></a></nav>`),
    ).toEqual([
      {
        label: "X",
        reason: `<svg> inherits fill="black" (from class "fill-black" on <span>), which is black on the dark navbar it is shown on`,
      },
    ]);
    // An icon that fills its own shapes never shows the inherited fill.
    expect(
      navbarIconProblems(`<nav><a title="X" class="fill-white"><svg fill="currentColor"><path d="M0"/></svg></a></nav>`),
    ).toEqual([]);
    // A fill attribute on an HTML element does nothing.
    expect(
      navbarIconProblems(`<nav><a title="X" fill="currentColor"><svg><path d="M0"/></svg></a></nav>`),
    ).toEqual([{ label: "X", reason: expect.stringMatching(/paint black/) }]);
  });

  test("an icon outside the pair is still checked", () => {
    const html = pair.replace(
      "</a></nav>",
      `</a><a title="Slack"><svg><path fill="#4a154b" d="M0"/></svg></a></nav>`,
    );
    expect(navbarIconProblems(html)).toEqual([
      { label: "Slack", reason: `<path> has hardcoded fill="#4a154b"` },
    ]);
  });
});

// ── Scan the built site ─────────────────────────────────────────────

function htmlFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && e.name.endsWith(".html")) out.push(p);
    }
  }
  return out.sort();
}

test.describe("built navbar icons", () => {
  test.skip(!ENABLED, "navbarIconColor check disabled in CONFIG");

  const root = target.builtScanRoot;
  test.skip(!fs.existsSync(root), "builtScanRoot not built yet — run the Hugo build first");

  test("every navbar icon follows the theme color", () => {
    const files = htmlFiles(root);
    const step = Math.max(1, Math.floor(files.length / SAMPLE));
    const sample = files.filter((_, i) => i % step === 0).slice(0, SAMPLE);

    // label + reason → pages, so one bad icon reports once, not per page. A
    // Set, because the desktop row and the mobile drawer render each icon twice.
    const found = new Map<string, Set<string>>();
    let scanned = 0;
    for (const file of sample) {
      const problems = navbarIconProblems(fs.readFileSync(file, "utf8"));
      scanned++;
      for (const p of problems) {
        const key = `${p.label}: ${p.reason}`;
        const pages = found.get(key) ?? new Set<string>();
        pages.add(path.relative(root, file));
        found.set(key, pages);
      }
    }
    expect(scanned, `no HTML under ${root}`).toBeGreaterThan(0);

    const report = [...found].map(
      ([key, pages]) => `  ${key}\n    on ${pages.size} of ${scanned} sampled pages, e.g. ${[...pages][0]}`,
    );
    expect(
      report,
      `Navbar icons that stay one color in light and dark mode:\n${report.join("\n")}\n\n` +
        `The icon key probably comes from an imported site's data/icons.yaml. Give the ` +
        `<svg> fill="currentColor" (stroke icons: fill="none" stroke="currentColor"), ` +
        `or render it through utils/navbar-icon.html.`,
    ).toEqual([]);
  });
});
