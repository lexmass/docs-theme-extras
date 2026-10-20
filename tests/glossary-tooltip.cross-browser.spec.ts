import { test, expect } from "@playwright/test";
import { target } from "./helpers/target";

const PAGE = "/test/v2/glossary-term/";
const TERM = '[data-glossary-term="Data Plane"]';

test.skip(
  !target.name.startsWith("docs-theme-extras-fixture"),
  "requires the bundled glossary fixture",
);

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await page.mouse.move(0, 0);
});

for (const placement of ["above", "below"] as const) {
  test(`the tooltip stays open across the gap ${placement} the term and its text can be selected`, async ({ page }) => {
    const term = page.locator(TERM).filter({ hasText: "proxy layer" });
    const tip = term.locator(".tooltip-content");
    await expect(term).toHaveCount(1);
    // The short fixture needs scroll room to place the term near the viewport
    // top and exercise the tooltip's below-term placement.
    await page.evaluate(() => { document.body.style.paddingBottom = "100vh"; });
    await term.evaluate((element, top) => {
      window.scrollTo({
        top: window.scrollY + element.getBoundingClientRect().top - top,
        behavior: "instant",
      });
    }, placement === "below" ? 90 : 350);
    await term.hover();
    await expect(tip).toBeVisible();
    if (placement === "below") await expect(tip).toHaveClass(/tooltip-below/);
    else await expect(tip).not.toHaveClass(/tooltip-below/);

    const trigger = (await term.boundingBox())!;
    const tooltip = (await tip.boundingBox())!;
    const x = trigger.x + trigger.width / 2;
    const gap = placement === "above"
      ? (tooltip.y + tooltip.height + trigger.y) / 2
      : (trigger.y + trigger.height + tooltip.y) / 2;
    await page.mouse.move(x, gap, { steps: 8 });
    await expect(tip, "closed while crossing the gap").toBeVisible();

    const definition = (await tip.locator("span").boundingBox())!;
    await page.mouse.move(definition.x + 5, definition.y + 8, { steps: 8 });
    await expect(tip, "closed on entering the definition").toBeVisible();
    await page.mouse.down();
    await page.mouse.move(definition.x + 100, definition.y + 8, { steps: 10 });
    await page.mouse.up();
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBeTruthy();
    // Selecting the definition can focus its parent. An outside click must
    // dismiss it even when that focus was keeping it open.
    await page.locator("h1").first().click();
    await expect(tip).toBeHidden();
  });
}

test("keyboard focus can enter the Learn more link without closing the tooltip", async ({ page }) => {
  const term = page.locator(TERM).filter({ hasText: "proxy layer" });
  const tip = term.locator(".tooltip-content");
  const link = tip.getByRole("link", { name: "Learn more" });
  await term.focus();
  await expect(tip).toBeVisible();
  await term.hover();
  await page.mouse.move(0, 0);
  await expect(tip, "pointer leave must not hide focused content").toBeVisible();
  // Move focus directly: Safari's default keyboard preference skips links on
  // Tab. The term-to-link focus transition must work with either preference.
  await link.focus();
  await expect(link).toBeFocused();
  await expect(tip).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(tip).toBeHidden();
});

test("Escape dismisses the tooltip while its link is focused", async ({ page }) => {
  const term = page.locator(TERM).filter({ hasText: "proxy layer" });
  const tip = term.locator(".tooltip-content");
  await term.focus();
  const link = tip.getByRole("link", { name: "Learn more" });
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
});

test("the Learn more link is clickable from the hovered tooltip", async ({ page, context }) => {
  await context.route("https://example.com/data-plane", (route) => route.fulfill({
    contentType: "text/html",
    body: "<h1>Glossary destination</h1>",
  }));
  const term = page.locator(TERM).filter({ hasText: "proxy layer" });
  await term.hover();
  const popup = page.waitForEvent("popup");
  await term.getByRole("link", { name: "Learn more" }).click();
  await expect((await popup).getByRole("heading", { name: "Glossary destination" })).toBeVisible();
});

test.describe("touch interaction", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("tap toggles the tooltip and tapping Learn more follows its link", async ({ page, context }) => {
    await context.route("https://example.com/data-plane", (route) => route.fulfill({
      contentType: "text/html",
      body: "<h1>Glossary destination</h1>",
    }));
    const term = page.locator(TERM).filter({ hasText: "proxy layer" });
    const tip = term.locator(".tooltip-content");
    await term.tap();
    await expect(tip).toBeVisible();
    await term.tap();
    await expect(tip).toBeHidden();
    await term.tap();
    const popup = page.waitForEvent("popup");
    await tip.getByRole("link", { name: "Learn more" }).tap();
    await expect((await popup).getByRole("heading", { name: "Glossary destination" })).toBeVisible();
  });
});
