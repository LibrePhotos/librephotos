import { updatePhotoGroups } from "./common";

describe("common", () => {
  test("execute callback when done", () => {
    const fn = vi.fn();

    updatePhotoGroups(fn)([
      {
        id: "1",
        page: 1,
        items: [{ id: "1", isTemp: true } as any, { id: "2", isTemp: false } as any],
      },
    ]);

    expect(fn).toBeCalledTimes(1);
    expect(fn).toBeCalledWith({ id: "1", page: 1 });
  });

  test("do not execute callback if no photos", () => {
    const fn = vi.fn();

    updatePhotoGroups(fn)([
      {
        id: "1",
        page: 1,
      },
    ]);

    expect(fn).not.toBeCalled();
  });

  test("do nothing when no groups", () => {
    const fn = vi.fn();

    updatePhotoGroups(fn)(undefined as any);

    expect(fn).not.toBeCalled();
  });
});
