import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { target } from "./helpers/target";

// The shared `.dropdown` hover menu (docs-theme-extras.css, "Navbar dropdowns")
// and its Escape handler (docs-init.js). The markup lives in CONSUMER navbars
// (kgateway's Docs and version menus), never in this module's own templates, so
// the fixture has none: each test injects a minimal copy into a real fixture page,
// which still loads the real stylesheet and script.
//
// What it guards:
//   - Keyboard users can open it AND Tab into its items. Hover-only left the
//     items unreachable, and a `:has(:focus-visible)` rule opened the menu but
//     closed it in the gap between the trigger's blur and the item's focus, so
//     Tab skipped every item.
//   - A mouse click doesn't pin it open. Chrome focuses a clicked <button>, and
//     `:focus-within` then held the menu open after the pointer left;
//     docs-init.js drops that mouse focus when the pointer leaves.
//   - Escape dismisses it, from focus or from hover (WCAG 1.4.13), and it opens
//     again once the pointer and focus have left and come back.

const PAGE = "/test/v2/everything/";

function pageBuilt(): boolean {
  try {
    return fs.existsSync(target.fileForUrl(PAGE));
  } catch {
    return false;
  }
}

// The two trigger shapes consumers ship: kgateway's version menu uses a
// <button>, its Docs menu an <a href>.
const BUTTON_TRIGGER = `<button id="dd-trigger" type="button">Versions</button>`;
const LINK_TRIGGER = `<a id="dd-trigger" href="#docs">Docs</a>`;

async function injectDropdown(page: Page, trigger = BUTTON_TRIGGER) {
  await page.evaluate((trigger) => {
    const wrap = document.createElement("div");
    wrap.id = "dd-probe";
    wrap.style.cssText = "position:fixed;top:200px;left:40px;z-index:9999;background:white";
    wrap.innerHTML = `
      <button id="dd-before" type="button">before</button>
      <div class="dropdown" style="position:relative">
        ${trigger}
        <div class="dropdown-content navbar-dropdown-content">
          <a id="dd-item-1" href="#one">One</a>
          <a id="dd-item-2" href="#two">Two</a>
        </div>
      </div>
      <button id="dd-after" type="button">after</button>`;
    document.body.appendChild(wrap);
  }, trigger);
}

test.describe("navbar .dropdown", () => {
  test.skip(!pageBuilt(), `${PAGE} is not in this build`);

  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE);
    await page.mouse.move(1200, 700);
  });

  test("opens from the keyboard, and Escape closes it until focus leaves", async ({ page }) => {
    await injectDropdown(page);
    const menu = page.locator("#dd-probe .dropdown-content");
    await page.locator("#dd-before").focus();
    await page.keyboard.press("Tab");
    await expect(page.locator("#dd-trigger")).toBeFocused();
    await expect(menu, "tabbing onto the trigger did not open the menu").toBeVisible();

    await page.keyboard.press("Tab");
    await expect(page.locator("#dd-item-1"), "the first item is not reachable by Tab").toBeFocused();

    await page.keyboard.press("Escape");
    await expect(menu, "Escape did not close the menu").toBeHidden();
    await expect(page.locator("#dd-trigger"), "Escape left focus on a hidden item").toBeFocused();

    await page.keyboard.press("Tab");
    await expect(page.locator("#dd-after")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator("#dd-trigger")).toBeFocused();
    await expect(menu, "the menu stayed dismissed after focus left and came back").toBeVisible();
  });

  test("a mouse click does not pin it open after the pointer leaves", async ({ page }) => {
    await injectDropdown(page);
    const menu = page.locator("#dd-probe .dropdown-content");
    await page.locator("#dd-trigger").click();
    await expect(menu).toBeVisible();
    await page.mouse.move(1200, 700);
    await expect(menu, "the menu stayed open on mouse focus alone").toBeHidden();
  });

  test("Escape closes a hover-opened menu until the pointer leaves", async ({ page }) => {
    await injectDropdown(page);
    const menu = page.locator("#dd-probe .dropdown-content");
    await page.locator("#dd-trigger").hover();
    await expect(menu).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(menu, "Escape did not close a hover-opened menu").toBeHidden();

    await page.mouse.move(1200, 700);
    await page.locator("#dd-trigger").hover();
    await expect(menu, "the menu stayed dismissed after the pointer left and came back").toBeVisible();
  });

  test("Escape from a link trigger's menu returns focus to the link", async ({ page }) => {
    await injectDropdown(page, LINK_TRIGGER);
    const menu = page.locator("#dd-probe .dropdown-content");
    await page.locator("#dd-before").focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(page.locator("#dd-item-1")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(page.locator("#dd-trigger")).toBeFocused();
  });

  test("leaves other markup that reuses the class name alone", async ({ page }) => {
    // ambientmesh.io's marketing nav loads docs-init.js but nests its menu
    // inside a <button class="dropdown">, styled by its own CSS. Treating that
    // as this module's shape would take "the trigger" to be the menu's first
    // link and move focus into the menu on Escape.
    await page.evaluate(() => {
      const wrap = document.createElement("div");
      wrap.style.cssText = "position:fixed;top:200px;left:40px;z-index:9999;background:white";
      wrap.innerHTML = `
        <style>#am .am-menu{display:none} #am:hover .am-menu{display:block}</style>
        <button id="am" class="dropdown" type="button">Resources
          <div class="am-menu"><div class="dropdown-content"><a id="am-link" href="#x">Blog</a></div></div>
        </button>`;
      document.body.appendChild(wrap);
    });
    await page.locator("#am").hover();
    await page.locator("#am").focus();
    await expect(page.locator("#am-link")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#am"), "Escape moved focus out of the button").toBeFocused();
    await expect(page.locator("#am")).not.toHaveClass(/dropdown-dismissed/);
  });
});
