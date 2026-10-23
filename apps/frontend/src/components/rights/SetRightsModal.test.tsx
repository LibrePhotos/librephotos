/**
 * "Set rights…" for a selection (#425): each field opens with the value every photo shares, says
 * when the photos differ, and sends only what the user changed; values from files stay unless the
 * user opts in.
 */
import type { RightsSummaryResponse } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SetPhotosRightsRequest } from "../../api_client/photos/hooks";
import i18n from "../../i18n";
import { SetRightsModal } from "./SetRightsModal";
import { initialSetRights } from "./SetRightsModal.schema";

const mocks = vi.hoisted(() => ({
  summary: undefined as RightsSummaryResponse | undefined,
  setRights: vi.fn<(args: SetPhotosRightsRequest, options?: { onSuccess?: () => void }) => void>(),
}));

vi.mock("../../api_client/photos/hooks", () => ({
  useRightsSummaryQuery: () => ({ data: mocks.summary, isError: false, error: null }),
  useSetPhotosRightsMutation: () => ({ mutate: mocks.setRights, isPending: false }),
}));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: undefined }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));

const SUMMARY: RightsSummaryResponse = {
  count: 24,
  from_file: 7,
  copyright: { value: null, mixed: true },
  creator: { value: "Anna Berger", mixed: false },
  license: { value: "cc-by-4.0", mixed: false },
};

let root: Root;
let container: HTMLDivElement;

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
  // The license picker's dropdown measures itself; jsdom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  mocks.setRights.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(summary: RightsSummaryResponse = SUMMARY) {
  mocks.summary = summary;
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <SetRightsModal opened onClose={() => {}} selection={{ image_hashes: ["h1", "h2"] }} onDone={() => {}} />
      </MantineProvider>
    );
  });
}

function input(label: string): HTMLInputElement {
  const found = Array.from(document.querySelectorAll<HTMLInputElement>("input")).find(element =>
    element.closest(".mantine-InputWrapper-root")?.querySelector("label")?.textContent?.startsWith(label)
  );
  if (!found) throw new Error(`no input ${label}`);
  return found;
}

async function type(label: string, value: string) {
  const element = input(label);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit() {
  const form = document.querySelector("form");
  if (!form) throw new Error("no form");
  await act(async () => form.requestSubmit());
}

describe("SetRightsModal", () => {
  it("opens with the shared values and says which field is mixed", async () => {
    await render();

    expect(document.body.textContent).toContain("Set rights for 24 photos");
    expect(input("Creator").value).toBe("Anna Berger");
    expect(input("Copyright").value).toBe("");
    expect(input("Copyright").placeholder).toBe(i18n.t("rights.bulk.mixed"));
    expect(document.body.textContent).toContain("Also change 7 photos whose rights come from their files");
  });

  it("sends only the changed fields and keeps the files' values", async () => {
    await render();
    await type("Copyright", "(c) {year} Anna");
    await submit();

    expect(mocks.setRights).toHaveBeenCalledTimes(1);
    expect(mocks.setRights.mock.calls[0]?.[0]).toEqual({
      selection: { image_hashes: ["h1", "h2"] },
      rights: { copyright: "(c) {year} Anna" },
      keep: "file",
    });
  });

  it("replaces the files' values when asked to", async () => {
    await render();
    await type("Creator", "");
    const checkbox = document.querySelector<HTMLInputElement>("input[type=checkbox]");
    await act(async () => checkbox?.click());
    await submit();

    expect(mocks.setRights.mock.calls[0]?.[0]).toMatchObject({ rights: { creator: null }, keep: "none" });
  });

  it("sends nothing while nothing changed", async () => {
    await render({ ...SUMMARY, from_file: 0 });
    await submit();
    expect(mocks.setRights).not.toHaveBeenCalled();
    expect(document.querySelector("input[type=checkbox]")).toBeNull();
  });
});

describe("initialSetRights", () => {
  it("leaves a mixed or unknown value empty", () => {
    expect(
      initialSetRights({
        ...SUMMARY,
        creator: { value: "A", mixed: true },
        license: { value: "mit", mixed: false },
      })
    ).toEqual({ copyright: "", creator: "", license: null, replaceFileValues: false });
  });
});
