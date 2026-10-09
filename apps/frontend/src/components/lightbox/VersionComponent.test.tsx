/**
 * The file row of the info panel: it printed height × width (a landscape photo
 * read as portrait), showed a Windows backend's sub-path instead of the file
 * name, and built its "+N formats" plural in English code.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { VersionComponent } from "./VersionComponent";

vi.mock("../../api_client/apiClient", () => ({ serverAddress: "" }));
// Its folder links are router links, which need a router this test has not got.
vi.mock("../common/BreadcrumbPath", () => ({ BreadcrumbPath: () => null }));

beforeAll(async () => {
  // @ts-ignore - jsdom has no matchMedia, MantineProvider needs it
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

const variant = (hash: string) => ({ hash, type: "raw", is_main: false, path: `/lib/${hash}.raf`, filename: null });

async function renderText(overrides: Record<string, unknown>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const photoDetail = {
    image_hash: "abc",
    width: 4000,
    height: 3000,
    size: 2 * 1024 * 1024,
    image_path: ["/lib/photos/IMG_0001.jpg"],
    file_variants: [],
    ...overrides,
  } as any;
  await act(async () => {
    root.render(
      <MantineProvider>
        <VersionComponent photoDetail={photoDetail} isPublic={false} />
      </MantineProvider>
    );
  });
  const text = Array.from(container.querySelectorAll("p, button"))
    .map(element => element.textContent)
    .join(" | ");
  await act(async () => root.unmount());
  container.remove();
  return text;
}

describe("VersionComponent", () => {
  it("shows width × height", async () => {
    expect(await renderText({})).toContain("4000 × 3000");
  });

  it("shows the file name of a Windows path", async () => {
    const text = await renderText({ image_path: ["C:/lib/photos\\Family\\IMG_0033.jpg"] });
    expect(text).toContain("IMG_0033.jpg");
    expect(text).not.toContain("Family");
  });

  it("counts other formats with a translated plural", async () => {
    expect(await renderText({ file_variants: [variant("a")] })).toContain("+1 format |");
    expect(await renderText({ file_variants: [variant("a"), variant("b")] })).toContain("+2 formats");
  });
});
