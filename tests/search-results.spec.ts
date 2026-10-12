import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { target } from "./helpers/target";

// End-to-end search behavior in assets/js/flexsearch.js. search-visible-versions
// covers the version set the bundle is BUILT with; this covers what a reader sees
// after typing into the box.
//
// WHY THIS EXISTS. On agentgateway.dev (2,805 pages across 10 version trees in one
// 18.5 MB search-data.json) typing into search froze the page and then showed
// "No results found" for every query. Three causes; only the first is asserted
// here:
//
//   1. A keyup that fired while the index was still loading searched the empty
//      index, rendered "No results found", and never re-ran once it loaded.
//   2. Every version tree was indexed, including versions the results filter
//      hides anyway, which blocked the main thread for 3+ seconds on first focus.
//   3. The per-page section lookup passed no `limit`, and FlexSearch applies the
//      default of 100 across the whole index before narrowing to the page's tag,
//      so every page past the first hundred matching sections came back empty.
//      The fixture is too small to reach that threshold.
//
// Causes 2 and 3 were verified against the production agentgateway.dev bundle
// instead. The fixture cannot show cause 2 at all: `getVersionFromURL` only
// recognizes `main`, `latest`, `next`, and `N.N`-style segments, so the
// fixture's `v1`/`v2`/`v8-link` trees all read as unversioned and the version
// filter never engages here.

const IS_FIXTURE_TARGET = target.name.startsWith("docs-theme-extras-fixture");
const PAGE = "/test/v2/everything/";

function pageBuilt(): boolean {
  try {
    return fs.existsSync(target.fileForUrl(PAGE));
  } catch {
    return false;
  }
}

test.describe("search results", () => {
  test.skip(!IS_FIXTURE_TARGET, "names fixture pages and versions");
  test.skip(!pageBuilt(), `${PAGE} is not in this build`);

  test.beforeEach(async ({ page }) => {
    // Hold the index back so every keystroke below lands before it loads. On a
    // fixture this small the fetch would otherwise race the typing, and the
    // regression in cause 1 would only show up some of the time.
    await page.route(/search-data[^/]*\.json$/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.continue();
    });
    await page.goto(PAGE);
  });

  test("a query typed while the index loads still renders results", async ({ page }) => {
    const input = page.locator(".hextra-search-input:visible").first();
    await input.click();
    await input.pressSequentially("everything");

    const results = page.locator(".hextra-search-results:visible");
    await expect(
      results.locator('a[href*="/v2/everything/"]').first(),
      "the current version's page never showed up: the keyups that fired before " +
        "the index loaded searched an empty index and nothing re-ran afterwards",
    ).toBeVisible({ timeout: 10_000 });
    await expect(results.locator(".hextra-search-no-result")).toHaveCount(0);
  });
});
