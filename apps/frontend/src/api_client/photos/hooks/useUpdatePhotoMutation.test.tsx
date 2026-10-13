/**
 * #2253: a moved photo whose new spot the geocoder could not name answered
 * 200 like any edit, and the picker toasted "Photo edited" while the photo
 * lost its place name. The server now says `geocoded: false`, and the toast
 * says the place name was not looked up.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../../util/defined.test-utils";

const stubs = await vi.hoisted(async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    patch: vi.fn<(endpoint: string, data?: unknown) => Promise<unknown>>(),
    updatePhoto: vi.fn<() => void>(),
    locationSavedWithoutPlace: vi.fn<() => void>(),
    queryClient: new QueryClient(),
  };
});

vi.mock("../../api", () => ({ apiClient: { patch: stubs.patch }, queryClient: stubs.queryClient }));
vi.mock("../../../service/notifications", () => ({
  notification: { updatePhoto: stubs.updatePhoto, locationSavedWithoutPlace: stubs.locationSavedWithoutPlace },
}));

const { useUpdatePhotoMutation } = await import("./useUpdatePhotoMutation");

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  stubs.patch.mockReset();
  stubs.updatePhoto.mockReset();
  stubs.locationSavedWithoutPlace.mockReset();
});

async function save(data: Record<string, unknown>) {
  let mutateAsync: ReturnType<typeof useUpdatePhotoMutation>["mutateAsync"] | undefined;
  function Probe() {
    mutateAsync = useUpdatePhotoMutation().mutateAsync;
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      <QueryClientProvider client={stubs.queryClient}>
        <Probe />
      </QueryClientProvider>
    );
  });
  await act(async () => {
    await defined(mutateAsync)({ id: "abc", data });
  });
  await act(async () => root.unmount());
}

describe("useUpdatePhotoMutation", () => {
  it("says the place name was not looked up when a moved photo has none", async () => {
    stubs.patch.mockResolvedValueOnce({ image_hash: "abc", geocoded: false });

    await save({ exif_gps_lat: 36.5, exif_gps_lon: -6.3 });

    expect(stubs.locationSavedWithoutPlace).toHaveBeenCalledTimes(1);
    expect(stubs.updatePhoto).not.toHaveBeenCalled();
  });

  it("confirms a location edit that found a place", async () => {
    stubs.patch.mockResolvedValueOnce({ image_hash: "abc", geocoded: true });

    await save({ exif_gps_lat: 40.4, exif_gps_lon: -3.7 });

    expect(stubs.updatePhoto).toHaveBeenCalledTimes(1);
    expect(stubs.locationSavedWithoutPlace).not.toHaveBeenCalled();
  });

  it("confirms a date edit of a photo that has no place", async () => {
    stubs.patch.mockResolvedValueOnce({ image_hash: "abc", geocoded: false });

    await save({ exif_timestamp: "2021-06-05T04:03:02Z" });

    expect(stubs.updatePhoto).toHaveBeenCalledTimes(1);
    expect(stubs.locationSavedWithoutPlace).not.toHaveBeenCalled();
  });
});
