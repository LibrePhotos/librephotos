/** #2036: the user dialog counts the photos a changed scan directory leaves outside, once typing settles. */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { photosToTrash } from "./photosToTrash";
import { useScanDirectoryChange, type ScanDirectoryChange } from "./useScanDirectoryChange";

type Query = { userId: number; scanDirectory: string; uploadDirectory: string; enabled: boolean };

const stubs = vi.hoisted(() => ({
  queries: [] as Query[],
  answer: { data: undefined as { outside_count: number } | undefined, isError: false },
  trash: vi.fn<(variables: { userId: number; username: string; count: number }) => void>(),
}));

vi.mock("../../api_client/user/hooks/useScanDirectoryImpactQuery", () => ({
  useScanDirectoryImpactQuery: (query: Query) => {
    stubs.queries.push(query);
    return stubs.answer;
  },
}));
vi.mock("../../api_client/jobs/hooks/useTrashPhotosOutsideLibraryMutation", () => ({
  useTrashPhotosOutsideLibraryMutation: () => ({ mutate: stubs.trash }),
}));

type Input = Parameters<typeof useScanDirectoryChange>[0];

let root: Root;
let result: ScanDirectoryChange | undefined;

function Probe({ input }: Readonly<{ input: Input }>) {
  result = useScanDirectoryChange(input);
  return null;
}

const base: Input = {
  userId: 2,
  savedScanDirectory: "/data/wrong",
  scanDirectory: "/data/wrong",
  uploadDirectory: "",
  isPathValid: true,
};

const render = async (input: Partial<Input>) => {
  await act(async () => root.render(<Probe input={{ ...base, ...input }} />));
};
const current = () => {
  if (!result) throw new Error("not rendered");
  return result;
};
const lastQuery = () => stubs.queries.at(-1);

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.useFakeTimers();
  stubs.queries = [];
  stubs.answer = { data: undefined, isError: false };
  stubs.trash.mockReset();
  result = undefined;
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

describe("useScanDirectoryChange", () => {
  it("is no change while the folder stays, and counts nothing", async () => {
    await render({});

    expect(current().changed).toBe(false);
    expect(lastQuery()?.enabled).toBe(false);
  });

  it("is no change for a new user, a user without a folder, or a folder that does not exist", async () => {
    for (const input of [
      { userId: undefined, scanDirectory: "/data/sam" },
      { savedScanDirectory: undefined, scanDirectory: "/data/sam" },
      { scanDirectory: "" },
      { scanDirectory: "/data/nope", isPathValid: false },
    ]) {
      await render(input);
      expect(current().changed).toBe(false);
    }
  });

  it("counts once the typing settled, with the upload folder", async () => {
    await render({ uploadDirectory: "/data/inbox" });
    await render({ scanDirectory: "/data/sam", uploadDirectory: "/data/inbox" });
    expect(current()).toMatchObject({ changed: true, outsideCount: null });
    expect(lastQuery()?.enabled).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(lastQuery()).toEqual({
      userId: 2,
      scanDirectory: "/data/sam",
      uploadDirectory: "/data/inbox",
      enabled: true,
    });
  });

  it("gives the count, or says it failed", async () => {
    stubs.answer = { data: { outside_count: 12 }, isError: false };
    await render({ scanDirectory: "/data/sam" });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(current()).toMatchObject({ outsideCount: 12, countFailed: false });

    stubs.answer = { data: undefined, isError: true };
    await render({ scanDirectory: "/data/sam" });
    expect(current()).toMatchObject({ outsideCount: null, countFailed: true });
  });

  it("starts the move to the trash for the edited user", async () => {
    await render({ scanDirectory: "/data/sam" });

    current().trashOutside("bob", 12);

    expect(stubs.trash).toHaveBeenCalledWith({ userId: 2, username: "bob", count: 12 });
  });

  it("starts nothing without a user", async () => {
    await render({ userId: undefined });

    current().trashOutside("bob", 12);

    expect(stubs.trash).not.toHaveBeenCalled();
  });
});

describe("photosToTrash", () => {
  it("is the count only for a changed folder, once counted, with the trash chosen", () => {
    expect(photosToTrash({ changed: true, outsideCount: 7 }, "trash")).toBe(7);
    expect(photosToTrash({ changed: true, outsideCount: 7 }, "keep")).toBe(0);
    expect(photosToTrash({ changed: false, outsideCount: 7 }, "trash")).toBe(0);
    expect(photosToTrash({ changed: true, outsideCount: null }, "trash")).toBe(0);
  });
});
