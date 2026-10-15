/**
 * The face dashboard with nothing in the active tab: "Scan your photos" when no tab has a face,
 * otherwise a pointer to a tab that has faces (it keeps the rest of the URL, e.g. `?group=`).
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CompletePersonFaceList } from "../../api_client/faces";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import type { FacesTabLists } from "./facesCounters";
import { FacesEmptyState } from "./FacesEmptyState";

type Navigate = (options: { to: string; search: Record<string, unknown> }) => Promise<void>;

const stubs = vi.hoisted(() => ({ navigate: vi.fn<Navigate>(() => Promise.resolve()) }));

vi.mock("@tanstack/react-router", () => ({
  getRouteApi: () => ({ useSearch: () => ({ tab: "labeled", group: 3 }) }),
  useNavigate: () => stubs.navigate,
  useHref: () => "/library",
  Link: ({ children }: { children: React.ReactNode }) => <a href="/library">{children}</a>,
}));

const person = (id: number): CompletePersonFaceList[number] => ({ id, name: `P${id}`, face_count: 1, faces: [] });
const lists = (labeled: number, inferred: number, unknown: number): FacesTabLists => ({
  labeled: Array.from({ length: labeled }, (_, i) => person(i + 1)),
  inferred: Array.from({ length: inferred }, (_, i) => person(i + 10)),
  unknown: Array.from({ length: unknown }, (_, i) => person(i + 20)),
});

let root: Root | undefined;

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

afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = "";
  stubs.navigate.mockClear();
});

async function render(props: React.ComponentProps<typeof FacesEmptyState>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    defined(root).render(
      <MantineProvider env="test">
        <FacesEmptyState {...props} />
      </MantineProvider>
    )
  );
}

describe("FacesEmptyState", () => {
  it("asks for a scan when no tab has a face", async () => {
    await render({ activeTab: "labeled", lists: lists(0, 0, 0), fetching: false });
    expect(document.body.textContent).toContain(i18n.t("emptystate.faces.title"));
  });

  it("offers a tab that has faces, keeping the rest of the URL", async () => {
    await render({ activeTab: "labeled", lists: lists(0, 2, 0), fetching: false });
    expect(document.body.textContent).toContain(i18n.t("emptystate.facesTab.labeled.title"));
    const show = defined(
      Array.from(document.body.querySelectorAll("button")).find(
        button => button.textContent === i18n.t("emptystate.facesTab.show.inferred")
      )
    );
    await act(async () => show.click());
    expect(stubs.navigate).toHaveBeenCalledWith({ to: "/faces", search: { tab: "inferred", group: 3 } });
  });

  it("says only this tab is empty while the lists still load", async () => {
    await render({ activeTab: "unknown", lists: lists(0, 0, 0), fetching: true });
    expect(document.body.textContent).toContain(i18n.t("emptystate.facesTab.unknown.title"));
    expect(document.body.querySelector("button")).toBeNull();
  });
});
