import { expect, test } from "@playwright/test";
import { getSelf, imageTag, obtainToken, setLastSeenRelease } from "./api";
import { ADMIN_PASSWORD, ADMIN_USERNAME } from "./env";
import { Header, TimelinePage } from "./pages";

/**
 * #2305: after an update the What's new card shows once. Closing it is remembered on the server, so
 * it stays closed after a reload, and the account menu still opens the highlights.
 *
 * The stack must run a release the app knows: e2e.yml starts it with IMAGE_TAG set to a release in
 * apps/frontend/src/components/whatsnew/releases.json. A development build never shows the card, so
 * the test skips itself against one (a stack started without IMAGE_TAG).
 */
test("the What's new card shows once after an update, and the account menu reopens it", async ({ page, request }) => {
  const token = await obtainToken(request, ADMIN_USERNAME, ADMIN_PASSWORD);
  const tag = await imageTag(request, token);
  test.skip(tag === "" || tag === "dev", "a development build has no What's new card; start the stack with IMAGE_TAG");

  // Pretend the admin last saw a release older than every bundled one.
  const self = await getSelf(request, token);
  await setLastSeenRelease(request, token, self.id, "0.0.1");

  const timeline = new TimelinePage(page);
  await timeline.goto();
  const card = page.getByRole("region", { name: `What's new in LibrePhotos ${tag}` });
  await expect(card, `no card for ${tag}: is it a release in whatsnew/releases.json?`).toBeVisible();

  const saved = page.waitForResponse(
    response => response.url().includes(`/api/user/${self.id}/`) && response.request().method() === "PATCH"
  );
  await card.getByRole("button", { name: "Close What's new" }).click();
  expect((await saved).ok()).toBeTruthy();
  await expect(card).toBeHidden();

  await page.reload();
  await expect(timeline.heading).toBeVisible();
  await expect(card).toBeHidden();

  await new Header(page).profileButton.click();
  await page.getByRole("menuitem", { name: "What's new" }).click();
  const dialog = page.getByRole("dialog", { name: "What's new in LibrePhotos" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Release notes" })).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();
});
