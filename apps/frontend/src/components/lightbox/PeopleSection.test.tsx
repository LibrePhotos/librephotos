/**
 * The way into manual face tagging (issue #431).
 *
 * The People section is where a face gets named, so it is also where a face the
 * detector never found has to be addable -- which is exactly the case where the
 * section used to render nothing at all, because it bailed out on an empty list.
 */
import type { PhotoPerson } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DetectFacesOutcome, DrawnFaceOutcome } from "../../api_client/faces";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import {
  expectDisabledWithReason,
  focusAndReadTooltip,
  hoverAndReadTooltip,
} from "../common/disabledReason.test-utils";
import { PeopleSection } from "./PeopleSection";

vi.mock("../../api_client/urls", () => ({ serverAddress: "" }));
vi.mock("../../service/notifications", () => ({ notification: new Proxy({}, { get: () => () => {} }) }));
const detect = vi.hoisted(() => ({
  outcome: null as DetectFacesOutcome | null,
  photoId: "" as string | undefined,
  drawn: null as DrawnFaceOutcome | null,
  imageHash: "" as string | undefined,
}));
vi.mock("../../api_client/faces", () => ({
  useSetFacesPersonLabelMutation: () => ({ mutate: vi.fn<(...args: unknown[]) => void>() }),
  useDeleteFacesMutation: () => ({ mutate: vi.fn<(...args: unknown[]) => void>() }),
  useDetectFacesReport: (photoId: string | undefined) => {
    detect.photoId = photoId;
    return detect.outcome;
  },
  useDrawnFaceResult: (imageHash: string | undefined) => {
    detect.imageHash = imageHash;
    return detect.drawn;
  },
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn<(options: unknown) => void>(),
  getRouteApi: () => ({ useSearch: () => ({ tab: "inferred" }) }),
}));

const onAddFaceRequest = vi.fn<() => void>();
const onCancelAddFace = vi.fn<() => void>();

beforeAll(async () => {
  // jsdom has no matchMedia, MantineProvider needs it
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

beforeEach(() => {
  document.body.innerHTML = "";
  onAddFaceRequest.mockReset();
  onCancelAddFace.mockReset();
  detect.outcome = null;
  detect.drawn = null;
});

async function renderSection(
  overrides: Partial<React.ComponentProps<typeof PeopleSection>> = {},
  people: PhotoPerson[] = []
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <PeopleSection
          photoDetail={{ people }}
          isPublic={false}
          setFaceLocation={() => {}}
          onPersonEdit={() => {}}
          notThisPerson={() => {}}
          onAddFaceRequest={onAddFaceRequest}
          onCancelAddFace={onCancelAddFace}
          {...overrides}
        />
      </MantineProvider>
    );
  });
  return container;
}

function addButton(container: HTMLElement): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find(button =>
    button.querySelector(".tabler-icon-user-plus")
  );
}

describe("adding a face the scan missed", () => {
  it("offers the add button on a photo with no faces at all", async () => {
    const container = await renderSection();

    expect(addButton(container)).toBeDefined();
    expect(container.textContent).toContain("No faces were found in this photo");
  });

  it("asks for the box when the button is pressed", async () => {
    const container = await renderSection();

    await act(async () => {
      defined(addButton(container)).click();
    });

    expect(onAddFaceRequest).toHaveBeenCalledOnce();
  });

  it("explains the drag and offers a way out while drawing", async () => {
    const container = await renderSection({ isDrawingFace: true });

    expect(container.textContent).toContain("Drag a box around the face");
    expect(addButton(container)).toBeUndefined();

    const cancel = defined(Array.from(container.querySelectorAll("button")).find(b => b.textContent === "Cancel"));
    await act(async () => {
      cancel.click();
    });

    expect(onCancelAddFace).toHaveBeenCalledOnce();
  });

  it("disables the button when the photo is turned, where a drawn box would not line up", async () => {
    const container = await renderSection({ addFaceBlockedReason: "Turn the photo back upright to add a face" });
    const button = defined(addButton(container));

    await act(async () => {
      button.click();
    });

    expect(onAddFaceRequest).not.toHaveBeenCalled();
    expectDisabledWithReason(button, "Turn the photo back upright to add a face");
  });

  // #2237: the reason was the tooltip of a `disabled` button, which never fires the events that open it.
  it.each([
    ["hover", hoverAndReadTooltip],
    ["keyboard focus", focusAndReadTooltip],
  ])("says why it is disabled on %s", async (_how, read) => {
    const container = await renderSection({ addFaceBlockedReason: "Turn the photo back upright to add a face" });

    expect(await read(defined(addButton(container)))).toContain("Turn the photo back upright to add a face");
  });

  it("does not offer it on someone else's shared photo", async () => {
    const container = await renderSection({ isPublic: true });

    expect(addButton(container)).toBeUndefined();
  });

  it("renders nothing at all when there is neither a face nor a way to add one", async () => {
    const container = await renderSection({ onAddFaceRequest: undefined });

    // MantineProvider drops a responsive style block in here, so look for the
    // section's own content rather than an empty container.
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("h4")).toBeNull();
    expect(container.textContent).not.toContain("No faces were found");
  });

  it("shows a card's heading in place of its own, keeping the add-face button", async () => {
    const container = await renderSection({ heading: <h2>People card</h2> });

    expect(container.querySelector("h2")?.textContent).toBe("People card");
    expect(container.querySelector("h4")).toBeNull();
    expect(addButton(container)).toBeDefined();
  });
});

