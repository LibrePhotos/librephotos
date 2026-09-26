import { expect, Locator, Page } from "@playwright/test";

export class LoginPage {
  readonly username: Locator;

  readonly password: Locator;

  readonly submit: Locator;

  constructor(readonly page: Page) {
    this.username = page.getByPlaceholder("Username");
    this.password = page.getByPlaceholder("Password");
    this.submit = page.getByRole("button", { name: "Login", exact: true });
  }

  async goto() {
    await this.page.goto("/login");
    await expect(this.page.getByRole("heading", { name: "Login" })).toBeVisible();
  }

  async login(username: string, password: string) {
    await this.goto();
    await this.username.fill(username);
    await this.password.fill(password);
    await this.submit.click();
  }
}

export class TimelinePage {
  readonly heading: Locator;

  /** One button per photo tile in the justified grid. */
  readonly tiles: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole("main").getByRole("heading", { name: "Photos", level: 2 });
    this.tiles = page.locator("main button.pig-btn");
  }

  async goto() {
    await this.page.goto("/");
    await expect(this.heading).toBeVisible();
  }

  dayHeader(day: string) {
    return this.page.getByRole("main").getByText(day, { exact: true });
  }
}

export class Lightbox {
  readonly dialog: Locator;

  readonly image: Locator;

  readonly favoriteButton: Locator;

  constructor(readonly page: Page) {
    this.dialog = page.getByRole("dialog");
    this.image = this.dialog.locator("img[src*='/media/thumbnails_big/'], img[src*='/media/photos/']").first();
    this.favoriteButton = this.dialog.getByRole("button", { name: /^(Add to|Remove from) favorites/ });
  }
}

export class Header {
  readonly profileButton: Locator;

  constructor(readonly page: Page) {
    this.profileButton = page.getByRole("banner").getByRole("button", { name: "it's me" });
  }

  async logout() {
    await this.profileButton.click();
    await this.page.getByRole("menuitem", { name: "Log out" }).click();
  }
}

/** Whether an <img> finished loading real pixels (not a broken or empty image). */
export async function isImageLoaded(image: Locator) {
  return image.evaluate(el => {
    const img = el as HTMLImageElement;
    return img.complete && img.naturalWidth > 0;
  });
}
