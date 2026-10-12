import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { target } from "./helpers/target";

// End-to-end search behavior in assets/js/flexsearch.js. search-visible-versions
// covers the version set the bundle is BUILT with; this covers what a reader sees
// after typing into the box.
//
// WHY THIS EXISTS. On agentgateway.dev (2,805 pages across 10 version trees in one
// 18.5 MB search-data.json) typing into search froze the page and then showed
// "No results found" for every query. Three causes:
//
//   1. A keyup that fired while the index was still loading searched the empty
//      index, rendered "No results found", and never re-ran once it loaded.
//   2. Every version tree was indexed, including versions the results filter
//      hides anyway, which blocked the main thread for 3+ seconds on first focus.
//   3. The per-page section lookup passed no `limit`, and FlexSearch applies the
//      default of 100 across the whole index before narrowing to the page's tag,
//      so every page past the first hundred matching sections came back empty.
//      Separately, the page search capped candidates at `maxPageResults` (50)
//      BEFORE it preferred the current version, so other versions' copies and
//      blog posts filled the cap.
//
// The fixture is too small to show 2 or 3 on its own, and its `v1`/`v2` trees read
// as unversioned (`getVersionFromURL` only recognizes `main`, `latest`, `next`,
// and `N.N`-style segments). So the "large index" tests pad the real
// search-data.json in flight with probe pages, and run from the `main` tree,
// which IS recognized and is in the dropdown.
//
// Main-thread cost isn't asserted: it depends on the machine. Measured against
// the production agentgateway.dev bundle with the CPU throttled 4x, the longest
// task while typing "how to configure the gateway" was about 70 ms. Running one
// tagged section search per page instead took 18 seconds of main thread.

const IS_FIXTURE_TARGET = target.name.startsWith("docs-theme-extras-fixture");
const PAGE = "/test/v2/everything/";
const MAIN_PAGE = "/test/main/everything/";
const SEARCH_DATA = /search-data[^/]*\.json$/;

function built(url: string): boolean {
  try {
    return fs.existsSync(target.fileForUrl(url));
  } catch {
    return false;
  }
}

async function typeQuery(page: Page, query: string) {
  const input = page.locator(".hextra-search-input:visible").first();
  await input.click();
  await input.pressSequentially(query);
  return input;
}

