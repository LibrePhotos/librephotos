import type { PhotoPerson } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Person } from "../../api_client/albums/hooks/useFetchPeopleAlbumsQuery";
import i18n from "../../i18n";
import { PeopleSection } from "./PeopleSection";

const stubs = vi.hoisted(() => ({
  people: [] as Person[] | undefined,
  skipped: [] as boolean[],
}));

vi.mock("../../api_client/urls", () => ({ serverAddress: "" }));
vi.mock("../../service/notifications", () => ({ notification: new Proxy({}, { get: () => () => {} }) }));
vi.mock("../../api_client/albums/hooks", () => ({
  useFetchPeopleAlbumsQuery: (skip: boolean) => {
    stubs.skipped.push(skip);
    return { data: stubs.people };
  },
}));
vi.mock("../../api_client/faces", () => ({
  useSetFacesPersonLabelMutation: () => ({ mutate: vi.fn<(...args: unknown[]) => void>() }),
  useDeleteFacesMutation: () => ({ mutate: vi.fn<(...args: unknown[]) => void>() }),
  useDetectFacesReport: () => null,
  useDrawnFaceResult: () => null,
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn<(options: unknown) => void>(),
  getRouteApi: () => ({ useSearch: () => ({ tab: "inferred" }) }),
}));

const person = (id: string, name: string, birth_date: string | null): Person => ({
  id,
  name,
  video: false,
  face_count: 3,
  face_photo_url: "",
  face_url: "",
  group_ids: [],
  birth_date,
});

const face = (face_id: number, name: string, type = "user"): PhotoPerson => ({
  name,
  type,
  probability: 1,
  location: { top: 0, bottom: 10, left: 0, right: 10 },
  face_url: `/face${face_id}.jpg`,
  face_id,
});

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
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  stubs.skipped = [];
  stubs.people = [person("1", "Emma", "2019-05-03"), person("2", "Jonas", null)];
});

async function renderSection(
  people: PhotoPerson[],
  { isPublic = false, exif_timestamp = "2022-07-20T14:00:00Z" as string | null } = {}
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <PeopleSection
          photoDetail={{ people, exif_timestamp }}
          isPublic={isPublic}
          setFaceLocation={() => {}}
          onPersonEdit={() => {}}
          notThisPerson={() => {}}
        />
      </MantineProvider>
    );
  });
  return container;
}

describe("PeopleSection ages (#3036)", () => {
  it("shows how old a person was on the day of the photo, under their name", async () => {
    const container = await renderSection([face(1, "Emma")]);

    expect(container.textContent).toContain("Emma");
    expect(container.textContent).toContain("Age 3");
  });

  it("shows months for a baby and Newborn on the day of the birth", async () => {
    const baby = await renderSection([face(1, "Emma")], { exif_timestamp: "2019-09-10T10:00:00Z" });
    expect(baby.textContent).toContain("4 months");

    const newborn = await renderSection([face(1, "Emma")], { exif_timestamp: "2019-05-03T10:00:00Z" });
    expect(newborn.textContent).toContain("Newborn");
  });

  it("shows no age for a person without a birth date, or an unnamed face or a cluster", async () => {
    const container = await renderSection([face(1, "Jonas"), face(2, ""), face(3, "Unknown 001", "cluster")]);

    expect(container.textContent).not.toMatch(/Age \d|month|day|Newborn/);
  });

  it("shows no age on a photo older than the birth, or without a date", async () => {
    const before = await renderSection([face(1, "Emma")], { exif_timestamp: "2018-12-31T10:00:00Z" });
    expect(before.textContent).not.toMatch(/Age \d|month|day|Newborn/);

    const undated = await renderSection([face(1, "Emma")], { exif_timestamp: null });
    expect(undated.textContent).not.toMatch(/Age \d|month|day|Newborn/);
  });

  it("shows the name alone while the people are still loading", async () => {
    stubs.people = undefined;
    const container = await renderSection([face(1, "Emma")]);

    expect(container.textContent).toContain("Emma");
    expect(container.textContent).not.toContain("Age");
  });

  it("shows no age on a public or shared view, and does not ask for the people", async () => {
    const container = await renderSection([face(1, "Emma")], { isPublic: true });

    expect(container.textContent).toContain("Emma");
    expect(container.textContent).not.toContain("Age");
    expect(stubs.skipped.every(Boolean)).toBe(true);
  });
});
