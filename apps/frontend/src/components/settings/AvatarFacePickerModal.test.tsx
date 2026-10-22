import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Person } from "../../api_client/albums/hooks/useFetchPeopleAlbumsQuery";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { AvatarFacePickerModal } from "./AvatarFacePickerModal";

type PeopleQuery = {
  data: Person[] | undefined;
  isError: boolean;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
};

const stubs = vi.hoisted((): { query: PeopleQuery; skipped: boolean[] } => ({
  query: { data: [], isError: false, isFetching: false, refetch: () => Promise.resolve() },
  skipped: [],
}));

// EmptyState navigates by router; this dialog never uses its actions.
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => () => {} }));
vi.mock("../../api_client/urls", () => ({ serverAddress: "" }));
vi.mock("../../api_client/albums/hooks", () => ({
  useFetchPeopleAlbumsQuery: (skip: boolean) => {
    stubs.skipped.push(skip);
    return stubs.query;
  },
}));

const person = (id: string, name: string, face_url: string): Person => ({
  id,
  name,
  video: false,
  face_count: 3,
  face_photo_url: "",
  face_url,
  group_ids: [],
  birth_date: null,
});

let container: HTMLDivElement;
let root: Root;
const onPick = vi.fn<(faceUrl: string) => void>();
const onClose = vi.fn<() => void>();

beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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
  globalThis.ResizeObserver = class ResizeObserverStub implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  onPick.mockReset();
  onClose.mockReset();
  stubs.skipped = [];
  stubs.query = { data: [], isError: false, isFetching: false, refetch: () => Promise.resolve() };
  window.innerWidth = 1000;
  window.innerHeight = 900;
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

async function render(opened = true) {
  await act(async () => {
    root.render(
      // env="test": no transitions or portals, so the dialog renders in place
      <MantineProvider env="test">
        <AvatarFacePickerModal opened={opened} onClose={onClose} onPick={onPick} />
      </MantineProvider>
    );
  });
}

describe("AvatarFacePickerModal", () => {
  it("hands the cover face of the picked person over and closes", async () => {
    stubs.query.data = [person("1", "Mara", "/media/faces/mara.jpg"), person("2", "Jonas", "/media/faces/jonas.jpg")];
    await render();

    const button = defined(container.querySelector<HTMLButtonElement>('button[aria-label="Use the face of Jonas"]'));
    await act(async () => {
      button.click();
    });

    expect(onPick).toHaveBeenCalledExactlyOnceWith("/media/faces/jonas.jpg");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("leaves out people without a cover face", async () => {
    stubs.query.data = [person("1", "Mara", "/media/faces/mara.jpg"), person("2", "Nobody", "")];
    await render();

    expect(container.querySelector('button[aria-label="Use the face of Mara"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Use the face of Nobody"]')).toBeNull();
  });

  it("says so when there is no face to pick, rather than showing a blank grid", async () => {
    stubs.query.data = [person("2", "Nobody", "")];
    await render();

    expect(container.textContent).toContain("No faces to choose from");
  });

  it("offers a retry when the people could not be loaded", async () => {
    const refetch = vi.fn(() => Promise.resolve());
    stubs.query = { data: undefined, isError: true, isFetching: false, refetch };
    await render();

    const retry = defined(Array.from(container.querySelectorAll("button")).find(b => b.textContent === "Retry"));
    await act(async () => {
      retry.click();
    });

    expect(refetch).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain("No faces to choose from");
  });

  it("does not ask the server for people while it is closed", async () => {
    await render(false);

    expect(stubs.skipped.every(Boolean)).toBe(true);
  });
});
