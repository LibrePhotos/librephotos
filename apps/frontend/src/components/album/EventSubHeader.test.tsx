/**
 * Under an event's title: up to five of its people, linked to their pages, and the map button,
 * named after the event's first place, which brings the map into view when it opens.
 */
import type { AutoAlbum } from "@librephotos/api-client";
import React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { click, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { EventSubHeader } from "./EventSubHeader";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children?: React.ReactNode }) => <a {...props}>{children}</a>,
}));

type Person = AutoAlbum["people"][number];
const person = (id: number): Person => ({
  id,
  name: `Person ${id}`,
  face_url: `/media/faces/${id}.jpg`,
  face_count: 1,
  face_photo_url: null,
});

const onToggleMap = vi.fn<() => void>();
// jsdom does not scroll; the map button asks for it when the map opens
const scrollTo = () => vi.spyOn(window, "scrollTo").mockImplementation(() => {});

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  onToggleMap.mockReset();
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function header(props: Partial<React.ComponentProps<typeof EventSubHeader>> = {}) {
  return (
    <EventSubHeader
      people={[]}
      hasGPSCoordinates
      showMap={false}
      onToggleMap={onToggleMap}
      locationNames={[]}
      {...props}
    />
  );
}

const mapButton = () => document.body.querySelector("button");

describe("EventSubHeader", () => {
  it("shows at most five people and no map without positions", async () => {
    await renderInMantine(header({ people: [1, 2, 3, 4, 5, 6].map(person), hasGPSCoordinates: false }));

    expect(document.body.querySelectorAll("img").length).toBe(5);
    expect(mapButton()).toBeNull();
  });

  it("names the map after the first place and brings it into view when it opens", async () => {
    const scroll = scrollTo();
    await renderInMantine(header({ locationNames: ["Porto", "Gaia"] }));

    expect(mapButton()?.textContent).toBe("Porto on map");
    await click(mapButton() ?? document.body);
    expect(onToggleMap).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("says Show Map without a place, and Hide Map while it is open", async () => {
    const scroll = scrollTo();
    const { rerender } = await renderInMantine(header());
    expect(mapButton()?.textContent).toBe("Show Map");

    await rerender(header({ showMap: true }));
    expect(mapButton()?.textContent).toBe("Hide Map");
    await click(mapButton() ?? document.body);
    expect(onToggleMap).toHaveBeenCalledTimes(1);
    expect(scroll).not.toHaveBeenCalled();
  });
});
