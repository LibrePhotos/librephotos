/**
 * The Cluster Selection Epsilon choices of the Face Options card (#1996): they are distances
 * between unit-length face encodings, and a saved Off (0) shows as Off rather than as a fallback.
 */
import { User } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { FaceOptionsCard } from "./FaceOptionsCard";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./SettingsSection", () => ({ SectionLink: () => null }));

function userWith(cluster_selection_epsilon: number): User {
  return User.parse({
    id: 1,
    username: "admin",
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
    cluster_selection_epsilon,
    llm_settings: null,
  });
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
const onChange = vi.fn<(patch: Partial<User>) => void>();

beforeEach(() => {
  onChange.mockReset();
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

async function render(epsilon: number) {
  await act(async () => {
    root.render(
      <MantineProvider>
        <FaceOptionsCard user={userWith(epsilon)} onChange={onChange} />
      </MantineProvider>
    );
  });
}

function labelOf(radio: HTMLInputElement): string | undefined {
  return container.querySelector(`label[for="${radio.id}"]`)?.textContent ?? undefined;
}

/** The radios of the group that has an Off choice: the only one on this card. */
function epsilonRadios(): HTMLInputElement[] {
  const radios = [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  const off = radios.find(radio => labelOf(radio) === "settings.size.off");
  if (!off) throw new Error("no Cluster Selection Epsilon group");
  return radios.filter(radio => radio.name === off.name);
}

function checkedLabel(): string | undefined {
  const checked = epsilonRadios().find(radio => radio.checked);
  return checked ? labelOf(checked) : undefined;
}

describe("FaceOptionsCard: Cluster Selection Epsilon", () => {
  it("offers distances on the unit-length scale, Off to Very High", async () => {
    await render(0.95);
    expect(epsilonRadios().map(radio => radio.value)).toEqual(["0", "0.9", "0.95", "1", "1.05"]);
  });

  it.each([
    [0, "settings.size.off"],
    [0.9, "settings.size.small"],
    [0.95, "settings.size.normal"],
    [1, "settings.size.high"],
    [1.05, "settings.size.veryhigh"],
  ])("shows a saved %s as %s", async (epsilon, label) => {
    await render(epsilon);
    expect(checkedLabel()).toBe(label);
  });

  it("saves the distance of the chosen option", async () => {
    await render(0.95);
    await act(async () => {
      defined(epsilonRadios()[3]).click();
    });
    expect(onChange).toHaveBeenCalledWith({ cluster_selection_epsilon: 1 });
  });
});
