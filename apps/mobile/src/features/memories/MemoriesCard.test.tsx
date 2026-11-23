import { fireEvent, waitFor } from "@testing-library/react-native";
import { MemoriesCard } from "./MemoriesCard";
import { mockRouter, renderWithDb, settleDb } from "@/test/test-utils";
import { createTestDb, remotePhoto, seedRemotePhotos, type TestDb } from "@librephotos/local-db/testing";

/** Noon-local timestamp on today's month-day, `yearsAgo` years back. */
function onThisDayYearsAgo(yearsAgo: number): number {
  const now = new Date();
  return new Date(now.getFullYear() - yearsAgo, now.getMonth(), now.getDate(), 12).getTime();
}

describe("MemoriesCard", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  it("renders nothing when there are no memories", async () => {
    const { queryByTestId } = await renderWithDb(<MemoriesCard />, t.db);
    expect(queryByTestId("memories-card")).toBeNull();
  });

  it("renders a memory thumbnail and navigates on tap", async () => {
    await seedRemotePhotos(t.db, [remotePhoto({ id: "m1", imageHash: "mem-hash", timestamp: onThisDayYearsAgo(2) })]);
    const { getByTestId } = await renderWithDb(<MemoriesCard />, t.db);

    await waitFor(() => expect(getByTestId("memories-card")).toBeTruthy());
    fireEvent.press(getByTestId("memory-mem-hash"));
    await settleDb();
    // jest.setup.js installs the router mock on globalThis.
    const router = mockRouter();
    // Seeded: the viewer paints this photo without asking the mirror first.
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/photo/[id]",
      params: { id: "mem-hash", sh: "mem-hash" },
    });
  });
});
