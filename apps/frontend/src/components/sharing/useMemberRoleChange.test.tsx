/**
 * Taking a contributor's role away asks first (#464). The dialog followed the share mutation's
 * isPending and per-call onSuccess, which only track the newest call: another member's role saved
 * meanwhile showed the dialog busy, and left it open after its own change went through.
 */
import type { ListUser, UserAlbum } from "@librephotos/api-client";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { useMemberRoleChange } from "./useMemberRoleChange";

type ShareParams = { albumId: string; userId: string; share: boolean; role?: string };

const mocks = vi.hoisted(() => ({
  mutate: vi.fn<(params: ShareParams) => void>(),
  mutateAsync: vi.fn<(params: ShareParams) => Promise<void>>(),
}));

vi.mock("../../api_client/albums/hooks", () => ({
  useShareUserAlbumMutation: () => ({ mutate: mocks.mutate, mutateAsync: mocks.mutateAsync, isPending: false }),
}));
vi.mock("./memberRoles", () => ({
  contributedCount: (_album: unknown, user: { id: number }) => (user.id === 1 ? 3 : 0),
}));

const member = (id: number, username: string): ListUser => ({
  id,
  username,
  first_name: "",
  last_name: "",
  public_photo_count: 0,
  public_photo_samples: [],
});
const ada = member(1, "ada");
const bob = member(2, "bob");

type RoleChange = ReturnType<typeof useMemberRoleChange>;
let root: Root;
let latest: RoleChange | undefined;

function Probe() {
  const album: UserAlbum | undefined = undefined;
  latest = useMemberRoleChange("7", album);
  return null;
}

const roleChange = () => defined(latest);

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(async () => {
  mocks.mutate.mockReset();
  mocks.mutateAsync.mockReset();
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe />));
});

afterEach(async () => {
  await act(async () => root.unmount());
});

describe("useMemberRoleChange", () => {
  it("saves a change that takes no photos away at once", async () => {
    await act(async () => roleChange().request(bob, "viewer"));
    expect(mocks.mutate).toHaveBeenCalledWith({ albumId: "7", userId: "2", share: true, role: "viewer" });
    expect(roleChange().opened).toBe(false);
  });

  it("is busy only with its own change, and closes once that went through", async () => {
    let settle: () => void = () => {};
    mocks.mutateAsync.mockReturnValue(new Promise<void>(resolve => (settle = resolve)));
    await act(async () => roleChange().request(ada, "none"));
    expect(roleChange().opened).toBe(true);

    await act(async () => roleChange().confirm());
    expect(roleChange().loading).toBe(true);
    // Another member's role is saved while the confirmed change runs.
    await act(async () => roleChange().request(bob, "viewer"));

    await act(async () => settle());
    expect(roleChange().opened).toBe(false);
    expect(roleChange().loading).toBe(false);
  });

  it("stays open when the change is refused", async () => {
    mocks.mutateAsync.mockRejectedValue(new Error("refused"));
    await act(async () => roleChange().request(ada, "none"));
    await act(async () => roleChange().confirm());
    expect(roleChange().opened).toBe(true);
    expect(roleChange().loading).toBe(false);
  });
});
