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
import { classifyVideoFailure, factToText, VideoPlayer } from "./VideoPlayer";

const accessToken = { current: { access: { user_id: "1", name: "dotan", is_admin: false } } };
const diagnostics = { current: undefined as unknown };
const diagnosticsEnabled = vi.fn();

vi.mock("../../api_client/auth/hooks", () => ({
  useAccessToken: () => ({ data: accessToken.current }),
}));

const copied = vi.fn();

// Mocked bare, without importOriginal: util.ts pulls in ../api_client/dir-tree,
// which does not exist in the tree, so loading the real module here fails.
vi.mock("../../util/util", () => ({
  copyToClipboard: (text: string) => copied(text),
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
        <VideoPlayer url="/media/photos/abc.mp4" height="80vh" controls playing={false} mediaHash="abc" />
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

// Shared by every describe below: a test that leaves the viewer as an admin
// would otherwise change what the next one is even asserting about.
beforeEach(() => {
  accessToken.current = { access: { user_id: "1", name: "dotan", is_admin: false } };
  diagnostics.current = undefined;
  diagnosticsEnabled.mockClear();
  copied.mockClear();
});

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

describe("factToText", () => {
  it("keeps the path and the mode on one pasteable line", () => {
    expect(
      factToText({ label: "Cannot enter:", code: "/data/SomeUser", suffix: "mode 0750, owned by 1000:1000" })
    ).toBe("Cannot enter: /data/SomeUser \u2014 mode 0750, owned by 1000:1000");
  });

  it("omits the parts that are not there", () => {
    expect(factToText({ label: "Reads files as 101:101." })).toBe("Reads files as 101:101.");
  });
});

describe("VideoPlayer copy button", () => {
  const adminDiagnostics = {
    path: "/data/SomeUser/Videos/clip.mp4",
    cause: "mode_bits",
    blocking: { path: "/data/SomeUser", kind: "directory", mode: "0750", uid: 1000, gid: 1000 },
    webserver: { uid: 101, gid: 101 },
    mount: { point: "/data", type: "ext4", read_only: false, permissions_from_mount: false, network: false },
    remedies: ["mount_deeper", "chmod"],
  };

  it("copies a report carrying every fact the panel shows", async () => {
    accessToken.current = { access: { user_id: "1", name: "dotan", is_admin: true } };
    diagnostics.current = adminDiagnostics;
    stubProbe(403);
    const { container, fail, unmount } = await renderPlayer();
    await fail();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="lightbox.videoerror.copy"]')!.click();
    });

    expect(copied).toHaveBeenCalledTimes(1);
    const report = copied.mock.calls[0][0] as string;
    // The offending path and the remedy are the whole reason to copy this.
    expect(report).toContain("/data/SomeUser");
    expect(report).toContain("lightbox.videoerror.remedychmod");
    // The mode digits arrive through interpolation, which is inert without an
    // i18next instance -- factToText covers that half directly.
    expect(report).toContain("lightbox.videoerror.modeandowner");
    // The failing URL makes the report usable in a bug report.
    expect(report).toContain("/media/photos/abc.mp4");
    await unmount();
  });

  it("copies exactly the lines that were rendered, so the two cannot drift", async () => {
    accessToken.current = { access: { user_id: "1", name: "dotan", is_admin: true } };
    diagnostics.current = adminDiagnostics;
    stubProbe(403);
    const { container, fail, unmount } = await renderPlayer();
    await fail();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="lightbox.videoerror.copy"]')!.click();
    });

    const report = copied.mock.calls[0][0] as string;
    const facts = [
      factToText({
        label: "lightbox.videoerror.blockeddirectory",
        code: "/data/SomeUser",
        suffix: "lightbox.videoerror.modeandowner",
      }),
      "lightbox.videoerror.webserverids",
      "lightbox.videoerror.filesystem",
      "lightbox.videoerror.remedymountdeeper",
      "lightbox.videoerror.remedychmod",
    ];
    facts.forEach(line => expect(report).toContain(line));
    await unmount();
  });

  it("offers the button to a regular user too, so they can pass the message on", async () => {
    stubProbe(403);
    const { container, fail, unmount } = await renderPlayer();
    await fail();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="lightbox.videoerror.copy"]')!.click();
    });

    const report = copied.mock.calls[0][0] as string;
    expect(report).toContain("lightbox.videoerror.permissionuser");
    // A regular user never receives filesystem detail, so none can leak here.
    expect(report).not.toContain("/data/");
    await unmount();
  });

  it("hides the button while the probe is still deciding what to say", async () => {
    let release: (value: unknown) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise(resolve => {
            release = resolve;
          })
      )
    );
    const { container, unmount } = await renderPlayer();
    await act(async () => {
      container.querySelector("video")!.dispatchEvent(new Event("error"));
    });

    expect(container.querySelector('[aria-label="lightbox.videoerror.copy"]')).toBeNull();

    await act(async () => {
      release({ ok: false, status: 404, headers: { get: () => null } });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[aria-label="lightbox.videoerror.copy"]')).not.toBeNull();
    await unmount();
  });
});
