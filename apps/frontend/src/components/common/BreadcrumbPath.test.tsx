/**
 * The folder breadcrumb under a photo's path: its links were plain hrefs (a
 * full app reload per click) and put an extra "/" in front of Windows paths,
 * which opened a folder that does not exist.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BreadcrumbPath } from "./BreadcrumbPath";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string;
    params: { id: string };
    children?: React.ReactNode;
    [prop: string]: unknown;
  }) => (
    <a {...rest} data-to={to} data-id={params.id}>
      {children}
    </a>
  ),
}));

let root: Root;
let container: HTMLDivElement;

const render = async (fullPath: string) => {
  await act(async () => {
    root.render(
      <MantineProvider>
        <BreadcrumbPath fullPath={fullPath} />
      </MantineProvider>
    );
  });
  return [...container.querySelectorAll("a")].map(link => ({
    label: link.textContent,
    to: link.dataset.to,
    id: link.dataset.id,
  }));
};

beforeAll(() => {
  // jsdom has no matchMedia, MantineProvider needs it
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
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("BreadcrumbPath", () => {
  it("links every POSIX folder level through the router, from the root", async () => {
    const links = await render("/home/a/b");

    expect(links).toEqual([
      { label: "home", to: "/album/folder/$id", id: encodeURIComponent("/home") },
      { label: "a", to: "/album/folder/$id", id: encodeURIComponent("/home/a") },
      { label: "b", to: "/album/folder/$id", id: encodeURIComponent("/home/a/b") },
    ]);
  });

  it("does not put a '/' in front of a Windows drive", async () => {
    const links = await render("C:/Photos/x");

    expect(links.map(link => link.id)).toEqual([
      encodeURIComponent("C:"),
      encodeURIComponent("C:/Photos"),
      encodeURIComponent("C:/Photos/x"),
    ]);
  });

  it("renders nothing without a path", async () => {
    expect(await render("")).toEqual([]);
  });
});
