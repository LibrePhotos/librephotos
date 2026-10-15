/**
 * The Settings page no longer offers the two face confidence inputs (#2196):
 * nothing on the server read them. The face options card stays.
 *
 * The Caption Context card reads its title and main switch from the
 * settings.captioncontext* keys (#2219), so translations made for the old
 * "Large Language Model" wording no longer show up there.
 *
 * Every card has an anchor for the section navigation (#2226).
 *
 * "Write edits to files" says what each option writes, the default time zone what it is used for,
 * and each public sharing switch what it shows (#2273, #2281).
 *
 * The rating style (#2202) says what un-favoriting does to a star rating.
 */
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { Settings } from "./Settings";

const mocks = vi.hoisted(() => ({
  user: {} as Record<string, unknown>,
  mutate: vi.fn<(user: unknown) => void>(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => async () => {},
  useLocation: ({ select }: { select: (location: { hash: string }) => string }) => select({ hash: "" }),
}));
vi.mock("../../api_client/auth", () => ({
  useAccessToken: () => ({ data: { access: { user_id: 1 } } }),
}));
vi.mock("../../api_client/settings", () => ({
  useFetchTimezonesQuery: () => ({ data: ["UTC"] }),
}));
vi.mock("../../api_client/user/hooks", () => ({
  useFetchUserSelfDetailsQuery: () => ({ data: mocks.user }),
  useUpdateUserMutation: () => ({ mutate: mocks.mutate, isPending: false }),
}));
vi.mock("./ConfigBurstDetection", () => ({ ConfigBurstDetection: () => null }));
vi.mock("./ConfigDateTime", () => ({ ConfigDateTime: () => null }));
// Its own test: WriteExistingEditsRow.test.tsx.
vi.mock("./WriteExistingEditsRow", () => ({ WriteExistingEditsRow: () => null }));
vi.mock("./SaveChangesDialog", () => ({ SaveChangesDialog: () => null }));

beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // The assertions read the English labels.
  await i18n.changeLanguage("en");
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
  // jsdom has no ResizeObserver, Mantine's ScrollArea needs it
  globalThis.ResizeObserver = class ResizeObserverStub implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(async () => {
  mocks.mutate.mockReset();
  mocks.user = {
    id: 1,
    username: "admin",
    email: "admin@example.com",
    confidence: 0.1,
    confidence_person: 0.9,
    confidence_unknown_face: 0.5,
    min_cluster_size: 0,
    min_samples: 1,
    cluster_selection_epsilon: 0.1,
    save_face_tags_to_disk: false,
    llm_settings: {},
    default_timezone: "UTC",
    default_timeline_filter: {},
    rating_mode: "favorite",
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MantineProvider>
          <Settings />
        </MantineProvider>
      </QueryClientProvider>
    );
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("Settings section anchors", () => {
  it("gives every card a stable id and lists it in the section navigation", () => {
    const ids = [
      "settings-scan",
      "settings-metadata",
      "settings-faces",
      "settings-datetime",
      "settings-burst",
      "settings-experimental",
      "settings-captions",
      "settings-sharing",
      "settings-interface",
      "settings-duplicates",
    ];
    for (const id of ids) {
      expect(document.getElementById(id)?.tagName, id).toBe("SECTION");
    }
    const toc = container.querySelector('nav[aria-label="On this page"]');
    expect([...(toc?.querySelectorAll("a") ?? [])].map(link => link.getAttribute("href"))).toEqual(
      ids.map(id => `#${id}`)
    );
  });
});

describe("Settings face options", () => {
  it("still renders the face options card", () => {
    expect(container.textContent).toContain("Minimum Samples");
    expect(container.textContent).toContain("Cluster Selection Epsilon");
  });

  it("no longer offers the inferred faces confidence input", () => {
    expect(container.textContent).not.toContain("Inferred faces confidence");
    expect(container.textContent).not.toContain("Album Options");
  });

  it("no longer offers the unknown - other faces confidence input", () => {
    expect(container.textContent).not.toContain("Confidence when Matching Unknown - Other Faces");
  });
});

describe("Settings caption context", () => {
  it("labels the card and its main switch with the caption context strings", () => {
    expect(container.textContent).toContain("Caption Context");
    expect(container.textContent).toContain("Tell the captioning model what LibrePhotos knows about a photo");
    expect(container.textContent).not.toContain("settings.");
  });
});

describe("Settings face tags write-back", () => {
  function inputLabelled(text: string): HTMLInputElement {
    // A Mantine Switch's <label> also holds its description, so match the text
    // on the label or any element inside it.
    const labelled = Array.from(container.querySelectorAll("label, label *")).find(
      element => element.textContent === text
    );
    const label = labelled?.closest("label");
    const input = label?.htmlFor ? document.getElementById(label.htmlFor) : label?.querySelector("input");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error(`no input labelled "${text}"`);
    }
    return input;
  }

  it("disables the face tags switch while metadata sync is Off (#2293)", () => {
    expect(inputLabelled("Write face tags to image files").disabled).toBe(true);
    expect(container.textContent).toContain('Needs "Save to sidecar" or "Save to media file"');
  });

  it("enables the face tags switch once metadata is synced to a sidecar", async () => {
    await act(async () => {
      inputLabelled("Save to sidecar").click();
    });

    expect(inputLabelled("Write face tags to image files").disabled).toBe(false);
    expect(container.textContent).not.toContain('Needs "Save to sidecar"');
  });
});

describe("Settings write edits to files (#2281)", () => {
  /** The text of the radio option labelled `label`, its description included. */
  function optionText(label: string): string {
    const labelElement = Array.from(container.querySelectorAll("label")).find(element => element.textContent === label);
    const root = labelElement?.closest(".mantine-Radio-root");
    if (!root) throw new Error(`no radio option labelled "${label}"`);
    return root.textContent ?? "";
  }

  it("is called Write edits to files and no longer lists edits it does not write", () => {
    expect(container.textContent).toContain("Write edits to files");
    expect(container.textContent).not.toContain("Synchronize metadata to disk");
    expect(container.textContent).toContain("Copies your edits into your files, so other apps see them.");
    expect(container.textContent).not.toContain("Not written yet");
  });

  it("says what each option writes, from the one list of written fields", () => {
    expect(optionText("Off")).toContain("Your files are never changed.");
    expect(optionText("Save to sidecar")).toContain(
      "Writes ratings, dates, rotations, captions, tags, and locations to an .xmp file next to the photo. The photo itself is not changed."
    );
    expect(optionText("Save to media file")).toContain(
      "Writes ratings, dates, rotations, captions, tags, and locations into the photo file itself."
    );
  });

  it("warns that the media file option changes the originals", () => {
    expect(optionText("Save to media file")).toContain("This changes your originals, so keep a backup.");
  });

  it("says that only JPEG, PNG, TIFF and WebP files get the rotation (#2297)", () => {
    expect(optionText("Save to media file")).toContain(
      "Rotations are only written into JPEG, PNG, TIFF and WebP files; other formats, such as HEIC, AVIF and RAW, keep their rotation in LibrePhotos."
    );
  });

  it("points the face tag switch at the renamed setting", () => {
    expect(container.textContent).toContain('under "Write edits to files"');
  });
});

describe("Settings default time zone (#2273)", () => {
  it("explains what the time zone is used for", () => {
    expect(container.textContent).toContain('Used by date rules that say "in user default timezone"');
    expect(container.textContent).toContain("It does not change how dates are displayed.");
    expect(container.textContent).toContain("Run Rescan after changing it to re-date existing photos.");
  });
});

describe("Settings public sharing (#2273)", () => {
  it("says the switches apply to links already created", () => {
    expect(container.textContent).toContain(
      "Photo links always use these settings, including links you already created."
    );
  });

  it("describes each of the five switches", () => {
    const card = document.getElementById("settings-sharing");
    const descriptions = Array.from(card?.querySelectorAll(".mantine-Switch-description") ?? []).map(
      element => element.textContent
    );
    expect(descriptions).toEqual([
      "Show when photos were taken",
      "Show where photos were taken",
      "Show camera make, model, and settings",
      "Show photo descriptions",
      "Show recognized people in photos",
    ]);
  });
});

describe("Settings rating style (#2202)", () => {
  it("defaults to Favorites and says that removing a favorite clears the star rating", () => {
    expect(container.textContent).toContain("Rating style");
    expect(container.textContent).toContain("removing a favorite sets it to 0");
  });

  it("describes stars mode once Stars is picked", async () => {
    const stars = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]')).find(
      input => input.value === "stars"
    );
    if (!stars) throw new Error("no Stars option");
    await act(async () => stars.click());

    expect(stars.checked).toBe(true);
    expect(container.textContent).toContain("Rate photos with 1 to 5 stars");
    expect(container.textContent).not.toContain("removing a favorite sets it to 0");
  });
});
