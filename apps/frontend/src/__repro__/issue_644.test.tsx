/**
 * Repro for https://github.com/LibrePhotos/librephotos/issues/644
 * "Add recently used people to the face tagging popup"
 *
 *   "when tagging faces it's usually the same 4-5 people over and over, but the
 *    popup only offers the full alphabetical list - you either scroll to the
 *    name or type it again for every single face."
 *
 * src/components/modals/ModalPersonEdit.tsx renders `useFetchPeopleAlbumsQuery()`
 * straight into one long scrolling Stack ordered by name, so the cost of picking
 * a person is the same on the hundredth tag as it is on the first.
 *
 * The shortcut list has to be fed from the mutation, not from the modal: the
 * modal is only one of several tagging entry points (the faces dashboard header,
 * the lightbox sidebar and the person detail row all label faces without ever
 * opening it), and they all funnel through useSetFacesPersonLabelMutation.
 *
 * Faces carry a numeric `person` id while useFetchPeopleAlbumsQuery coerces the
 * same id to a string, so the MRU has to normalize before it can resolve an
 * entry back to a person.
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useSetFacesPersonLabelMutation } from "../api_client/faces/hooks/useSetFacesPersonLabelMutation";
import { ModalPersonEdit } from "../components/modals/ModalPersonEdit";
import i18n from "../i18n";
import {
  getRecentlyTaggedPeopleIds,
  RECENTLY_TAGGED_PEOPLE_LIMIT,
  recordRecentlyTaggedPerson,
  resolveRecentlyTaggedPeople,
  withMostRecentlyTagged,
} from "../util/recentlyTaggedPeople";

const stubs = vi.hoisted(() => ({
  // Alphabetical, the way the query hands them over. Ids are strings here and
  // numbers on the faces the API returns.
  people: [
    { id: "1", name: "Alice", video: false, face_count: 12, face_photo_url: "/alice", face_url: "/alice" },
    { id: "2", name: "Bob", video: false, face_count: 8, face_photo_url: "/bob", face_url: "/bob" },
    { id: "3", name: "Charlie", video: false, face_count: 3, face_photo_url: "/charlie", face_url: "/charlie" },
  ],
  setFacesPersonLabel: vi.fn(),
  post: vi.fn(),
}));

vi.mock("../api_client/apiClient", () => ({ serverAddress: "" }));
vi.mock("../service/notifications", () => ({ notification: new Proxy({}, { get: () => () => {} }) }));
vi.mock("../api_client/albums/hooks", () => ({ useFetchPeopleAlbumsQuery: () => ({ data: stubs.people }) }));
// The barrel the modal imports from - the mutation test below pulls the real
// hook straight out of its own module instead.
vi.mock("../api_client/faces", () => ({
  useSetFacesPersonLabelMutation: () => ({ mutate: stubs.setFacesPersonLabel }),
}));
vi.mock("../api_client/api", () => ({
  fetchClient: { post: stubs.post },
  queryClient: { invalidateQueries: () => {} },
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
  // @ts-ignore - jsdom has no ResizeObserver, the modal's ScrollArea needs it
  globalThis.ResizeObserver = class {
    observe() {}

    unobserve() {}

    disconnect() {}
  };
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  localStorage.clear();
  stubs.setFacesPersonLabel.mockReset();
});

/** The modal renders into a portal, so everything below reads from the document. */
function recentlyTaggedSection(): HTMLElement | null {
  const heading = Array.from(document.querySelectorAll("h5")).find(h => h.textContent === "Recently tagged");
  return (heading?.nextElementSibling as HTMLElement | null) ?? null;
}

function namesOf(root: ParentNode | null): string[] {
  return Array.from(root?.querySelectorAll("h4") ?? []).map(title => title.textContent ?? "");
}

