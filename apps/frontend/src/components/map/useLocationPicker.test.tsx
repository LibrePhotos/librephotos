/**
 * "Use my location" asks the browser, which may answer seconds later. That late answer replaced a
 * spot picked by hand meanwhile, and a second click started a second request.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { useLocationPicker, type LocationPicker } from "./useLocationPicker";

type Answer = { succeed: (lat: number, lon: number) => void; fail: (code: number) => void };

const requests: Answer[] = [];
const getCurrentPosition = vi.fn<Geolocation["getCurrentPosition"]>((success, failure) => {
  requests.push({
    succeed: (latitude, longitude) =>
      success({
        coords: {
          latitude,
          longitude,
          accuracy: 5,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
          toJSON: () => ({}),
        },
        timestamp: 0,
        toJSON: () => ({}),
      }),
    fail: code =>
      failure?.({
        code,
        message: "",
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      }),
  });
});

let root: Root;
let latest: LocationPicker | undefined;

function Probe() {
  latest = useLocationPicker(null);
  return null;
}

const picker = () => defined(latest);

beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(async () => {
  requests.length = 0;
  getCurrentPosition.mockClear();
  vi.stubGlobal("navigator", { ...navigator, geolocation: { getCurrentPosition } });
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("useLocationPicker's use my location", () => {
  it("moves to the browser's answer", async () => {
    await act(async () => picker().useMyLocation());
    expect(picker().isGeolocating).toBe(true);
    await act(async () => defined(requests[0]).succeed(48.1, 11.5));
    expect(picker().position).toEqual([48.1, 11.5]);
    expect(picker().isGeolocating).toBe(false);
  });

  it("asks once while an answer is awaited", async () => {
    await act(async () => picker().useMyLocation());
    await act(async () => picker().useMyLocation());
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it("keeps a spot picked by hand over a late answer", async () => {
    await act(async () => picker().useMyLocation());
    await act(async () => picker().pick(52.5, 13.4));
    expect(picker().isGeolocating).toBe(false);

    await act(async () => defined(requests[0]).succeed(48.1, 11.5));
    expect(picker().position).toEqual([52.5, 13.4]);
  });

  it("says why it failed", async () => {
    await act(async () => picker().useMyLocation());
    await act(async () => defined(requests[0]).fail(1));
    expect(picker().geolocationError).toBe(i18n.t("locationpicker.permission_denied"));
    expect(picker().isGeolocating).toBe(false);
  });
});
