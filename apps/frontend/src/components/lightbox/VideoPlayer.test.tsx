/**
 * A video that will not play is almost never a broken video (issue #714).
 *
 * Originals are handed to the web server to read straight off disk, and that
 * process runs as a far less privileged user than the scanner -- so the file
 * the grid happily thumbnailed can be one the player cannot fetch at all. The
 * player used to describe every one of those failures as "missing, unsupported,
 * or unavailable", which is three guesses and no diagnosis.
 *
 * A `<video>` element exposes no HTTP status, so the cause is recovered by
 * re-requesting the same URL with HEAD. These tests pin the mapping from status
 * to cause, and the two rules that make the message trustworthy: the format is
 * only ever blamed when the bytes actually arrived, and the filesystem detail is
 * shown to administrators alone.
 */
import { MantineProvider } from "@mantine/core";
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoPlayer, classifyVideoFailure } from "./VideoPlayer";

const accessToken = { current: { access: { user_id: "1", name: "dotan", is_admin: false } } };
const diagnostics = { current: undefined as unknown };
const diagnosticsEnabled = vi.fn();

vi.mock("../../api_client/auth/hooks", () => ({
  useAccessToken: () => ({ data: accessToken.current }),
}));

vi.mock("../../api_client/media", () => ({
  useMediaDiagnosticsQuery: (mediaHash: string | undefined, enabled: boolean) => {
    diagnosticsEnabled(mediaHash, enabled);
    return { data: enabled ? diagnostics.current : undefined };
  },
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = (query: string) =>
    ({
      matches: query.includes("min-width"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
  // jsdom never loads media, so playback control is not what is under test here.
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};
});

/** Answer the HEAD probe with a given status and optional marker header. */
function stubProbe(status: number, mediaError?: string) {
  const fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => (name === "X-Media-Error" ? (mediaError ?? null) : null) },
    })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderPlayer() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <VideoPlayer
          url="/media/photos/abc.mp4"
          height="80vh"
          controls
          playing={false}
          mediaHash="abc"
        />
      </MantineProvider>
    );
  });
  const fail = async () => {
    await act(async () => {
      container.querySelector("video")!.dispatchEvent(new Event("error"));
    });
    // Let the probe's promise chain settle before anything is asserted.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };
  const unmount = async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  };
  return { container, fail, unmount };
}

describe("classifyVideoFailure", () => {
  it("blames the format only when the file actually arrived", () => {
    expect(classifyVideoFailure(200, null)).toBe("format");
    expect(classifyVideoFailure(206, null)).toBe("format");
  });

  it("reads an unmarked 403 as the web server being unable to read the file", () => {
    expect(classifyVideoFailure(403, null)).toBe("permission");
  });

  it("reads a marked 403 as an authentication problem instead", () => {
    // Both refusals are a bare 403 with an HTML body; only the marker separates
    // "sign in again" from "fix the library permissions".
    expect(classifyVideoFailure(403, "authentication")).toBe("session");
    expect(classifyVideoFailure(401, null)).toBe("session");
  });

  it("distinguishes a genuinely absent file", () => {
    expect(classifyVideoFailure(404, null)).toBe("missing");
  });

  it("treats anything else as a server failure", () => {
    expect(classifyVideoFailure(500, null)).toBe("server");
    expect(classifyVideoFailure(502, null)).toBe("server");
  });
});

describe("VideoPlayer error reporting", () => {
  beforeEach(() => {
    accessToken.current = { access: { user_id: "1", name: "dotan", is_admin: false } };
    diagnostics.current = undefined;
    diagnosticsEnabled.mockClear();
  });

  it("probes with HEAD so a playable file is not downloaded twice", async () => {
    const fetchMock = stubProbe(200);
    const { fail, unmount } = await renderPlayer();

    await fail();

    expect(fetchMock).toHaveBeenCalledWith("/media/photos/abc.mp4", {
      method: "HEAD",
      credentials: "include",
    });
    await unmount();
  });

  it("tells a regular user it is a server-side permissions problem", async () => {
    stubProbe(403);
    const { container, fail, unmount } = await renderPlayer();

    await fail();

    expect(container.textContent).toContain("lightbox.videoerror.permissiontitle");
    expect(container.textContent).toContain("lightbox.videoerror.permissionuser");
    await unmount();
  });

  it("never asks for filesystem detail on behalf of a regular user", async () => {
    stubProbe(403);
    const { fail, unmount } = await renderPlayer();

    await fail();

    expect(diagnosticsEnabled).not.toHaveBeenCalledWith("abc", true);
    await unmount();
  });

  it("gives an administrator the offending path and a remedy", async () => {
    accessToken.current = { access: { user_id: "1", name: "dotan", is_admin: true } };
    diagnostics.current = {
      path: "/data/SomeUser/Videos/clip.mp4",
      cause: "mode_bits",
      blocking: { path: "/data/SomeUser", kind: "directory", mode: "0750", uid: 1000, gid: 1000 },
      webserver: { uid: 101, gid: 101 },
      mount: { point: "/data", type: "ext4", read_only: false, permissions_from_mount: false, network: false },
      remedies: ["mount_deeper", "chmod"],
    };
    stubProbe(403);
    const { container, fail, unmount } = await renderPlayer();

    await fail();

    expect(diagnosticsEnabled).toHaveBeenCalledWith("abc", true);
    expect(container.textContent).toContain("lightbox.videoerror.permissionadmin");
    expect(container.textContent).toContain("/data/SomeUser");
    expect(container.textContent).toContain("lightbox.videoerror.remedymountdeeper");
    expect(container.textContent).toContain("lightbox.videoerror.remedychmod");
    await unmount();
  });

  it("does not offer chmod when the filesystem would ignore it", async () => {
    accessToken.current = { access: { user_id: "1", name: "dotan", is_admin: true } };
    diagnostics.current = {
      path: "/data/nas/clip.mp4",
      cause: "mode_bits",
      blocking: { path: "/data/nas/clip.mp4", kind: "file", mode: "0640", uid: 1000, gid: 1000 },
      webserver: { uid: 101, gid: 101 },
      mount: { point: "/data/nas", type: "cifs", read_only: false, permissions_from_mount: true, network: true },
      remedies: ["mount_options", "network_fs"],
    };
    stubProbe(403);
    const { container, fail, unmount } = await renderPlayer();

    await fail();

    expect(container.textContent).toContain("lightbox.videoerror.remedymountoptions");
    expect(container.textContent).not.toContain("lightbox.videoerror.remedychmod");
    await unmount();
  });

  it("says the file is gone rather than blaming the format", async () => {
    stubProbe(404);
    const { container, fail, unmount } = await renderPlayer();

    await fail();

    expect(container.textContent).toContain("lightbox.videoerror.missingtitle");
    await unmount();
  });

  it("blames the codec only when the server delivered the file", async () => {
    stubProbe(200);
    const { container, fail, unmount } = await renderPlayer();

    await fail();

    expect(container.textContent).toContain("lightbox.videoerror.formattitle");
    await unmount();
  });

  it("falls back to the old wording when the probe itself cannot run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline")))
    );
    const { container, fail, unmount } = await renderPlayer();

    await fail();

    expect(container.textContent).toContain("lightbox.videoerror.unknowntitle");
    await unmount();
  });
});
