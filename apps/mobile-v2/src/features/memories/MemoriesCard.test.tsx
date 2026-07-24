import { fireEvent, waitFor } from "@testing-library/react-native";
import { MemoriesCard } from "./MemoriesCard";
import { renderWithDb } from "@/test/test-utils";
import { createTestDb, type TestDb } from "@/db/test-db";
import { seedRemotePhotos, remotePhoto } from "@/db/__tests__/fixtures";

/** Noon-local timestamp on today's month-day, `yearsAgo` years back. */
function onThisDayYearsAgo(yearsAgo: number): number {
  const now = new Date();
  return new Date(now.getFullYear() - yearsAgo, now.getMonth(), now.getDate(), 12).getTime();
}

describe("MemoriesCard", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  it("renders nothing when there are no memories", () => {
    const { queryByTestId } = renderWithDb(<MemoriesCard />, t.db);
    expect(queryByTestId("memories-card")).toBeNull();
  });

  it("renders a memory thumbnail and navigates on tap", async () => {
    seedRemotePhotos(t.db, [remotePhoto({ id: "m1", imageHash: "mem-hash", timestamp: onThisDayYearsAgo(2) })]);
    const { getByTestId } = renderWithDb(<MemoriesCard />, t.db);

    await waitFor(() => expect(getByTestId("memories-card")).toBeTruthy());
    fireEvent.press(getByTestId("memory-mem-hash"));
    const router = (globalThis as unknown as { __mockRouter: { push: jest.Mock } }).__mockRouter;
    expect(router.push).toHaveBeenCalledWith("/photo/mem-hash");
  });
});
