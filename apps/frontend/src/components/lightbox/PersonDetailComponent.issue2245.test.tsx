/**
 * #2245: the face actions next to a face in the lightbox had their label only in a Tooltip, which is
 * not an accessible name, so a screen reader announced four buttons called "button".
 */
import type { PhotoPerson } from "@librephotos/api-client";
import type { UseNavigateResult } from "@tanstack/react-router";
import React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { PersonDetail } from "./PersonDetailComponent";

type SetLabel = (variables: { faceIds: number[]; personName: string }) => void;

const stubs = vi.hoisted(() => ({
  setLabel: vi.fn<SetLabel>(),
  navigate: vi.fn<UseNavigateResult<string>>(),
}));

vi.mock("../../api_client/urls", () => ({ serverAddress: "" }));
vi.mock("../../api_client/faces", () => ({
  useSetFacesPersonLabelMutation: () => ({ mutate: stubs.setLabel }),
  useDeleteFacesMutation: () => ({ mutate: () => {}, isPending: false }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => stubs.navigate,
  getRouteApi: () => ({ useSearch: () => ({ tab: "inferred" }) }),
}));

const face: PhotoPerson = {
  name: "Anna Berg",
  type: "classification",
  probability: 0.8,
  location: { top: 10, bottom: 100, left: 20, right: 90 },
  face_url: "/faces/7.jpg",
  face_id: 7,
};

async function buttonNames(person: PhotoPerson) {
  const { container } = await renderInMantine(
    <PersonDetail
      person={person}
      isPublic={false}
      setFaceLocation={() => {}}
      onPersonEdit={() => {}}
      notThisPerson={() => {}}
    />
  );
  return {
    container,
    names: Array.from(container.querySelectorAll("button[aria-label]"), button => button.getAttribute("aria-label")),
  };
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  stubs.setLabel.mockReset();
});

describe("face actions in the lightbox", () => {
  it("names each action of a suggested face", async () => {
    const { names } = await buttonNames(face);
    expect(names).toEqual(["Confirm as Anna Berg", "Label as…", "Not Anna Berg", "Delete face"]);
  });

  it("finds the confirm action by its name", async () => {
    const { container } = await buttonNames(face);
    container.querySelector<HTMLButtonElement>('button[aria-label="Confirm as Anna Berg"]')?.click();
    expect(stubs.setLabel).toHaveBeenCalledWith({ faceIds: [7], personName: "Anna Berg" });
  });

  it("names the one action of a face nobody named yet", async () => {
    const { names } = await buttonNames({ ...face, name: "", type: "" });
    expect(names).toEqual(["Name this face", "Delete face"]);
  });

  it("keeps the face picture out of the reading order: the name is next to it", async () => {
    const { container } = await buttonNames(face);
    for (const image of container.querySelectorAll("img")) {
      expect(image.getAttribute("alt")).toBe("");
    }
  });
});