/** React tracks the previous value on the node itself, so plain assignment is swallowed. */
function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function renderModal(seededIds: string[]) {
  if (seededIds.length > 0) {
    localStorage.setItem("recentlyTaggedPeople", JSON.stringify(seededIds));
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <ModalPersonEdit isOpen onRequestClose={() => {}} selectedFaces={[{ face_id: 42, face_url: "/face42" }]} />
      </MantineProvider>
    );
  });
  return {
    async type(filter: string) {
      const input = document.querySelector("input") as HTMLInputElement;
      await act(async () => {
        setInputValue(input, filter);
      });
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("issue 644 - recently tagged people in the face tagging popup", () => {
  describe("the MRU list", () => {
    it("keeps the most recently tagged person first", () => {
      recordRecentlyTaggedPerson("1");
      recordRecentlyTaggedPerson("2");
      recordRecentlyTaggedPerson("3");

      expect(getRecentlyTaggedPeopleIds()).toEqual(["3", "2", "1"]);
    });

    it("moves a person back to the front instead of listing them twice", () => {
      recordRecentlyTaggedPerson("1");
      recordRecentlyTaggedPerson("2");
      recordRecentlyTaggedPerson("1");

      expect(getRecentlyTaggedPeopleIds()).toEqual(["1", "2"]);
    });

    it("drops the oldest entry once it is full", () => {
      const ids = Array.from({ length: RECENTLY_TAGGED_PEOPLE_LIMIT + 3 }, (_, i) => String(i));
      ids.forEach(recordRecentlyTaggedPerson);

      const stored = getRecentlyTaggedPeopleIds();
      expect(stored).toHaveLength(RECENTLY_TAGGED_PEOPLE_LIMIT);
      expect(stored).toEqual(ids.slice(-RECENTLY_TAGGED_PEOPLE_LIMIT).reverse());
    });

    it("normalizes the numeric person id the faces API returns", () => {
      recordRecentlyTaggedPerson(7);

      expect(getRecentlyTaggedPeopleIds()).toEqual(["7"]);
      expect(withMostRecentlyTagged(["7"], "7")).toEqual(["7"]);
    });

    it("ignores a face that was pushed back to no person at all", () => {
      recordRecentlyTaggedPerson(null);
      recordRecentlyTaggedPerson(undefined);

      expect(getRecentlyTaggedPeopleIds()).toEqual([]);
    });

    it("survives a corrupted localStorage entry", () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      localStorage.setItem("recentlyTaggedPeople", "{not json");

      expect(getRecentlyTaggedPeopleIds()).toEqual([]);
      consoleError.mockRestore();
    });

    it("drops ids of people the server no longer knows about", () => {
      // "99" was deleted or merged away; rendering it would show a stale name.
      const resolved = resolveRecentlyTaggedPeople(["3", "99", "1"], stubs.people);

      expect(resolved.map(person => person.name)).toEqual(["Charlie", "Alice"]);
    });
  });

  describe("the popup", () => {
    it("offers the recently tagged people above the full list", async () => {
      const modal = await renderModal(["3", "1"]);

      expect(namesOf(recentlyTaggedSection())).toEqual(["Charlie", "Alice"]);
      // The alphabetical list is still there, unchanged.
      expect(namesOf(document.body).slice(-3)).toEqual(["Alice", "Bob", "Charlie"]);

      await modal.unmount();
    });

    it("labels the selection when a recently tagged person is picked", async () => {
      const modal = await renderModal(["3"]);

      const row = recentlyTaggedSection()?.querySelector("button") as HTMLButtonElement;
      await act(async () => {
        row.click();
      });

      expect(stubs.setFacesPersonLabel).toHaveBeenCalledWith({ faceIds: [42], personName: "Charlie" });

      await modal.unmount();
    });

    it("shows nothing extra before the first face has been tagged", async () => {
      const modal = await renderModal([]);

      expect(recentlyTaggedSection()).toBeNull();

      await modal.unmount();
    });

    it("gets out of the way once the user starts searching", async () => {
      const modal = await renderModal(["3", "1"]);
      expect(recentlyTaggedSection()).not.toBeNull();

      await modal.type("alice");

      expect(recentlyTaggedSection()).toBeNull();
      expect(namesOf(document.body)).toEqual(["Alice"]);

      await modal.unmount();
    });
  });

  describe("recording the pick", () => {
    it("records tagging that never goes through the popup", async () => {
      // The faces dashboard header, the lightbox sidebar and the person detail
      // row all label faces on their own; they only share this mutation.
      stubs.post.mockResolvedValue({
        status: true,
        results: [
          {
            id: 42,
            image: null,
            face_url: null,
            photo: "somehash",
            person_label_probability: 1,
            person: 3,
            person_name: "Charlie",
          },
        ],
        updated: [],
        not_updated: [],
      });

      let tag: (() => Promise<unknown>) | undefined;
      function Harness() {
        const { mutateAsync } = useSetFacesPersonLabelMutation();
        tag = () => mutateAsync({ faceIds: [42], personName: "Charlie" });
        return null;
      }

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => {
        root.render(
          <QueryClientProvider client={new QueryClient()}>
            <Harness />
          </QueryClientProvider>
        );
      });

      await act(async () => {
        await tag!();
      });

      expect(getRecentlyTaggedPeopleIds()).toEqual(["3"]);

      await act(async () => {
        root.unmount();
      });
      container.remove();
    });
  });
});