const buttonWithText = (container: HTMLElement, text: string) =>
  defined(Array.from(container.querySelectorAll("button")).find(button => button.textContent === text));

describe("a rough box: the face is looked for in it (#1117)", () => {
  const drawn = (state: DrawnFaceOutcome["state"]) => ({ state, keepBox: vi.fn<() => void>() });

  it("reads the boxes drawn on this photo, not on a shared one", async () => {
    await renderSection({ photoDetail: { people: [], image_hash: "h1" } });
    expect(detect.imageHash).toBe("h1");

    await renderSection({ photoDetail: { people: [], image_hash: "h1" }, isPublic: true });
    expect(detect.imageHash).toBeUndefined();
  });

  it("says it is looking for the face", async () => {
    detect.drawn = drawn("finding");
    const container = await renderSection();

    expect(container.querySelector('[role="status"]')?.textContent).toContain("Looking for the face in your box");
  });

  it("offers to keep the box or to draw again when there is no face in it", async () => {
    const result = drawn("notfound");
    detect.drawn = result;
    const container = await renderSection();

    expect(container.textContent).toContain("No face found in the box");
    await act(async () => buttonWithText(container, "Keep my box").click());
    await act(async () => buttonWithText(container, "Draw again").click());

    expect(result.keepBox).toHaveBeenCalledOnce();
    expect(onAddFaceRequest).toHaveBeenCalledOnce();
  });

  it("does not offer to draw again where a face cannot be drawn", async () => {
    detect.drawn = drawn("notfound");
    const container = await renderSection({ onAddFaceRequest: undefined }, [
      {
        name: "Anna",
        face_id: 1,
        face_url: "",
        location: { top: 0, right: 1, bottom: 1, left: 0 },
        type: "user",
        probability: 1,
      },
    ]);

    expect(container.textContent).toContain("Keep my box");
    expect(container.textContent).not.toContain("Draw again");
  });
});

describe("Detect faces again on this photo answers here (#1117)", () => {
  const face = (faceId: number, name: string): PhotoPerson => ({
    name,
    face_id: faceId,
    face_url: `/media/faces/${faceId}.jpg`,
    location: { top: 0, right: 1, bottom: 1, left: 0 },
    type: "user",
    probability: 1,
  });
  const outcome = (state: DetectFacesOutcome["state"], newFaceIds: number[] = []): DetectFacesOutcome => ({
    state,
    newFaceIds,
    dismiss: vi.fn<() => void>(),
  });

  it("follows the scan of this photo, not on a shared one", async () => {
    await renderSection({ photoDetail: { people: [], id: "p1" } });
    expect(detect.photoId).toBe("p1");

    await renderSection({ photoDetail: { people: [], id: "p1" }, isPublic: true });
    expect(detect.photoId).toBeUndefined();
  });

  it("says it is still looking", async () => {
    detect.outcome = outcome("running");
    const container = await renderSection();

    expect(container.textContent).toContain("Looking for faces again");
  });

  it("marks the faces it found as new", async () => {
    detect.outcome = outcome("found", [2]);
    const container = await renderSection({}, [face(1, "Anna"), face(2, "Ben")]);

    expect(container.textContent).toContain("Found 1 new face");
    expect(container.querySelectorAll(".mantine-Badge-root")).toHaveLength(1);
  });

  it("offers to draw the face it did not find, and can be closed", async () => {
    const none = outcome("none");
    detect.outcome = none;
    const container = await renderSection();

    expect(container.textContent).toContain("No new face found");
    await act(async () => buttonWithText(container, "Draw the face").click());
    expect(onAddFaceRequest).toHaveBeenCalledOnce();

    await act(async () => defined(container.querySelector<HTMLButtonElement>('button[aria-label="Close"]')).click());
    expect(none.dismiss).toHaveBeenCalledOnce();
  });

  it("says when the scan failed", async () => {
    detect.outcome = outcome("failed");
    const container = await renderSection();

    expect(container.textContent).toContain("Faces could not be detected again");
  });
});
