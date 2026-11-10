import { test, expect, type Page } from "@playwright/test";

/**
 * The phone-reminders card on Settings, as the suite's dev server sees it: that server has no ntfy
 * settings, so the card must say reminders are not set up and offer nothing that would pretend
 * otherwise. The configured card is exercised through its service in tests/integration and looked at
 * in a browser against a real ntfy (see "Reminders when the app is closed" in CLAUDE.md).
 */

function main(page: Page) {
  return page.locator("main");
}

test("without ntfy on the server, the card says so and offers no switch", async ({ page }) => {
  await page.goto("/settings");
  const card = main(page).getByRole("region", { name: "Reminders on your phone" });
  await expect(card).toContainText("Phone reminders are not set up on this server.");
  await expect(card).toContainText("ops/README.md");
  await expect(card.getByRole("checkbox")).toHaveCount(0);
  await expect(card.getByRole("button")).toHaveCount(0);
});
