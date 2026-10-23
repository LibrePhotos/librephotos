/**
 * The page of one person shared with you (#2722) is titled with the person and whose they are, and
 * asks for that person's photos by number. A person the list does not have (unshared, or a stale
 * link) still asks, so the server's 404 shows; a person id that is not a number asks for 0.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route.
 */
import type { SharedPerson } from "@librephotos/api-client";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SharedGroupRef } from "../../../api_client/photos/hooks";
import i18n from "../../../i18n";

const stubs = vi.hoisted(() => ({
  component: undefined as React.ComponentType | undefined,
  params: { personId: "7" },
  people: [] as SharedPerson[],
  shown: [] as Array<{ group: SharedGroupRef; title: string }>,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options?: { component?: React.ComponentType }) => {
    stubs.component = options?.component;
    return { useParams: () => stubs.params };
  },
}));
vi.mock("../../../api_client/photos/hooks", () => ({
  useFetchSharedPeopleWithMeQuery: () => ({ data: stubs.people }),
}));
vi.mock("../../../components/sharing/SharedGroupPhotos", () => ({
  SharedGroupPhotos: (props: { group: SharedGroupRef; title: string }) => {
    stubs.shown.push(props);
    return null;
  },
}));

let root: ReturnType<typeof createRoot> | undefined;

beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
  await import("./withme.people.$personId");
}, 30_000);

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  stubs.shown = [];
});

async function renderPerson(personId: string) {
  stubs.params = { personId };
  const Page = stubs.component;
  if (!Page) throw new Error("the route registered no component");
  const mounted = createRoot(document.createElement("div"));
  root = mounted;
  await act(async () => mounted.render(<Page />));
  return stubs.shown.at(-1);
}

describe("a person shared with you", () => {
  it("is titled with the person and whose they are", async () => {
    stubs.people = [
      {
        id: 7,
        name: "Mom",
        owner: { id: 2, username: "alice", first_name: "Alice", last_name: "Lang" },
        photo_count: 3,
        face_url: null,
      },
    ];

    expect(await renderPerson("7")).toEqual({
      group: { kind: "people", personId: 7 },
      title: "Mom, shared by Alice Lang",
    });
  });

  it("still asks for a person the list does not have", async () => {
    stubs.people = [];

    expect(await renderPerson("9")).toEqual({ group: { kind: "people", personId: 9 }, title: "People" });
    expect((await renderPerson("abc"))?.group).toEqual({ kind: "people", personId: 0 });
  });
});
