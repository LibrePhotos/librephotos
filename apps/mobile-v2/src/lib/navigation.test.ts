import { goBackOr } from "./navigation";

/**
 * Regression cover for the crash reported on the first device run: opening
 * `/memories` from a notification tap (or any deep link) mounts it as the first
 * screen, so `router.back()` has nothing to pop and throws.
 */
describe("goBackOr", () => {
  it("pops the stack when there is history", () => {
    const router = { back: jest.fn(), replace: jest.fn(), canGoBack: () => true };
    goBackOr(router, "/photos");
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("replaces with the fallback when the screen is the first in its stack", () => {
    const router = { back: jest.fn(), replace: jest.fn(), canGoBack: () => false };
    goBackOr(router, "/photos");
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/photos");
  });

  it("falls back rather than throwing when the router cannot report history", () => {
    const router = { back: jest.fn(), replace: jest.fn() };
    goBackOr(router, "/photos");
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/photos");
  });
});
