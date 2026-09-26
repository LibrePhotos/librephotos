import { expect, test as setup } from "@playwright/test";
import { STORAGE_STATE } from "../playwright.config";
import { getSelf, obtainToken, setScanDirectory, startScan } from "./api";
import { ADMIN_PASSWORD, ADMIN_USERNAME, SCAN_DIRECTORY, SEED_PHOTO_COUNT } from "./env";
import { LoginPage } from "./pages";

/**
 * Makes sure the admin owns the sample library, then logs in through the UI and
 * saves the session for the other specs.
 *
 * The e2e compose stack scans the library on startup (deploy/e2e/entrypoint.sh),
 * so in CI this only waits. Against a fresh native backend it points the admin at
 * E2E_SCAN_DIR and starts the scan itself; a scan started through the API first
 * downloads the ML models (about 1.3 GB, once), hence the generous timeout.
 */
setup("seed library and log in", async ({ page, request }) => {
  setup.setTimeout(15 * 60_000);

  const token = await obtainToken(request, ADMIN_USERNAME, ADMIN_PASSWORD);
  const self = await getSelf(request, token);

  if (self.photo_count < SEED_PHOTO_COUNT && !self.scan_directory) {
    await setScanDirectory(request, token, self.id, SCAN_DIRECTORY);
    await startScan(request, token);
  }

  await expect
    .poll(async () => (await getSelf(request, token)).photo_count, {
      message: `waiting for ${SEED_PHOTO_COUNT} photos to be imported`,
      timeout: 14 * 60_000,
      intervals: [2_000, 5_000, 10_000],
    })
    .toBeGreaterThanOrEqual(SEED_PHOTO_COUNT);

  await new LoginPage(page).login(ADMIN_USERNAME, ADMIN_PASSWORD);
  await expect(page).toHaveURL(/\/$/);
  await page.context().storageState({ path: STORAGE_STATE });
});
