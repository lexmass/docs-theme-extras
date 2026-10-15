import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { target } from "./helpers/target";

// The doc-test badge's tooltip, in a real browser: the CSS that shows it
// (docs-theme-extras.css, "Doc-test Verified badge") and the Esc handler
// (docs-init.js). tests/test-status-badge.spec.ts checks the markup statically;
// this checks what WCAG 1.4.13 asks of content shown on hover or focus:
//   - shown on keyboard focus, not only on hover;
//   - hoverable: the pointer can move from the badge onto the tooltip without
//     it closing (it used to be pointer-events: none);
//   - dismissible: Esc closes it, from hover or from focus, and it stays
//     closed until the pointer and focus have both left.

const PAGE = "/test/v2/test-status-passed/";

function pageBuilt(): boolean {
  try {
    return fs.existsSync(target.fileForUrl(PAGE));
  } catch {
    return false;
  }
}

test.describe("doc-test badge tooltip", () => {
  test.skip(!pageBuilt(), `${PAGE} is not in this build`);

  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE);
    await page.mouse.move(1200, 700);
  });

  test("hover shows it, and the pointer can move onto it", async ({ page }) => {
    const badge = page.locator(".test-status-badge");
    const tip = badge.locator(".test-status-tooltip");
    await expect(tip).toBeHidden();

    await badge.hover();
    await expect(tip, "hover did not show the tooltip").toBeVisible();

    // Move down through the gap and onto the tooltip in small steps, so any
    // point where the pointer falls off the hover area closes it.
    const b = (await badge.boundingBox())!;
    const t = (await tip.boundingBox())!;
    await page.mouse.move(b.x + 10, b.y + b.height / 2);
    // Stop in the gap between badge and tooltip, the spot a slow pointer
    // rests on. The ::after bridge is what keeps the badge hovered here.
    await page.mouse.move(b.x + 10, (b.y + b.height + t.y) / 2, { steps: 5 });
    await page.waitForTimeout(400);
    await expect(tip, "the tooltip closed while the pointer was in the gap").toBeVisible();
    await page.mouse.move(t.x + 10, t.y + t.height / 2, { steps: 10 });
    // Outlast the 0.2s fade: `visibility` only flips to hidden when the
    // transition ends, so checking straight away passes even when the
    // tooltip is already closing.
    await page.waitForTimeout(400);
    await expect(tip, "the tooltip closed when the pointer moved onto it").toBeVisible();
  });

  test("Esc closes a hover-opened tooltip until the pointer leaves", async ({ page }) => {
    const badge = page.locator(".test-status-badge");
    const tip = badge.locator(".test-status-tooltip");
    await badge.hover();
    await expect(tip).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(tip, "Esc did not close the tooltip").toBeHidden();

    await page.mouse.move(1200, 700);
    await badge.hover();
    await expect(tip, "the tooltip stayed dismissed after the pointer came back").toBeVisible();
  });

  test("keyboard focus shows it, and Esc closes it until focus leaves", async ({ page }) => {
    const badge = page.locator(".test-status-badge");
    const tip = badge.locator(".test-status-tooltip");

    // Tab from the <h1> area onto the badge, so :focus-visible applies.
    await page.locator("h1").first().evaluate((h) => {
      h.setAttribute("tabindex", "-1");
      (h as HTMLElement).focus();
    });
    await page.keyboard.press("Tab");
    await expect(badge, "the badge is not the next tab stop after the title").toBeFocused();
    await expect(tip, "keyboard focus did not show the tooltip").toBeVisible();

    await page.keyboard.press("Escape");
    await expect(tip, "Esc did not close the tooltip").toBeHidden();
    await expect(badge, "Esc moved focus off the badge").toBeFocused();

    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(badge).toBeFocused();
    await expect(tip, "the tooltip stayed dismissed after focus came back").toBeVisible();
  });
});
