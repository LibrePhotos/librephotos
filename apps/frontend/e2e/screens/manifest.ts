import type { Locator, Page } from "@playwright/test";
import { Lightbox, TimelinePage } from "../tests/pages";

/**
 * One screenshot of the docs and release posts. The screens run (`yarn screens`) takes each in
 * light and dark, on desktop and (with `phone`) on a phone, and writes
 * apps/docs/static/img/shots/<id>-<theme>.webp plus manifest.json from this list.
 */
export type ShotSpec = {
  /** File name and docs id, kebab-case: `<Screenshot id="..." />` and a highlight's `shot:`. */
  id: string;
  /** Says what the shot shows, true for any library. Goes into the docs manifest.json. */
  alt: string;
  /** Path in the web app the shot starts at. */
  route: string;
  /** Visible once the screen is ready. The run also waits for every visible thumbnail. */
  waitFor: (page: Page) => Locator;
  /** Steps after the page loaded, such as opening a photo or a popover. */
  prepare?: (page: Page) => Promise<void>;
  /** Parts painted over because they change from run to run. */
  mask?: (page: Page) => Locator[];
  /** Shoot only this element instead of the whole viewport. */
  clip?: (page: Page) => Locator;
  /** Also shoot `<id>-phone-<theme>.webp` on a phone. */
  phone?: boolean;
  /** The release whose highlight this shot shows. */
  release?: string;
};

const main = (page: Page) => page.getByRole("main");

async function openFirstPhoto(page: Page) {
  await new TimelinePage(page).photos.first().click();
  await new Lightbox(page).image.waitFor();
}

/** Opens the first photo with its info panel, which the lightbox remembers as closed or open. */
async function openFirstPhotoDetails(page: Page) {
  await openFirstPhoto(page);
  const show = page.getByRole("dialog").getByRole("button", { name: "Show info panel (I)" });
  if (await show.isVisible()) {
    await show.click();
  }
}

/**
 * The shots, in the order of the docs manifest. The first five are the landing page tour; their ids
 * and alt texts are the ones apps/docs/static/img/shots/manifest.json already has. Faces, places and
 * events need a library with detected faces, GPS places and events, which the e2e stack (no ML) does
 * not have: there, pick shots with SHOTS=timeline,lightbox,... (see the docs page).
 */
export const SHOTS: readonly ShotSpec[] = [
  {
    id: "timeline",
    alt: "Timeline of a sample library: photos grouped by day, newest first, with the place of each day",
    route: "/",
    waitFor: page => new TimelinePage(page).photos.first(),
    phone: true,
  },
  {
    id: "lightbox",
    alt: "A photo open in the lightbox, with the Details sidebar: date, file, camera, the place on a map, the people in it, a generated caption and auto tags",
    route: "/",
    prepare: openFirstPhotoDetails,
    waitFor: page => page.getByRole("dialog").getByRole("heading", { name: "Details" }),
    phone: true,
  },
  {
    id: "faces",
    alt: "People page: one cover photo per named person, with the number of photos each person is in",
    route: "/album/persons",
    waitFor: page => main(page).getByRole("img").first(),
  },
  {
    id: "places",
    alt: "Places page: a world map with clusters of photos, above a grid of places from countries down to streets",
    route: "/album/places",
    waitFor: page => main(page).getByRole("img").first(),
  },
  {
    id: "events",
    alt: "Events page: albums made from days out, each named after the day, the time of day and the place, with its date and number of photos",
    route: "/album/events",
    waitFor: page => main(page).getByRole("img").first(),
  },
  {
    id: "timeline-filter",
    alt: "Timeline with the Filter popover open: media type, the screenshots and documents to hide, show only favorites, and Save as default",
    route: "/",
    prepare: async page => {
      await main(page)
        .getByRole("button", { name: /^Filter/ })
        .click();
    },
    waitFor: page => page.getByRole("dialog", { name: "Filter" }),
    release: "1.3.0",
  },
  {
    id: "category-badge",
    alt: "Photo details in the lightbox with the category badge next to the file name, which says whether the photo is a photo, a screenshot or a document",
    route: "/",
    prepare: openFirstPhotoDetails,
    waitFor: page => page.getByRole("dialog").getByRole("button", { name: /^Category: / }),
    release: "1.3.0",
  },
];
