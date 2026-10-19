import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { TEST_PRODUCT_ROOT } from "./helpers/fixture";
import { target } from "./helpers/target";

// Guards the markup of the render shortcode's changelog toolbar
// (layouts/_shortcodes/render.html). changelog-toolbar-style.spec.ts checks
// how it looks in a browser.
//
// The contract that matters most is not in this repo: the docs hub's
// static/changelog/render_changelog.js binds to #solodocs-select-type and
// #solodocs-showOpenSource, and its renderers switch on the three option
// values. Rename either id or change a value and every Gloo Gateway changelog
// page stops re-rendering, with nothing failing at build time. So the ids and
// values are asserted exactly.
//
// The rest guards the 0.3.20 fix: the controls sit in one .changelog-toolbar,
// each inside its own <label>, with no inline styles. The old wrapper was a
// bare `display:flex` div and the checkbox had percentage margins.
// Fixture-only; server-rendered markup read statically.

const IS_FIXTURE_TARGET = target.name.startsWith("docs-theme-extras-fixture");

function builtPage(slug: string): string {
  const file = path.join(TEST_PRODUCT_ROOT, "v2", slug, "index.html");
  expect(fs.existsSync(file), `fixture page not built: ${file}`).toBe(true);
  return fs.readFileSync(file, "utf8");
}

/** The toolbar's outer HTML: from its opening tag to the changelog container. */
function toolbar(html: string): string {
  const start = html.indexOf('<div class="changelog-toolbar">');
  const end = html.indexOf('<div id="solodocs-changelogdiv">', start);
  expect(start, "toolbar missing").toBeGreaterThan(-1);
  expect(end, "#solodocs-changelogdiv missing after the toolbar").toBeGreaterThan(start);
  return html.slice(start, end);
}

test.describe("changelog toolbar markup", () => {
  test.skip(!IS_FIXTURE_TARGET, "fixture-only: reads built fixture pages");

  test("one toolbar, followed by the changelog container", () => {
    const html = builtPage("changelog-render");
    expect(html.split('class="changelog-toolbar"').length - 1, "toolbar count").toBe(1);
    toolbar(html);
  });

  test("the view selector keeps the id and option values render_changelog.js uses", () => {
    const bar = toolbar(builtPage("changelog-render"));
    expect(bar).toContain('id="solodocs-select-type"');
    const values = [...bar.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
    expect(values).toEqual(["minorrelease", "chronological", "compareversions"]);
  });

  test("the selector sits in a label with visible text", () => {
    // A visible label is half of the fix: the selector used to sit alone with
    // nothing saying what it did.
    const bar = toolbar(builtPage("changelog-render"));
    expect(bar).toMatch(
      /<label class="changelog-toolbar-field" for="solodocs-select-type">\s*<span class="changelog-toolbar-label">View<\/span>\s*<select [^>]*id="solodocs-select-type"/,
    );
  });

  test("enterprise=\"true\" adds the checkbox, checked, inside its label", () => {
    const bar = toolbar(builtPage("changelog-render"));
    expect(bar).toMatch(
      /<label class="changelog-toolbar-check" for="solodocs-showOpenSource">\s*<input type="checkbox" [^>]*id="solodocs-showOpenSource"[^>]* checked>\s*Show open source notes\s*<\/label>/,
    );
  });

  test("without enterprise, there is no checkbox", () => {
    const bar = toolbar(builtPage("changelog-render-oss"));
    expect(bar).toContain('id="solodocs-select-type"');
    expect(bar).not.toContain("solodocs-showOpenSource");
    expect(bar).not.toContain("changelog-toolbar-check");
  });

  test("no inline styles; the layout comes from the stylesheet", () => {
    // The old markup placed the checkbox with `margin-top: 0.5%; margin-left: 5%`,
    // which moved with the page width.
    for (const slug of ["changelog-render", "changelog-render-oss"]) {
      expect(toolbar(builtPage(slug)), slug).not.toContain("style=");
    }
  });
});
