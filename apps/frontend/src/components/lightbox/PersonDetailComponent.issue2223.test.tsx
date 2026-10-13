/**
 * #2223: the trash icon next to a face in the lightbox deleted it on one click,
 * although the faces page asks first and no UI can restore a deleted face.
 */
import type { UseNavigateResult } from "@tanstack/react-router";
import React, { act } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { click, dialogButton, openDialog, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { PersonDetail } from "./PersonDetailComponent";

/** The part of the delete mutation's `mutate` the row uses. */
type DeleteFaces = (variables: { faceIds: number[] }, options?: { onSuccess?: () => void }) => void;

const stubs = vi.hoisted(() => ({
  deleteFaces: vi.fn<DeleteFaces>(),
  navigate: vi.fn<UseNavigateResult<string>>(),
}));

vi.mock("../../api_client/urls", () => ({ serverAddress: "" }));
vi.mock("../../api_client/faces", () => ({
  useSetFacesPersonLabelMutation: () => ({ mutate: () => {} }),
  useDeleteFacesMutation: () => ({ mutate: stubs.deleteFaces, isPending: false }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => stubs.navigate,
  getRouteApi: () => ({ useSearch: () => ({ tab: "inferred" }) }),
}));

const face = {
  name: "Anna Berg",
  type: "classification",
  probability: 0.8,
  location: { top: 10, bottom: 100, left: 20, right: 90 },
  face_url: "/faces/7.jpg",
  face_id: 7,
};

async function renderRowAndClickTrash() {
  const { container } = await renderInMantine(
    <PersonDetail
      person={face}
      isPublic={false}
      setFaceLocation={() => {}}
      onPersonEdit={() => {}}
      notThisPerson={() => {}}
    />
  );
  await click(
    defined(container.querySelector<HTMLButtonElement>('button[aria-label="Delete the face and its thumbnails"]'))
  );
}

/** The server answers the delete request with success. */
async function serverAgrees() {
  const onSuccess = defined(defined(stubs.deleteFaces.mock.calls[0])[1]?.onSuccess, "an onSuccess callback");
  await act(async () => onSuccess());
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  stubs.deleteFaces.mockReset();
});

describe("deleting a face from the lightbox", () => {
  it("asks first, naming the person, and deletes nothing yet", async () => {
    await renderRowAndClickTrash();

    expect(openDialog()?.textContent).toContain("Delete this face?");
    expect(openDialog()?.textContent).toContain("The face of Anna Berg");
    expect(stubs.deleteFaces).not.toHaveBeenCalled();
  });

  it("keeps the face when the dialog is cancelled", async () => {
    await renderRowAndClickTrash();

    await click(dialogButton("Cancel"));

    expect(stubs.deleteFaces).not.toHaveBeenCalled();
  });

  it("deletes the face once confirmed, and closes when the server agreed", async () => {
    await renderRowAndClickTrash();

    await click(dialogButton("Delete face"));

    expect(stubs.deleteFaces).toHaveBeenCalledWith({ faceIds: [7] }, expect.anything());
    expect(openDialog()).not.toBeNull();

    await serverAgrees();

    expect(openDialog()).toBeNull();
  });
});
