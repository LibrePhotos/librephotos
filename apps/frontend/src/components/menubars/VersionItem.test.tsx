/**
 * #2311: the sidebar's version line. Everyone sees `Version: <tag>` with the commit in a tooltip;
 * while a newer release is out, an admin also sees a dot, and the line opens the Admin page's
 * Update available card.
 */
import type { UpdateStatus } from "@librephotos/api-client";
import React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { click, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { VersionItem } from "./VersionItem";

const stubs = vi.hoisted(() => ({
  imageTag: { image_tag: "1.4.0", git_hash: "abc1234" } as { image_tag: string; git_hash: string } | undefined,
  isSuperuser: false,
  notice: null as Pick<UpdateStatus, "latest"> | null,
  asked: [] as boolean[],
  navigate: vi.fn<(options: { to: string; hash: string }) => Promise<void>>(),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => stubs.navigate }));
vi.mock("../../api_client/server", () => ({
  useFetchImageTagQuery: () => ({ data: stubs.imageTag }),
  useUpdateNotice: (isAdmin: boolean) => {
    stubs.asked.push(isAdmin);
    return isAdmin ? stubs.notice : null;
  },
}));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: { is_superuser: stubs.isSuperuser } }),
}));

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  stubs.imageTag = { image_tag: "1.4.0", git_hash: "abc1234" };
  stubs.isSuperuser = false;
  stubs.notice = { latest: "1.5.0" };
  stubs.asked = [];
});

describe("VersionItem", () => {
  it("shows the version, and nothing about updates to a user who is not an admin", async () => {
    const { container } = await renderInMantine(<VersionItem iconColor="gray" />);
    expect(container.querySelector("p")?.textContent).toBe("Version: 1.4.0");
    expect(container.querySelector("a")).toBeNull();
    expect(stubs.asked).not.toContain(true);
  });

  it("says dev without an image tag", async () => {
    stubs.imageTag = undefined;
    const { container } = await renderInMantine(<VersionItem iconColor="gray" />);
    expect(container.querySelector("p")?.textContent).toBe("Version: dev");
  });

  it("marks a newer release for an admin and opens its card", async () => {
    stubs.isSuperuser = true;
    const { container } = await renderInMantine(<VersionItem iconColor="gray" />);
    const line = defined(container.querySelector("a"), "the version link");
    expect(line.getAttribute("href")).toBe("/admin#admin-update");
    expect(line.getAttribute("aria-label")).toBe("Version 1.4.0, update available");
    expect(line.querySelector("[aria-hidden]:last-child")).not.toBeNull();

    await click(line);
    expect(stubs.navigate).toHaveBeenCalledWith({ to: "/admin", hash: "admin-update" });
  });

  it("leaves a Ctrl-click to the browser", async () => {
    stubs.isSuperuser = true;
    const { container } = await renderInMantine(<VersionItem iconColor="gray" />);
    const line = defined(container.querySelector("a"), "the version link");
    line.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
    expect(stubs.navigate).not.toHaveBeenCalled();
  });

  it("stays plain for an admin without a notice", async () => {
    stubs.isSuperuser = true;
    stubs.notice = null;
    const { container } = await renderInMantine(<VersionItem iconColor="gray" />);
    expect(container.querySelector("a")).toBeNull();
  });
});
