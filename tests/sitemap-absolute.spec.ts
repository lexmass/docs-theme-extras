import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// The sitemap lists full URLs on a host-less site that sets prodHost, and
// stays exactly Hugo's everywhere else.
//
// WHY THIS EXISTS. kgateway.dev, agentgateway.dev, and ambientmesh.io build
// with baseURL "/" (canonifyURLs would otherwise point preview deployments at
// production), so Hugo's embedded sitemap template wrote root-relative <loc>
// entries — /docs/envoy/main/quickstart/ — which the sitemap protocol does not
// allow and crawlers ignore. layouts/sitemap.xml is a copy of Hugo's template
// that sends every permalink through utils/abs-permalink.html, which prepends
// themeExtras.prodHost to a root-relative URL and nothing else.
//
// FOUR BUILDS, because the partial has four outcomes and a regression in any
// one of them is invisible from the others:
//   public-oss-prodhost   baseURL "/test" + prodHost  → host prepended (the fix)
//   public-oss            baseURL "/test", no prodHost → unchanged, root-relative
//   public-oss-devpath    absolute baseURL             → unchanged, already full
//   public-oss-protorel   protocol-relative baseURL    → unchanged, not doubled
// The last three are the fail-safe: a site that sets no prodHost, or whose
// baseURL already names a host, must get Hugo's output byte for byte.
//
// Each build SKIPS when absent, like every spec here, so a target that does
// not build it reports a skip rather than a failure.

const REPO = path.resolve(__dirname, "..");
const HOST = "https://docs.example.com"; // hugo-oss-prodhost.toml

const BUILDS = {
  prodhost: path.join(REPO, "public-oss-prodhost", "test", "sitemap.xml"),
  plain: path.join(REPO, "public-oss", "test", "sitemap.xml"),
  devpath: path.join(REPO, "public-oss-devpath", "test", "sitemap.xml"),
  protorel: path.join(REPO, "public-oss-protorel", "test", "sitemap.xml"),
};

// Every URL the sitemap publishes: <loc> entries and hreflang alternates.
function sitemapUrls(file: string): string[] {
  const xml = fs.readFileSync(file, "utf8");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const hrefs = [...xml.matchAll(/<xhtml:link[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  return [...locs, ...hrefs];
}

function expectAll(urls: string[], prefix: string, why: string) {
  expect(urls.length, "the sitemap lists no URLs at all").toBeGreaterThan(0);
  const off = urls.filter((u) => !u.startsWith(prefix));
  expect(off, `${why} — every URL should start with ${prefix}`).toEqual([]);
}

test.describe("sitemap URLs", () => {
  test("host-less site with prodHost: every URL is absolute on prodHost", () => {
    test.skip(!fs.existsSync(BUILDS.prodhost), "prodhost build not present (make build-prodhost)");
    expectAll(sitemapUrls(BUILDS.prodhost), `${HOST}/test/`, "prodHost was not prepended");
  });

  test("no prodHost: URLs stay root-relative, as Hugo writes them", () => {
    test.skip(!fs.existsSync(BUILDS.plain), "OSS fixture build not present");
    expectAll(sitemapUrls(BUILDS.plain), "/test/", "a site without prodHost changed");
  });

  test("absolute baseURL: URLs pass through unchanged", () => {
    test.skip(!fs.existsSync(BUILDS.devpath), "devpath build not present (make build-devpath)");
    expectAll(
      sitemapUrls(BUILDS.devpath),
      "http://localhost:1313/test/",
      "an already-absolute URL was rewritten",
    );
  });

  test("protocol-relative baseURL: URLs are not given a second host", () => {
    test.skip(!fs.existsSync(BUILDS.protorel), "protorel build not present (make build-devpath)");
    const urls = sitemapUrls(BUILDS.protorel);
    expectAll(urls, "//localhost:1313", "a protocol-relative URL was rewritten");
  });
});
