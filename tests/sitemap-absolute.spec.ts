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
// A FIFTH BUILD, public-sitemap-i18n (hugo-sitemap-i18n.toml), is the only
// multilingual one. It runs the two paths a monolingual site never reaches:
// the hreflang alternates, and sitemapindex.xml, which Hugo writes at the root
// of a multilingual site in place of a single sitemap.
//
// The same host-less sites also emitted root-relative canonical and og:url
// tags, from .Permalink in head.html and opengraph.html. Those go through the
// same partial now, so the last block checks them on the prodhost and plain
// builds.
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

const I18N = path.join(REPO, "public-sitemap-i18n"); // hugo-sitemap-i18n.toml

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

test.describe("multilingual sitemap URLs", () => {
  test.skip(!fs.existsSync(I18N), "i18n build not present (make build-sitemap-i18n)");

  test("the root sitemap index lists each language's sitemap on prodHost", () => {
    const xml = fs.readFileSync(path.join(I18N, "sitemap.xml"), "utf8");
    expect(xml, "the root sitemap.xml is not an index").toContain("<sitemapindex");
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([`${HOST}/en/sitemap.xml`, `${HOST}/ja/sitemap.xml`]);
  });

  for (const lang of ["en", "ja"]) {
    test(`${lang}: every <loc> and hreflang alternate is on prodHost`, () => {
      const file = path.join(I18N, lang, "sitemap.xml");
      const xml = fs.readFileSync(file, "utf8");
      // Without alternates the branch this build exists for never ran.
      expect(xml, "no hreflang alternates: the pages lost their translations").toContain(
        'hreflang="',
      );
      expectAll(sitemapUrls(file), `${HOST}/`, "prodHost was not prepended");
    });
  }
});

test.describe("canonical and og:url", () => {
  // Any page will do; this one is in every OSS-fixture build.
  const page = (root: string) => path.join(REPO, root, "test", "v2", "index.html");
  const tags = (html: string) => ({
    canonical: html.match(/<link rel="?canonical"? href="?([^"\s>]+)/)?.[1],
    ogUrl: html.match(/<meta property="?og:url"? content="?([^"\s>]+)/)?.[1],
  });

  test("host-less site with prodHost: both are absolute on prodHost", () => {
    const file = page("public-oss-prodhost");
    test.skip(!fs.existsSync(file), "prodhost build not present (make build-prodhost)");
    const t = tags(fs.readFileSync(file, "utf8"));
    expect(t.canonical).toBe(`${HOST}/test/v2/`);
    expect(t.ogUrl).toBe(`${HOST}/test/v2/`);
  });

  test("no prodHost: both stay as Hugo writes them", () => {
    const file = page("public-oss");
    test.skip(!fs.existsSync(file), "OSS fixture build not present");
    const t = tags(fs.readFileSync(file, "utf8"));
    expect(t.canonical).toBe("/test/v2/");
    expect(t.ogUrl).toBe("/test/v2/");
  });
});
