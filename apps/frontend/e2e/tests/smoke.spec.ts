import { expect, test } from "@playwright/test";
import { ADMIN_PASSWORD, ADMIN_USERNAME, SEED_DAYS, SEED_PHOTO_COUNT } from "./env";
import { Header, isImageLoaded, Lightbox, LoginPage, TimelinePage } from "./pages";

test.describe("login", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("valid credentials land on the timeline", async ({ page }) => {
    await new LoginPage(page).login(ADMIN_USERNAME, ADMIN_PASSWORD);

    await expect(page).toHaveURL(/\/$/);
    await expect(new TimelinePage(page).heading).toBeVisible();
  });

  test("a wrong password shows an error and stays on the login page", async ({ page }) => {
    await new LoginPage(page).login(ADMIN_USERNAME, `${ADMIN_PASSWORD}-wrong`);

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("protected pages redirect to the login page", async ({ page }) => {
    await page.goto("/favorites");

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Login" })).toBeVisible();
  });
});

test("timeline shows the seeded photos grouped by day", async ({ page }) => {
  const timeline = new TimelinePage(page);
  await timeline.goto();

  for (const day of SEED_DAYS) {
    await expect(timeline.dayHeader(day)).toBeVisible();
  }
  await expect(timeline.tiles).toHaveCount(SEED_PHOTO_COUNT);
  // The thumbnail has to come through the backend's media view, not just render a tile.
  const thumbnail = timeline.tiles.first().locator("img").first();
  await expect.poll(() => isImageLoaded(thumbnail)).toBe(true);
});

test("clicking a photo opens it in the lightbox", async ({ page }) => {
  const timeline = new TimelinePage(page);
  await timeline.goto();
  await timeline.tiles.first().click();

  const lightbox = new Lightbox(page);
  await expect(lightbox.dialog).toBeVisible();
  await expect(lightbox.image).toBeVisible();
  await expect.poll(() => isImageLoaded(lightbox.image)).toBe(true);

  await page.keyboard.press("Escape");
  await expect(lightbox.dialog).toBeHidden();
});

test("favorite toggles from the lightbox and persists", async ({ page }) => {
  const timeline = new TimelinePage(page);
  await timeline.goto();
  await timeline.tiles.first().click();

  const lightbox = new Lightbox(page);
  await expect(lightbox.favoriteButton).toBeVisible();
  const before = await lightbox.favoriteButton.getAttribute("aria-label");
  const wasFavorite = before?.startsWith("Remove") ?? false;

  const toggle = async (expectFavorite: boolean) => {
    const saved = page.waitForResponse(
      r => r.url().includes("/api/photosedit/favorite") && r.request().method() === "POST"
    );
    await lightbox.favoriteButton.click();
    expect((await saved).ok()).toBeTruthy();
    await expect(lightbox.favoriteButton).toHaveAccessibleName(
      expectFavorite ? /^Remove from favorites/ : /^Add to favorites/
    );
  };

  await toggle(!wasFavorite);

  // The new state survives a reload, so it came from the server rather than local state.
  await page.reload();
  await timeline.tiles.first().click();
  await expect(lightbox.favoriteButton).toHaveAccessibleName(
    !wasFavorite ? /^Remove from favorites/ : /^Add to favorites/
  );

  // Put it back so the suite can run again against the same stack.
  await toggle(wasFavorite);
});

test.describe("logout", () => {
  // Log in afresh: logging out blacklists the refresh token of this session only.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("logging out returns to the login page and ends the session", async ({ page }) => {
    await new LoginPage(page).login(ADMIN_USERNAME, ADMIN_PASSWORD);
    await expect(new TimelinePage(page).heading).toBeVisible();

    await new Header(page).logout();

    await expect(page).toHaveURL(/\/login/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });
});
