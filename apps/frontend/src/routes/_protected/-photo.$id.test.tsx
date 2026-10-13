/**
 * The single-photo route only declares itself and hands its id to the page
 * (components/photopage, which has its own tests).
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as
 * a route (its `routeFileIgnorePrefix`).
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => {
  const state: { component: React.ComponentType | undefined; pageIds: string[] } = {
    component: undefined,
    pageIds: [],
  };
  return state;
});

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => {
    const route = (options?: { component?: React.ComponentType }) => {
      stubs.component = options?.component;
      return route;
    };
    route.useParams = () => ({ id: "abc" });
    return route;
  },
}));
vi.mock("../../components/photopage/PhotoPage", () => ({
  PhotoPage: ({ photoId }: { photoId: string }) => {
    stubs.pageIds.push(photoId);
    return null;
  },
}));

beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await import("./photo.$id");
});

describe("single-photo route", () => {
  it("renders the photo page for the id in the address", async () => {
    const Page = stubs.component;
    if (!Page) throw new Error("the route module did not register its component");
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Page />));
    expect(stubs.pageIds).toEqual(["abc"]);
    await act(async () => root.unmount());
  });
});
