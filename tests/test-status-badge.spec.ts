import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { TEST_PRODUCT_ROOT } from "./helpers/fixture";
import { target } from "./helpers/target";

// Guards components/test-status-badge.html, the doc-test "Verified" badge.
//
// The badge is gated on `test_status: passed` in front matter, which CI injects
// from doc-test results just before a production build. The gate is the whole
// contract: `failed` and `partial` are real values the inject script writes,
// and a page carrying either must NOT claim its examples were verified.
//
// docs/single.html calls the partial directly, inside the heading column, so
// the spec reads the badge where readers see it: after the `<h1>`, before the
// copy/context buttons. Fixture-only; server-rendered markup read statically.

const IS_FIXTURE_TARGET = target.name.startsWith("docs-theme-extras-fixture");

function builtPage(status: string): string {
  const file = path.join(TEST_PRODUCT_ROOT, "v2", `test-status-${status}`, "index.html");
  expect(fs.existsSync(file), `fixture page not built: ${file}`).toBe(true);
  return fs.readFileSync(file, "utf8");
}

const BADGE = 'class="test-status-badge';

test.describe("doc-test Verified badge", () => {
  test.skip(!IS_FIXTURE_TARGET, "fixture-only: reads built fixture pages");

  test("test_status: passed renders one badge, with an accessible description", () => {
    const html = builtPage("passed");
    expect(html.split(BADGE).length - 1, "badge count").toBe(1);
    expect(html).toContain('class="test-status-badge test-status-passed"');
    expect(html).toContain(">Verified</span>");
    // The tooltip is the description screen readers get, and the badge takes
    // focus so keyboard users can open it. Both halves of the reference must
    // name the same id.
    expect(html).toContain('aria-describedby="test-status-tooltip"');
    expect(html).toMatch(/id="test-status-tooltip" role="tooltip">Code examples on this page/);
    expect(html).toContain('tabindex="0"');
  });

  test("the badge sits in the heading column, after the h1 and before the buttons", () => {
    // Inside the heading column is what keeps the badge above the copy/context
    // buttons when the title area stacks on a narrow viewport.
    const html = builtPage("passed");
    const h1 = html.indexOf('<h1 class="hx:mb-0">');
    const badge = html.indexOf(BADGE);
    const buttons = html.indexOf('<div class="hx:flex hx:items-center hx:gap-2">', h1);
    expect(h1, "h1 missing").toBeGreaterThan(-1);
    expect(buttons, "button row missing").toBeGreaterThan(-1);
    expect(badge).toBeGreaterThan(h1);
    expect(badge).toBeLessThan(buttons);
  });

  test("test_status: failed renders nothing", () => {
    expect(builtPage("failed")).not.toContain(BADGE);
  });

  test("no page without test_status: passed renders a badge", () => {
    // The badge is built in, so a loosened gate would put it on every page.
    // This is where that shows up.
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (
          e.name.endsWith(".html") &&
          !full.includes(`${path.sep}test-status-passed${path.sep}`) &&
          fs.readFileSync(full, "utf8").includes(BADGE)
        )
          offenders.push(path.relative(target.builtRoot, full));
      }
    };
    walk(target.builtRoot);
    expect(offenders).toEqual([]);
  });

  test("the stylesheet ships the badge rules", () => {
    const css = path.join(TEST_PRODUCT_ROOT, "css", "docs-theme-extras.css");
    expect(fs.existsSync(css), `built stylesheet missing: ${css}`).toBe(true);
    const src = fs.readFileSync(css, "utf8");
    for (const sel of [".test-status-badge", ".test-status-tooltip", ".dark .test-status-passed"]) {
      expect(src, `${sel} missing from docs-theme-extras.css`).toContain(sel);
    }
  });
});
