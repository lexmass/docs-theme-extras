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
// The fixture renders the partial through a probe shortcode
// (fixture/layouts/_shortcodes/test-status-badge-probe.html), because the real
// call site is a consumer's `docs/under-heading.html` override and the fixture
// cannot override module slots (see slot-order.spec.ts). The probe wrapper is
// always emitted, so "the badge is missing" can't pass because the whole probe
// vanished.
//
// Fixture-only; server-rendered markup read statically.

const IS_FIXTURE_TARGET = target.name.startsWith("docs-theme-extras-fixture");

function probePage(status: string): string {
  return path.join(TEST_PRODUCT_ROOT, "v2", `test-status-${status}`, "index.html");
}

/** The probe's inner HTML for a built page. Fails loudly when the probe is
 *  absent, so a renamed page or shortcode can't turn every check into a pass. */
function probeBody(status: string): string {
  const file = probePage(status);
  expect(fs.existsSync(file), `fixture page not built: ${file}`).toBe(true);
  const html = fs.readFileSync(file, "utf8");
  const m = html.match(
    new RegExp(`<div data-test-status-probe="${status}">([\\s\\S]*?)</div>`),
  );
  expect(m, `probe wrapper missing on test-status-${status}`).not.toBeNull();
  return m![1];
}

test.describe("doc-test Verified badge", () => {
  test.skip(!IS_FIXTURE_TARGET, "fixture-only: renders through a fixture probe");

  test("test_status: passed renders the badge with an accessible description", () => {
    const body = probeBody("passed");
    expect(body).toContain('class="test-status-badge test-status-passed"');
    expect(body).toContain(">Verified</span>");
    // The tooltip is the description screen readers get, and the badge takes
    // focus so keyboard users can open it. Both halves of the reference must
    // name the same id.
    expect(body).toContain('aria-describedby="test-status-tooltip"');
    expect(body).toMatch(/id="test-status-tooltip" role="tooltip">Code examples on this page/);
    expect(body).toContain('tabindex="0"');
  });

  test("test_status: failed renders nothing", () => {
    expect(probeBody("failed").trim()).toBe("");
  });

  test("no page without the probe renders a badge", () => {
    // The partial is opt-in. If it ever became a slot default, every fixture
    // page would sprout one, and this is where that shows up.
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (
          e.name.endsWith(".html") &&
          !full.includes(`${path.sep}test-status-`) &&
          fs.readFileSync(full, "utf8").includes('class="test-status-badge')
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
