/**
 * Person ⋮ → Share (#668): a switch per user and the two "what they see" switches, each saving
 * the whole recipient list at once; and the review of photos labelled after the share.
 */
import type { PersonSharePendingPage, PersonSharing, PigPhoto } from "@librephotos/api-client";
import { Media } from "@librephotos/api-client";
import React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { click, dialogButton, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { PersonShareReviewModal } from "./PersonShareReviewModal";
import { SharePersonModal } from "./SharePersonModal";

type Body = { recipient_ids: number[]; share_location?: boolean; share_other_people?: boolean };

const clara = { id: 3, username: "clara", first_name: "Clara", last_name: "Ruiz" };
const ben = { id: 9, username: "ben", first_name: "Ben", last_name: "Okafor" };
const photo = (id: string): PigPhoto => ({
  id,
  image_hash: `h${id}`,
  aspectRatio: 1,
  type: Media.IMAGE,
  is_hdr: false,
  rating: 0,
  shared_to: [],
  isTemp: false,
  has_raw_variant: false,
});

const stubs = vi.hoisted(() => ({
  sharing: undefined as PersonSharing | undefined,
  pending: undefined as PersonSharePendingPage | undefined,
  save: vi.fn<(body: Body) => void>(),
  review: vi.fn<(body: { approve: string[]; decline: string[] }) => void>(),
}));

vi.mock("../../api_client/albums/hooks", () => ({
  usePersonSharingQuery: () => ({ data: stubs.sharing }),
  useSetPersonSharingMutation: () => ({ mutate: stubs.save, isPending: false }),
  usePersonSharingPendingQuery: () => ({ data: stubs.pending }),
  useReviewPersonSharingMutation: () => ({ mutate: stubs.review, isPending: false }),
}));
vi.mock("../../api_client/user/hooks", () => ({
  useFetchUserListQuery: () => ({
    data: [
      { ...clara, date_joined: null },
      { ...ben, date_joined: null },
    ],
  }),
}));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: { id: 1 } }),
}));

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  stubs.save.mockReset();
  stubs.review.mockReset();
  stubs.sharing = {
    recipients: [clara],
    share_location: false,
    share_other_people: false,
    shared_count: 4,
    pending_count: 2,
  };
  stubs.pending = {
    count: 2,
    next: null,
    previous: null,
    page: 1,
    page_size: 100,
    num_pages: 1,
    results: [photo("a"), photo("b")],
  };
});

const input = (label: string) =>
  defined(document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`), label);

describe("SharePersonModal", () => {
  it("adds a user to the recipients, keeping the others", async () => {
    await renderInMantine(<SharePersonModal opened onClose={() => {}} person={{ id: "7", name: "Mila" }} />);

    expect(input("Let Clara Ruiz see these photos").checked).toBe(true);
    await click(input("Let Ben Okafor see these photos"));

    expect(stubs.save).toHaveBeenCalledWith({ recipient_ids: [3, 9] });
    expect(document.body.textContent).toContain("Faces face recognition only suggested are never shared.");
  });

  it("turns on the location for the people it is shared with", async () => {
    await renderInMantine(<SharePersonModal opened onClose={() => {}} person={{ id: "7", name: "Mila" }} />);
    const location = defined(
      [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
        box => box.closest("label")?.textContent === "Where the photos were taken"
      ),
      "the location switch"
    );

    await click(location);

    expect(stubs.save).toHaveBeenCalledWith({ recipient_ids: [3], share_location: true });
  });
});

describe("PersonShareReviewModal", () => {
  it("shares the ticked photos and keeps the unticked ones back", async () => {
    await renderInMantine(<PersonShareReviewModal opened onClose={() => {}} person={{ id: 7, name: "Mila" }} />);
    const boxes = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes).toHaveLength(2);

    await click(defined(boxes[1], "the second photo"));
    await click(dialogButton("Share 1 photo"));

    expect(stubs.review).toHaveBeenCalledWith({ approve: ["a"], decline: ["b"] }, expect.anything());
  });
});
