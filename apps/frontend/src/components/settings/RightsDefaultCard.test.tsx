/**
 * Settings > Metadata, "Rights for your photos" (#425): the default is edited with the other settings,
 * and "Apply to my photos" runs only on a saved default, after saying how many photos it reaches.
 */
import { User, type RightsDefaultCountsResponse, type RightsKeep } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { RightsDefaultCard } from "./RightsDefaultCard";

const mocks = vi.hoisted(() => ({
  counts: { total: 120, missing: 30 } as RightsDefaultCountsResponse,
  apply: vi.fn<(keep: RightsKeep, options?: { onSuccess?: () => void }) => void>(),
  onChange: vi.fn<(patch: Record<string, unknown>) => void>(),
}));

vi.mock("../../api_client/photos/hooks", () => ({
  useRightsDefaultCountsQuery: () => ({ data: mocks.counts, isError: false, error: null }),
  useApplyRightsDefaultMutation: () => ({ mutate: mocks.apply, isPending: false }),
}));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: undefined }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));

let root: Root;
let container: HTMLDivElement;

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
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  mocks.apply.mockReset();
  mocks.onChange.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

/** A saved user with the default rights `fields`; the rest as a fresh account has it. */
function userWith(fields: { default_license?: string; default_creator?: string; default_copyright?: string }): User {
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
    save_face_tags_to_disk: false,
    datetime_rules: "[]",
    default_timezone: "UTC",
    public_sharing: false,
    min_cluster_size: 0,
    min_samples: 1,
    cluster_selection_epsilon: 0.05,
    llm_settings: null,
    default_license: "",
    default_creator: "",
    default_copyright: "",
    ...fields,
  });
}

async function render(user: User, saved: User = user) {
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <RightsDefaultCard user={user} saved={saved} onChange={mocks.onChange} />
      </MantineProvider>
    );
  });
}

const applyButton = () =>
  defined(Array.from(container.querySelectorAll("button")).find(b => b.textContent === i18n.t("rights.default.apply")));

describe("RightsDefaultCard", () => {
  it("edits the default with the other settings", async () => {
    await render(userWith({}));
    const creator = defined(container.querySelector<HTMLInputElement>("input"));
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(creator, "Anna");
      creator.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(mocks.onChange).toHaveBeenCalledWith({ default_creator: "Anna" });
  });

  it("cannot apply without a saved default, or before the changes are saved", async () => {
    await render(userWith({}));
    expect(applyButton().getAttribute("aria-disabled")).toBe("true");

    await render(userWith({ default_license: "cc-by-4.0" }), userWith({}));
    expect(applyButton().getAttribute("aria-disabled")).toBe("true");
  });

  it("applies a saved default to the photos that miss it, or to every photo", async () => {
    const user = userWith({ default_license: "cc-by-4.0" });
    await render(user);
    expect(applyButton().getAttribute("aria-disabled")).toBeNull();
    await act(async () => applyButton().click());

    expect(document.body.textContent).toContain("Only fill in what is missing: 30 photos");
    const submit = () => act(async () => defined(document.querySelector("form")).requestSubmit());
    await submit();
    expect(mocks.apply.mock.calls[0]?.[0]).toBe("any");

    const every = defined(document.querySelector<HTMLInputElement>("input[value=all]"));
    await act(async () => every.click());
    expect(document.body.textContent).toContain("Apply to 120 photos");
    await submit();
    expect(mocks.apply.mock.calls[1]?.[0]).toBe("none");
  });
});
