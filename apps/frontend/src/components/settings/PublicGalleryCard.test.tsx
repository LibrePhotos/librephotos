/**
 * Taking part in the public gallery (#434): off until the user turns it on, shown only while the
 * admin has the gallery open, with what visitors see of the user's photos from their public sharing
 * switches as they stand.
 */
import { User } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { PublicGalleryCard } from "./PublicGalleryCard";

const stubs = vi.hoisted(() => ({ stage: "everyone" as string | undefined }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/public">{children}</a>,
}));
vi.mock("../../api_client/settings/hooks", () => ({
  useGetSettingsQuery: () => ({ data: { public_gallery: stubs.stage } }),
}));
vi.mock("./SettingsSection", () => ({ SectionLink: () => null }));

const DEFAULTS = {
  share_timestamps: false,
  share_location: true,
  share_camera_info: false,
  share_captions: false,
  share_faces: false,
};

function userWith(fields: Partial<User>): User {
  return User.parse({
    id: 1,
    username: "anna",
    email: "",
    confidence: 0.1,
    transcode_videos: false,
    semantic_search_topk: 0,
    first_name: "",
    last_name: "",
    public_photo_samples: [],
    public_photo_count: 0,
    date_joined: "2026-01-01T00:00:00Z",
    photo_count: 0,
    favorite_min_rating: 4,
    image_scale: 2,
    save_metadata_to_disk: "OFF",
    datetime_rules: "[]",
    default_timezone: "UTC",
    public_sharing: false,
    min_cluster_size: 0,
    min_samples: 1,
    cluster_selection_epsilon: 0.05,
    llm_settings: null,
    public_sharing_defaults: DEFAULTS,
    ...fields,
  });
}

beforeAll(async () => {
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
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

let root: Root | undefined;
const onChange = vi.fn<(patch: Partial<User>) => void>();

beforeEach(() => {
  stubs.stage = "everyone";
  onChange.mockReset();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = "";
});

async function render(user: Partial<User>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    defined(root).render(
      <MantineProvider env="test">
        <PublicGalleryCard user={userWith(user)} onChange={onChange} />
      </MantineProvider>
    )
  );
  return container;
}

/** Each row of the preview with its badge: "The town they were taken in: Shown". */
function rows(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".mantine-Group-root")].map(row => {
    const [label, badge] = [...row.children].map(child => child.textContent);
    return `${label}: ${badge}`;
  });
}

describe("the public gallery card", () => {
  it("is off until the user turns it on", async () => {
    const container = await render({});
    const optIn = defined(container.querySelector<HTMLInputElement>("input[type=checkbox]"));
    expect(optIn.checked).toBe(false);
    await act(async () => optIn.click());
    expect(onChange).toHaveBeenCalledWith({ in_public_gallery: true });
  });

  it("shows what visitors see from the sharing switches, and that undated photos have no order", async () => {
    const container = await render({ in_public_gallery: true });
    expect(rows(container)).toEqual([
      "Your public photos and videos: Always",
      "Your name: Always",
      "When they were taken: Hidden",
      "The town they were taken in: Shown",
      "The names of the people you named: Hidden",
      "Camera details, on the photo: Hidden",
      "Captions, on the photo: Hidden",
    ]);
    expect(container.textContent).toContain("in no particular order");
  });

  it("says when only members see the gallery", async () => {
    stubs.stage = "members";
    const container = await render({});
    expect(container.textContent).toContain("Every signed-in user of this server sees");
  });

  it("is not shown while the gallery is off, or by a server without one", async () => {
    for (const stage of ["off", undefined]) {
      stubs.stage = stage;
      const container = await render({});
      expect(container.querySelector(".mantine-Card-root")).toBeNull();
      await act(async () => root?.unmount());
    }
    root = undefined;
  });
});
