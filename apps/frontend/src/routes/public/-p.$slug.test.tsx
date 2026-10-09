/**
 * A single photo shared by link. The server never converts a video for a
 * visitor without an account, so one the browser cannot decode has nowhere to
 * fall back to: the page says so and offers the file, instead of a dead
 * player, up front when the server's playback type is one the browser says it
 * cannot play. The capture time is the camera's wall clock and must not move
 * with the visitor's time zone. The tab is named after the photo.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as
 * a route (its `routeFileIgnorePrefix`).
 */
import { MantineProvider } from "@mantine/core";
import { Settings } from "luxon";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  component: undefined as React.ComponentType | undefined,
  photo: undefined as object | undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => {
    const route = (options?: { component?: React.ComponentType }) => {
      stubs.component = options?.component;
      return route;
    };
    route.useParams = () => ({ slug: "s1" });
    return route;
  },
  Link: ({ children }: { children?: React.ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock("../../api_client/apiClient", () => ({ serverAddress: "" }));
vi.mock("../../api_client/photos/hooks", () => ({
  useFetchSharedPhotoQuery: () => ({ data: stubs.photo, isLoading: false, isError: false }),
}));
vi.mock("../../i18n", () => ({ i18nResolvedLanguage: () => "en" }));

const defaultZone = Settings.defaultZone;

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
  await import("./p.$slug");
});

afterAll(() => {
  Settings.defaultZone = defaultZone;
});

const mounted: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (mounted.length) await mounted.pop()!();
  stubs.photo = undefined;
});

async function renderPage() {
  const Page = stubs.component!;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <Page />
      </MantineProvider>
    );
  });
  mounted.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  return container;
}

const shared = {
  video: true,
  video_url: "/media/public_photo/s1.mp4",
  thumbnail_url: "/media/public_photo/s1.jpg",
  exif_timestamp: "2024-04-01T01:00:00Z",
  captions_json: {},
};

describe("shared photo page", () => {
  it("plays the video, and says why when the browser cannot", async () => {
    stubs.photo = shared;
    const container = await renderPage();
    expect(container.textContent).not.toContain("publicphoto.videoUnsupported");

    await act(async () => {
      container.querySelector("video")!.dispatchEvent(new Event("error"));
    });

    expect(container.querySelector("video")).toBeNull();
    expect(container.textContent).toContain("lightbox.videoerror.formattitle");
    expect(container.textContent).toContain("publicphoto.videoUnsupported");
    const download = container.querySelector<HTMLAnchorElement>("a[download]");
    expect(download?.getAttribute("href")).toBe("/media/public_photo/s1.mp4");
  });

  it("offers the download right away for a format the browser cannot play", async () => {
    const canPlayType = vi
      .spyOn(HTMLMediaElement.prototype, "canPlayType")
      .mockImplementation(type => (type.includes("hvc1") ? "" : "maybe"));
    stubs.photo = { ...shared, video_playback_type: 'video/mp4; codecs="hvc1.2.4.L120.90"' };
    try {
      const container = await renderPage();

      expect(container.querySelector("video")).toBeNull();
      expect(container.textContent).toContain("publicphoto.videoUnsupported");
    } finally {
      canPlayType.mockRestore();
    }
  });

  it("names the tab after the photo, and restores it on leaving", async () => {
    stubs.photo = { ...shared, video: false, video_url: null, captions_json: { user_caption: "Beach day" } };
    await renderPage();
    expect(document.title).toBe("Beach day · LibrePhotos");

    while (mounted.length) await mounted.pop()!();
    expect(document.title).toBe("LibrePhotos");
  });

  it("shows the camera's wall-clock time whatever the visitor's zone", async () => {
    Settings.defaultZone = "America/New_York";
    stubs.photo = { ...shared, video: false, video_url: null };

    const container = await renderPage();

    // 01:00 where the camera was; read as an instant it would be 9 PM the day before.
    expect(container.textContent).toContain("Apr 1, 2024");
    expect(container.textContent).toMatch(/1:00\sAM/);
  });
});
