/**
 * The Features card of the site settings (#2217): a switch saves its boolean at once, a switch the
 * server environment locked is disabled and names the variable, and the line under a switch follows
 * the model download.
 */
import type { SiteFeatures, SiteModelDownload, SiteSettingsUpdate } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { FeaturesCard } from "./FeaturesCard";

type SaveOptions = { onSuccess?: () => void; onSettled?: () => void };
type Settings = { features?: SiteFeatures; model_download?: SiteModelDownload | null };

const on = { enabled: true, locked: false, model_ready: null };

const mocks = vi.hoisted(() => {
  const settingsQuery: { data: Settings | undefined } = { data: undefined };
  return {
    settingsQuery,
    save: vi.fn<(input: SiteSettingsUpdate, options?: SaveOptions) => void>(),
    success: vi.fn<(message: string, options?: { id?: string }) => void>(),
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  Trans: ({ i18nKey, values }: { i18nKey: string; values: { variable: string } }) => `${i18nKey} ${values.variable}`,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ params, children }: { params: { id: string }; children?: React.ReactNode }) => (
    <a href={`/admin/job/${params.id}`}>{children}</a>
  ),
}));
vi.mock("../../service/notifications", () => ({ notification: { success: mocks.success } }));
vi.mock("../../api_client/settings/hooks", () => ({
  useGetSettingsQuery: () => mocks.settingsQuery,
  useUpdateSettingsMutation: () => ({ mutate: mocks.save }),
  // Followed live in the hook's own test; here the card shows what the settings say.
  useFollowModelDownload: (download: SiteModelDownload | null | undefined) => download,
}));

function features(overrides: Partial<SiteFeatures> = {}): SiteFeatures {
  return {
    video: on,
    face_detection: { ...on, model_ready: true },
    face_cluster: on,
    image_captioning: { ...on, model_ready: true },
    reverse_geocoding: on,
    scene_classification: { ...on, model_ready: true },
    ...overrides,
  };
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
});

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  mocks.save.mockReset();
  mocks.success.mockReset();
  mocks.settingsQuery.data = { features: features(), model_download: null };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(
      <MantineProvider>
        <FeaturesCard />
      </MantineProvider>
    );
  });
}

function switchOf(name: string): HTMLInputElement {
  const input = container.querySelector(`#site-feature-${name}`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`no switch for ${name}`);
  return input;
}

async function toggle(name: string) {
  await act(async () => {
    switchOf(name).click();
  });
}

function lastSaveOptions(): SaveOptions {
  return defined(defined(mocks.save.mock.calls.at(-1))[1]);
}

describe("FeaturesCard", () => {
  it("renders nothing for a backend or a user without switches", async () => {
    mocks.settingsQuery.data = {};
    await render();
    expect(container.querySelector("input")).toBeNull();
    expect(container.textContent).not.toContain("sitesettings.features_header");
  });

  it("lists every feature, on by default", async () => {
    await render();
    for (const name of [
      "face_detection",
      "face_cluster",
      "image_captioning",
      "scene_classification",
      "reverse_geocoding",
      "video",
    ]) {
      expect(switchOf(name).checked).toBe(true);
    }
  });

  it("posts the boolean when a switch is toggled and confirms the save", async () => {
    await render();
    await toggle("video");
    expect(defined(mocks.save.mock.calls[0])[0]).toEqual({ video_enabled: false });
    // The switch shows the new value while the save runs, with what turning it off skips.
    expect(switchOf("video").checked).toBe(false);
    expect(container.textContent).toContain("sitesettings.feature_video_off");
    await act(async () => lastSaveOptions().onSuccess?.());
    expect(mocks.success).toHaveBeenCalledWith(
      "sitesettings.saved",
      expect.objectContaining({ id: "site-settings-saved" })
    );
  });

  it("flips the switch back when the save fails", async () => {
    await render();
    await toggle("face_cluster");
    expect(switchOf("face_cluster").checked).toBe(false);
    // The QueryClient toasts the refusal; the card only lets the stored value show again.
    await act(async () => lastSaveOptions().onSettled?.());
    expect(switchOf("face_cluster").checked).toBe(true);
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("renders a locked feature as a disabled switch that names the variable", async () => {
    mocks.settingsQuery.data = {
      features: features({ image_captioning: { enabled: false, locked: true, model_ready: true } }),
    };
    await render();
    const locked = switchOf("image_captioning");
    expect(locked.disabled).toBe(true);
    expect(locked.checked).toBe(false);
    expect(container.textContent).toContain("sitesettings.feature_locked");
    expect(container.textContent).toContain("FEATURE_IMAGE_CAPTIONING");
    expect(switchOf("video").disabled).toBe(false);
  });

  it("follows a running model download under a switch whose model is missing", async () => {
    mocks.settingsQuery.data = {
      features: features({ face_detection: { ...on, model_ready: false } }),
      model_download: { id: 42, status: "running", progress_current: 3, progress_target: 12 },
    };
    await render();
    expect(container.textContent).toContain("sitesettings.feature_model_downloading");
    expect(container.querySelector('a[href="/admin/job/42"]')).not.toBeNull();
  });

  it("offers a retry when the download failed, which posts the switch again", async () => {
    mocks.settingsQuery.data = {
      features: features({ face_detection: { ...on, model_ready: false } }),
      model_download: { id: 7, status: "failed", progress_current: 1, progress_target: 12 },
    };
    await render();
    expect(container.textContent).toContain("sitesettings.feature_model_failed");
    const retry = defined(
      [...container.querySelectorAll("button")].find(button => button.textContent === "sitesettings.feature_retry")
    );
    await act(async () => retry.click());
    expect(defined(mocks.save.mock.calls[0])[0]).toEqual({ face_detection_enabled: true });
  });

  it("says a model is ready, or not downloaded yet", async () => {
    mocks.settingsQuery.data = {
      features: features({ image_captioning: { ...on, model_ready: false } }),
      model_download: { id: 3, status: "finished", progress_current: 12, progress_target: 12 },
    };
    await render();
    expect(container.textContent).toContain("sitesettings.feature_model_ready");
    expect(container.textContent).toContain("sitesettings.feature_model_missing");
  });
});
