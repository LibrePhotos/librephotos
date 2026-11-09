/**
 * The 401 that ends a session used to toast right before the page load to /login, which dropped the
 * toast with the page. The login page says it instead, once, and drops the `session` parameter.
 */
import React, { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionExpiredNotice } from "./useSessionExpiredNotice";

const stubs = vi.hoisted(() => ({
  invalidToken: vi.fn<() => void>(),
  navigate: vi.fn<(options: { to: string; search: { redirect?: string }; replace: boolean }) => Promise<void>>(),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => stubs.navigate }));
vi.mock("../../service/notifications", () => ({ notification: { invalidToken: stubs.invalidToken } }));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  stubs.invalidToken.mockReset();
  stubs.navigate.mockReset();
  stubs.navigate.mockResolvedValue(undefined);
});

async function renderNotice(expired: boolean) {
  function Page() {
    useSessionExpiredNotice(expired, "/settings");
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () =>
    root.render(
      <StrictMode>
        <Page />
      </StrictMode>
    )
  );
  act(() => root.unmount());
}

describe("useSessionExpiredNotice", () => {
  it("says the session ran out once, and keeps only the way back", async () => {
    await renderNotice(true);

    expect(stubs.invalidToken).toHaveBeenCalledTimes(1);
    expect(stubs.navigate).toHaveBeenCalledWith({ to: "/login", search: { redirect: "/settings" }, replace: true });
  });

  it("says nothing on a plain visit", async () => {
    await renderNotice(false);

    expect(stubs.invalidToken).not.toHaveBeenCalled();
    expect(stubs.navigate).not.toHaveBeenCalled();
  });
});
