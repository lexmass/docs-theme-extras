import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// layouts/sitemap.xml and layouts/sitemapindex.xml are COPIES of Hugo's
// embedded templates with one change: every URL goes through
// utils/abs-permalink.html. A copy stops tracking upstream silently. On a Hugo
// bump nothing fails; the module just keeps the old template's output.
//
// This spec makes the bump fail until the copies are re-synced. It reads the
// Hugo version CI pins (HUGO_VERSION in .github/workflows/test.yml) and checks,
// for each template:
//   1. the copy's header names that version;
//   2. tests/helpers/hugo-embedded/v<version>/<name> exists, a verbatim copy
//      of Hugo's embedded template at that version;
//   3. the copy, with its header comment, the `$host` line, and the
//      abs-permalink wrapper removed, is byte-identical to that file.
// So a Hugo bump fails at (1) and (2), and a hand edit to a copy beyond the
// sanctioned change fails at (3).
//
// Source-level only; tests/sitemap-absolute.spec.ts checks the built output.

const REPO = path.resolve(__dirname, "..");
const WORKFLOW = path.join(REPO, ".github", "workflows", "test.yml");
const TEMPLATES = ["sitemap.xml", "sitemapindex.xml"];

function ciHugoVersion(): string {
  const m = fs.readFileSync(WORKFLOW, "utf8").match(/^\s*HUGO_VERSION:\s*([0-9.]+)\s*$/m);
  expect(m, `no HUGO_VERSION in ${WORKFLOW}`).not.toBeNull();
  return m![1];
}

// Undo the sanctioned change, leaving what Hugo ships.
function unwrap(src: string): string {
  return src
    .replace(/\{\{- \/\*[\s\S]*?\*\/ -\}\}\n/, "")
    .replace(/\{\{- \$host := partial "utils\/prod-host\.html" \. \}\}\n/, "")
    .replace(
      /\{\{ partial "utils\/abs-permalink\.html" \(dict "url" (.+?) "host" \$host\) \}\}/g,
      "{{ $1 }}",
    );
}

test.describe("sitemap template copies match the Hugo version CI pins", () => {
  for (const name of TEMPLATES) {
    test(name, () => {
      const version = ciHugoVersion();
      const copy = fs.readFileSync(path.join(REPO, "layouts", name), "utf8");

      expect(
        copy,
        `layouts/${name} does not say it is a copy of Hugo v${version}. CI ` +
          `now pins Hugo ${version}: re-sync the copy (see its header) and ` +
          `update the version it names.`,
      ).toContain(`COPY of Hugo v${version}'s embedded ${name}`);

      const vendored = path.join(REPO, "tests", "helpers", "hugo-embedded", `v${version}`, name);
      expect(
        fs.existsSync(vendored),
        `missing ${path.relative(REPO, vendored)}. Vendor Hugo ${version}'s ` +
          `tpl/tplimpl/embedded/templates/${name} there, verbatim.`,
      ).toBe(true);

      expect(
        unwrap(copy),
        `layouts/${name} differs from Hugo ${version}'s template by more than ` +
          `the abs-permalink wrapper. Carry the upstream change into the copy, ` +
          `or, if the edit is deliberate, document it and teach unwrap() here.`,
      ).toBe(fs.readFileSync(vendored, "utf8"));
    });
  }
});