test.describe("search results", () => {
  test.skip(!IS_FIXTURE_TARGET, "names fixture pages and versions");

  test.describe("index load", () => {
    test.skip(!built(PAGE), `${PAGE} is not in this build`);

    test("a query typed while the index loads still renders results", async ({ page }) => {
      // Hold the index back so every keystroke lands before it loads. On a
      // fixture this small the fetch would otherwise race the typing, and the
      // regression in cause 1 would only show up some of the time.
      await page.route(SEARCH_DATA, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await route.continue();
      });
      await page.goto(PAGE);
      await typeQuery(page, "everything");

      const results = page.locator(".hextra-search-results:visible");
      await expect(
        results.locator('a[href*="/v2/everything/"]').first(),
        "the current version's page never showed up: the keyups that fired before " +
          "the index loaded searched an empty index and nothing re-ran afterwards",
      ).toBeVisible({ timeout: 10_000 });
      await expect(results.locator(".hextra-search-no-result")).toHaveCount(0);
    });

    test("results don't pop open after the reader has clicked away", async ({ page }) => {
      // search() awaits the index. If the reader clicks into the article while
      // it loads, the results were dismissed, and rendering when the load
      // finishes would open the panel over whatever they moved on to.
      let loaded = false;
      await page.route(SEARCH_DATA, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await route.continue();
        loaded = true;
      });
      await page.goto(PAGE);
      await typeQuery(page, "everything");
      await page.locator("main h1, article h1, h1").first().click();
      await expect.poll(() => loaded, { timeout: 10_000 }).toBe(true);
      // Give the pending search() time to finish and (wrongly) render.
      await page.waitForTimeout(500);

      await expect(
        page.locator(".hextra-search-results:visible"),
        "the results panel opened after focus had left the search box",
      ).toHaveCount(0);
    });

    test("a failed index load is retried on the next keystroke", async ({ page }) => {
      // The load promise is cached so every caller shares one build. Caching a
      // REJECTED promise would leave search dead for the rest of the page view,
      // with every keyup awaiting the same failure.
      let requests = 0;
      await page.route(SEARCH_DATA, async (route) => {
        if (++requests === 1) return route.fulfill({ status: 503, body: "unavailable" });
        await route.continue();
      });
      await page.goto(PAGE);
      // Wait for the failure to land before the next keystroke. A keyup that
      // fires while the failing load is still in flight awaits that same load,
      // and would leave the test with nothing to retry it.
      const failed = page.waitForEvent("console", (m) => m.text().includes("Search index failed to load"));
      const input = await typeQuery(page, "everythin");
      await failed;
      await input.press("g");

      const results = page.locator(".hextra-search-results:visible");
      await expect(
        results.locator('a[href*="/v2/everything/"]').first(),
        "search stayed dead after one failed load of search-data.json",
      ).toBeVisible({ timeout: 10_000 });
      expect(requests, "search-data.json was not fetched again").toBe(2);
    });
  });

  test.describe("large index", () => {
    test.skip(!built(MAIN_PAGE), `${MAIN_PAGE} is not in this build`);

    // A word that appears in no fixture page, so only the probes match it.
    const PROBE = "zqxprobe";

    type Entry = { title: string; data: Record<string, string> };
    const probePage = (title: string, sections = 1): Entry => ({
      title,
      data: Object.fromEntries(
        Array.from({ length: sections }, (_, i) => [`s${i}#Section ${i}`, `${PROBE} ${title}`]),
      ),
    });

    // Serve the real search-data.json with `before` entries ahead of it (so
    // they hold the lowest page ids and win every tie) and `after` entries
    // behind it.
    async function padSearchData(page: Page, before: Record<string, Entry>, after: Record<string, Entry>) {
      await page.route(SEARCH_DATA, async (route) => {
        const real = await (await route.fetch()).json();
        await route.fulfill({ json: { ...before, ...real, ...after } });
      });
    }

    // Adds `version` to the bundle's visibleVersions, as if the dropdown listed
    // it. The fixture's other dropdown versions (`v1`, `v3`, ...) aren't
    // recognized by getVersionFromURL, so without this there is no second
    // VISIBLE version to rank against. The page pins the bundle with an
    // `integrity` hash, which is stripped so the edited bundle still loads.
    async function addVisibleVersion(page: Page, version: string) {
      await page.route(/\/en\.search\.min\.[^/]*\.js$/, async (route) => {
        const js = await (await route.fetch()).text();
        const edited = js.replace("JSON.parse('[", `JSON.parse('[${JSON.stringify(version)},`);
        expect(edited, "the bundle's visibleVersions literal moved; update this helper").not.toBe(js);
        await route.fulfill({ body: edited, contentType: "application/javascript" });
      });
      await page.route((url) => url.pathname === MAIN_PAGE, async (route) => {
        const html = await (await route.fetch()).text();
        const edited = html.replace(/(<script[^>]*en\.search\.min[^>]*?)\s+integrity="[^"]*"/, "$1");
        expect(edited, "the search <script> lost its integrity attribute; drop this step").not.toBe(html);
        await route.fulfill({ body: edited, contentType: "text/html" });
      });
    }

    async function indexedVersions(page: Page): Promise<string[]> {
      // Any render at all means the index is built.
      await expect(
        page.locator(".hextra-search-results:visible").locator("a, .hextra-search-no-result").first(),
      ).toBeVisible({ timeout: 10_000 });
      return page.evaluate((q) => {
        const index = (window as unknown as { pageIndex: { search: Function } }).pageIndex;
        const hits = index.search(q, { limit: 1000, enrich: true })[0]?.result ?? [];
        return hits.map((h: { doc: { version: string } }) => h.doc.version);
      }, PROBE);
    }

    test("current-version pages are ranked ahead of other versions before the cap", async ({ page }) => {
      // 60 pages in another VISIBLE version, more than the default
      // maxPageResults of 50, all ahead of the one current-version page.
      await addVisibleVersion(page, "9.8.x");
      const crowd = Object.fromEntries(
        Array.from({ length: 60 }, (_, i) => [`/test/9.8.x/probe-${i}/`, probePage(`Other ${i}`)]),
      );
      await padSearchData(page, crowd, { "/test/main/probe-current/": probePage("Current") });
      await page.goto(MAIN_PAGE);
      await typeQuery(page, PROBE);

      const results = page.locator(".hextra-search-results:visible");
      await expect(
        results.locator('a[href*="/test/main/probe-current"]').first(),
        "the current-version page was cut: the page search capped at maxPageResults " +
          "before it preferred the current version",
      ).toBeVisible({ timeout: 10_000 });
    });

    test("a page past the first 100 matching sections keeps its sections", async ({ page }) => {
      // 5 pages x 30 sections = 150 matching sections ahead of the probe page,
      // more than FlexSearch's default limit of 100, in only 6 pages, so the
      // page cap isn't what drops it.
      const crowd = Object.fromEntries(
        Array.from({ length: 5 }, (_, i) => [`/test/main/probe-crowd-${i}/`, probePage(`Crowd ${i}`, 30)]),
      );
      await padSearchData(page, crowd, { "/test/main/probe-current/": probePage("Current") });
      await page.goto(MAIN_PAGE);
      await typeQuery(page, PROBE);

      const results = page.locator(".hextra-search-results:visible");
      await expect(
        results.locator('a[href*="/test/main/probe-current"]').first(),
        "the probe page was dropped: the section lookup used FlexSearch's default " +
          "limit, which counts matches across the whole index",
      ).toBeVisible({ timeout: 10_000 });
    });

    test("a versioned page indexes only what it can list", async ({ page }) => {
      await padSearchData(page, {}, {
        "/test/main/probe-current/": probePage("Current"),
        // Recognized as a version, but not in the dropdown.
        "/test/9.9.x/probe-hidden/": probePage("Hidden"),
        // Unversioned, like a blog post.
        "/blog/probe-unversioned/": probePage("Unversioned"),
      });
      await page.goto(MAIN_PAGE);
      await typeQuery(page, PROBE);

      const versions = await indexedVersions(page);
      expect(versions, "the current version's probe is missing from the index").toContain("main");
      expect(versions, "a version outside the dropdown was indexed").not.toContain("9.9.x");
      expect(versions, "an unversioned page was indexed on a versioned page").not.toContain("");
    });

    test("an unversioned page still indexes and lists every version", async ({ page }) => {
      // search() filters nothing on an unversioned page, so skipping a version
      // there would drop results it used to show.
      await padSearchData(page, {}, {
        "/test/main/probe-current/": probePage("Current"),
        "/test/9.9.x/probe-hidden/": probePage("Hidden"),
      });
      await page.goto(PAGE);
      await typeQuery(page, PROBE);

      const versions = await indexedVersions(page);
      expect(versions).toEqual(expect.arrayContaining(["main", "9.9.x"]));
      await expect(
        page.locator(".hextra-search-results:visible").locator('a[href*="/test/9.9.x/probe-hidden"]').first(),
        "a page from a version outside the dropdown vanished from an unversioned page's results",
      ).toBeVisible();
    });
  });
});
