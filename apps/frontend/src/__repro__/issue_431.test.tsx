/**
 * Repro for https://github.com/LibrePhotos/librephotos/issues/431
 * "Manually edit face/person tags in a photo"
 *
 * The lightbox sidebar already lists every face on the photo, unnamed ones
 * included: PhotoSerializer.get_people returns them with `name: ""` and
 * `type: ""`. That row is the only place in the product where a face the
 * algorithms gave up on can be named -- but it rendered as a blank button with
 * no label, and it offered the same buttons a *named* row gets:
 *
 *   - the green confirm posted `personName: ""` back to /api/labelfaces, which
 *     created a person with no name (Person.name has a MinLengthValidator, but
 *     get_or_create() does not run field validators) and a nameless person
 *     album to go with it;
 *   - clicking the row navigated to `/search/` with an empty query;
 *   - "not this person" moved a face that had no person back to "unknown".
 *
 * Every unnamed row also keyed on `person.name`, so all of them collided on the
 * same empty React key -- see PeopleSection.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonDetail } from "../components/lightbox/PersonDetailComponent";
import i18n from "../i18n";

const stubs = vi.hoisted(() => ({
  setFacesPersonLabel: vi.fn(),
  deleteFaces: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("../api_client/apiClient", () => ({ serverAddress: "" }));
vi.mock("../service/notifications", () => ({ notification: new Proxy({}, { get: () => () => {} }) }));
vi.mock("../api_client/faces", () => ({
  useSetFacesPersonLabelMutation: () => ({ mutate: stubs.setFacesPersonLabel }),
  useDeleteFacesMutation: () => ({ mutate: stubs.deleteFaces }),
  FacesTab: { enum: { inferred: "inferred", unknown: "unknown", labeled: "labeled" } },
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => stubs.navigate,
  getRouteApi: () => ({ useSearch: () => ({ tab: "inferred" }) }),
}));

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
  stubs.setFacesPersonLabel.mockReset();
  stubs.deleteFaces.mockReset();
  stubs.navigate.mockReset();
});

const unnamedFace = {
  name: "",
  type: "",
  probability: 0,
  location: { top: 10, bottom: 100, left: 20, right: 90 },
  face_url: "/faces/1.jpg",
  face_id: 1,
};

// Classification guessed a real person: confirming means "yes, that is Alice",
// and the backend has an Alice to attach the face to.
const inferredFace = { ...unnamedFace, name: "Alice", type: "classification", probability: 0.8, face_id: 2 };

// Clustering only grouped the face with others like it. The label is the
// cluster's own name -- every unnamed cluster is called "Unknown NNN" -- and
// there is no person behind it to confirm the face onto.
const clusterFace = { ...unnamedFace, name: "Unknown 001", type: "cluster", probability: 0.6, face_id: 3 };

const onPersonEdit = vi.fn();

async function renderRow(person: typeof unnamedFace) {
  onPersonEdit.mockReset();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <PersonDetail
          person={person}
          isPublic={false}
          setFaceLocation={() => {}}
          onPersonEdit={onPersonEdit}
          notThisPerson={() => {}}
        />
      </MantineProvider>
    );
  });
  return container;
}

function buttons(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll("button"));
}

async function clickAll(container: HTMLElement) {
  for (const button of buttons(container)) {
    await act(async () => {
      button.click();
    });
  }
}

describe("an unnamed face in the lightbox sidebar", () => {
  it("says it needs a name instead of rendering blank", async () => {
    const container = await renderRow(unnamedFace);

    expect(container.textContent).toContain("Who is this?");
  });

  it("offers no confirm button - there is no name to confirm", async () => {
    const container = await renderRow(unnamedFace);

    expect(container.querySelector(".tabler-icon-user-check")).toBeNull();
    expect(container.querySelector(".tabler-icon-user-off")).toBeNull();
  });

  it("never posts an empty person name, whichever button is pressed", async () => {
    const container = await renderRow(unnamedFace);

    await clickAll(container);

    const postedNames = stubs.setFacesPersonLabel.mock.calls.map(([args]) => args.personName);
    expect(postedNames).not.toContain("");
    expect(postedNames.every((name: string) => name?.trim())).toBe(true);
  });

  it("opens the person picker for the face instead of searching for nothing", async () => {
    const container = await renderRow(unnamedFace);

    await act(async () => {
      buttons(container)[0].click();
    });

    expect(onPersonEdit).toHaveBeenCalledWith(unnamedFace.face_id, unnamedFace.face_url);
    expect(stubs.navigate).not.toHaveBeenCalled();
  });

  it("can still be deleted, for a detection that is not a face at all", async () => {
    const container = await renderRow(unnamedFace);

    await clickAll(container);

    expect(stubs.deleteFaces).toHaveBeenCalledWith({ faceIds: [unnamedFace.face_id] });
  });
});

describe("a face the algorithms did name", () => {
  it("shows the name and keeps its confirm button", async () => {
    const container = await renderRow(inferredFace);

    expect(container.textContent).toContain("Alice");
    expect(container.querySelector(".tabler-icon-user-check")).not.toBeNull();
  });

  it("confirms under the inferred name", async () => {
    const container = await renderRow(inferredFace);
    const confirm = buttons(container).find(b => b.querySelector(".tabler-icon-user-check"))!;

    await act(async () => {
      confirm.click();
    });

    expect(stubs.setFacesPersonLabel).toHaveBeenCalledWith({
      faceIds: [inferredFace.face_id],
      personName: "Alice",
    });
  });

  it("navigates to its person when the row is clicked", async () => {
    const container = await renderRow(inferredFace);

    await act(async () => {
      buttons(container)[0].click();
    });

    expect(stubs.navigate).toHaveBeenCalledWith({ to: "/search/Alice" });
  });
});

describe("a face that carries only a cluster's label", () => {
  it("offers no confirm button - there is no person by that name to confirm it onto", async () => {
    const container = await renderRow(clusterFace);

    expect(container.textContent).toContain("Unknown 001");
    expect(container.querySelector(".tabler-icon-user-check")).toBeNull();
  });

  it("never posts the cluster's label as a person name, whichever button is pressed", async () => {
    const container = await renderRow(clusterFace);

    await clickAll(container);

    const postedNames = stubs.setFacesPersonLabel.mock.calls.map(([args]) => args.personName);
    expect(postedNames).not.toContain("Unknown 001");
  });

  it("can still be named, through the person picker", async () => {
    const container = await renderRow(clusterFace);
    const edit = buttons(container).find(b => b.querySelector(".tabler-icon-edit"))!;

    await act(async () => {
      edit.click();
    });

    expect(onPersonEdit).toHaveBeenCalledWith(clusterFace.face_id, clusterFace.face_url);
  });
});
