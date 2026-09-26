/**
 * The way into manual face tagging (issue #431).
 *
 * The People section is where a face gets named, so it is also where a face the
 * detector never found has to be addable -- which is exactly the case where the
 * section used to render nothing at all, because it bailed out on an empty list.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { PeopleSection } from "./PeopleSection";

vi.mock("../../api_client/apiClient", () => ({ serverAddress: "" }));
vi.mock("../../service/notifications", () => ({ notification: new Proxy({}, { get: () => () => {} }) }));
vi.mock("../../api_client/faces", () => ({
  useSetFacesPersonLabelMutation: () => ({ mutate: vi.fn() }),
  useDeleteFacesMutation: () => ({ mutate: vi.fn() }),
  FacesTab: { enum: { inferred: "inferred", unknown: "unknown", labeled: "labeled" } },
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  getRouteApi: () => ({ useSearch: () => ({ tab: "inferred" }) }),
}));

const onAddFaceRequest = vi.fn();
const onCancelAddFace = vi.fn();

beforeAll(async () => {
  // @ts-ignore - jsdom has no matchMedia, MantineProvider needs it
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  onAddFaceRequest.mockReset();
  onCancelAddFace.mockReset();
});

async function renderSection(overrides: Record<string, unknown> = {}, people: unknown[] = []) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <PeopleSection
          photoDetail={{ people } as any}
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
  ) as HTMLButtonElement | undefined;
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
      addButton(container)!.click();
    });

    expect(onAddFaceRequest).toHaveBeenCalledOnce();
  });

  it("explains the drag and offers a way out while drawing", async () => {
    const container = await renderSection({ isDrawingFace: true });

    expect(container.textContent).toContain("Drag a box around the face");
    expect(addButton(container)).toBeUndefined();

    const cancel = Array.from(container.querySelectorAll("button")).find(b => b.textContent === "Cancel")!;
    await act(async () => {
      cancel.click();
    });

    expect(onCancelAddFace).toHaveBeenCalledOnce();
  });

  it("disables the button when the photo is turned, where a drawn box would not line up", async () => {
    const container = await renderSection({ addFaceBlockedReason: "Turn the photo back upright to add a face" });

    expect(addButton(container)!.disabled).toBe(true);
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
});
