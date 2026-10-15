/**
 * The person group hooks (#1126): each change toasts once the server agreed and refreshes what shows
 * the groups: the group list (its counts), the people lists (their group ids) and, when people move
 * in or out of a group, the face dashboard's people.
 */
import { albumKeys, faceKeys, type PersonGroup, type PersonGroupsResponse } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { usePersonGroupFilter } from "../../../components/album/usePersonGroupFilter";
import { defined } from "../../../util/defined.test-utils";
import {
  useCreatePersonGroupMutation,
  useDeletePersonGroupMutation,
  useRenamePersonGroupMutation,
  useSetPersonGroupsMutation,
} from "./usePersonGroups";

const FAMILY: PersonGroup = { id: 3, name: "Family", person_count: 2 };

const stubs = vi.hoisted(() => ({
  fetchPersonGroups: vi.fn<() => Promise<PersonGroup[]>>(),
  createPersonGroup: vi.fn<(client: unknown, name: string) => Promise<PersonGroup>>(),
  renamePersonGroup: vi.fn<(client: unknown, id: number, name: string) => Promise<PersonGroup>>(),
  deletePersonGroup: vi.fn<(client: unknown, id: number) => Promise<void>>(),
  setPersonGroups: vi.fn<(client: unknown, id: string, groupIds: number[]) => Promise<PersonGroupsResponse>>(),
  createPersonGroupToast: vi.fn<(name: string) => void>(),
  renamePersonGroupToast: vi.fn<(oldName: string, newName: string) => void>(),
  deletePersonGroupToast: vi.fn<(name: string) => void>(),
}));

vi.mock("@librephotos/api-client", async importOriginal => {
  const original = await importOriginal<typeof import("@librephotos/api-client")>();
  return {
    ...original,
    endpoints: {
      ...original.endpoints,
      fetchPersonGroups: stubs.fetchPersonGroups,
      createPersonGroup: stubs.createPersonGroup,
      renamePersonGroup: stubs.renamePersonGroup,
      deletePersonGroup: stubs.deletePersonGroup,
      setPersonGroups: stubs.setPersonGroups,
    },
  };
});
vi.mock("../../../service/notifications", () => ({
  notification: {
    createPersonGroup: stubs.createPersonGroupToast,
    renamePersonGroup: stubs.renamePersonGroupToast,
    deletePersonGroup: stubs.deletePersonGroupToast,
  },
}));

let client: QueryClient;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
});

/** Render `useHook` once, run `act` on its value, and answer the invalidated filters. */
async function run<T>(useHook: () => T, action: (value: T) => Promise<unknown>) {
  const invalidate = vi.spyOn(client, "invalidateQueries");
  let value: T | undefined;
  function Harness() {
    value = useHook();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    );
  });
  await act(async () => {
    await action(defined(value));
  });
  await act(async () => root.unmount());
  return invalidate.mock.calls.map(([filters]) => filters);
}

describe("person group mutations", () => {
  it("creates a group, says so and refreshes the group list", async () => {
    stubs.createPersonGroup.mockResolvedValue({ id: 5, name: "Club", person_count: 0 });
    const calls = await run(useCreatePersonGroupMutation, mutation => mutation.mutateAsync("Club"));

    expect(stubs.createPersonGroup).toHaveBeenCalledWith(expect.anything(), "Club");
    expect(stubs.createPersonGroupToast).toHaveBeenCalledWith("Club");
    expect(calls).toEqual([{ queryKey: albumKeys.personGroups() }]);
  });

  it("renames a group", async () => {
    stubs.renamePersonGroup.mockResolvedValue({ ...FAMILY, name: "Kin" });
    const calls = await run(useRenamePersonGroupMutation, mutation =>
      mutation.mutateAsync({ id: 3, name: "Family", newName: "Kin" })
    );

    expect(stubs.renamePersonGroup).toHaveBeenCalledWith(expect.anything(), 3, "Kin");
    expect(stubs.renamePersonGroupToast).toHaveBeenCalledWith("Family", "Kin");
    expect(calls).toEqual([{ queryKey: albumKeys.personGroups() }]);
  });

  it("deletes a group and refreshes the people lists and the face dashboard", async () => {
    stubs.deletePersonGroup.mockResolvedValue(undefined);
    const calls = await run(useDeletePersonGroupMutation, mutation => mutation.mutateAsync({ id: 3, name: "Family" }));

    expect(stubs.deletePersonGroupToast).toHaveBeenCalledWith("Family");
    expect(calls).toEqual([{ queryKey: albumKeys.peopleAlbums() }, { queryKey: faceKeys.incomplete() }]);
  });

  it("puts a person in groups without a toast", async () => {
    stubs.setPersonGroups.mockResolvedValue({ group_ids: [3] });
    const calls = await run(useSetPersonGroupsMutation, mutation =>
      mutation.mutateAsync({ personId: "12", groupIds: [3] })
    );

    expect(stubs.setPersonGroups).toHaveBeenCalledWith(expect.anything(), "12", [3]);
    expect(calls).toEqual([{ queryKey: albumKeys.peopleAlbums() }, { queryKey: faceKeys.incomplete() }]);
  });
});

describe("usePersonGroupFilter", () => {
  async function filterFor(groupParam: number | undefined, loaded: boolean) {
    stubs.fetchPersonGroups.mockReturnValue(loaded ? Promise.resolve([FAMILY]) : new Promise(() => {}));
    let result: ReturnType<typeof usePersonGroupFilter> | undefined;
    await run(
      () => (result = usePersonGroupFilter(groupParam)),
      async () => {
        if (loaded) await vi.waitFor(() => expect(result?.groups).toHaveLength(1));
      }
    );
    return defined(result);
  }

  it("finds the group of the param", async () => {
    const result = await filterFor(3, true);
    expect(result.group).toEqual(FAMILY);
    expect(result.groupId).toBe(3);
  });

  it("drops a group that is not the user's once the groups are known", async () => {
    const result = await filterFor(99, true);
    expect(result.group).toBeUndefined();
    expect(result.groupId).toBeUndefined();
  });

  it("keeps the param while the groups load", async () => {
    const result = await filterFor(99, false);
    expect(result.groups).toEqual([]);
    expect(result.groupId).toBe(99);
  });
});
