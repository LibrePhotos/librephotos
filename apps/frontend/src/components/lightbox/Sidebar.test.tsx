/**
 * A viewer who is not the owner (a shared album's recipient, a public page's
 * visitor) gets no photo details. The panel used to say only that details are
 * for the owner, while the grid behind it showed the photo's date and place.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import type { LightboxItem } from "./lightbox.types";
import { Sidebar } from "./Sidebar";

vi.mock("../../api_client/photos/hooks", () => ({
  useFetchPhotoDetailsQuery: () => ({ data: undefined, isError: false }),
  useFetchPublicPhotoDetailQuery: () => ({ data: undefined, isLoading: false }),
  useUpdatePhotoMutation: () => ({ mutate: () => {} }),
}));
vi.mock("../../api_client/faces", () => ({ useSetFacesPersonLabelMutation: () => ({ mutate: () => {} }) }));
vi.mock("../LocationMap", () => ({ LocationMap: () => null }));
vi.mock("../modals/ModalPersonEdit", () => ({ ModalPersonEdit: () => null }));

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
  await i18n.changeLanguage("en");
});

const mounted: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (mounted.length) await mounted.pop()!();
});

async function renderSidebar(gridItem?: LightboxItem) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <Sidebar id="h1" isPublic gridItem={gridItem} closeSidepanel={() => {}} setFaceLocation={() => {}} />
      </MantineProvider>
    );
  });
  mounted.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  return container;
}

describe("Sidebar for a viewer who is not the owner", () => {
  it("shows the date and place the grid already shows, read-only", async () => {
    const container = await renderSidebar({
      id: "p1",
      image_hash: "h1",
      date: "2023-05-06T04:57:00+00:00",
      location: "Berlin, Germany",
    });

    expect(container.textContent).toContain("May 6, 2023");
    expect(container.textContent).toContain("Berlin, Germany");
    expect(container.textContent).toContain(i18n.t("lightbox.sidebar.ownerOnlyMoreDetails"));
    // Neither can be edited by this viewer.
    expect(container.querySelector(`[aria-label="${i18n.t("lightbox.sidebar.editdatetime")}"]`)).toBeNull();
    expect(container.querySelector(`[aria-label="${i18n.t("lightbox.sidebar.update_location")}"]`)).toBeNull();
  });

  it("says only that details are for the owner when the grid has neither", async () => {
    // A photo with no timestamp and no location, on a user's public page or in
    // a shared album (public album links take the slug branch instead).
    const container = await renderSidebar({ id: "p1", image_hash: "h1", date: "", location: "" });

    expect(container.textContent).not.toContain(i18n.t("lightbox.sidebar.withouttimestamp"));
    expect(container.textContent).not.toContain(i18n.t("lightbox.sidebar.no_location"));
    expect(container.textContent).toContain(i18n.t("lightbox.sidebar.ownerOnlyDetails"));
  });
});
