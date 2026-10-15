/**
 * The File card: the file name opens the original, the other formats each
 * download, the folder is shown below the library root, copies are listed,
 * a stack's photo opens on its own page, and All metadata is offered.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { makePhoto } from "../lightbox/photoFixture.test-utils";
import type { StackSection } from "../lightbox/StackSection";
import { setUpMantineDom } from "../modals/confirmModal.test-utils";
import { FileCard } from "./FileCard";

const stubs = vi.hoisted(() => {
  const stacks: React.ComponentProps<typeof StackSection>[] = [];
  return {
    stacks,
    navigate: vi.fn<(options: { to: string; params: { id: string } }) => Promise<void>>(async () => {}),
  };
});

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, params }: { children?: React.ReactNode; to: string; params?: { id: string } }) => (
    <a href={`${to}#${params?.id ?? ""}`}>{children}</a>
  ),
  useNavigate: () => stubs.navigate,
}));
vi.mock("../../api_client/urls", () => ({ serverAddress: "" }));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: { scan_directory: "C:\\Photos" } }),
}));
vi.mock("../allmetadata/AllMetadataButton", () => ({
  AllMetadataButton: ({ variant }: { variant: string }) => <button type="button">all metadata {variant}</button>,
}));
vi.mock("../lightbox/CategoryBadge", () => ({ CategoryBadge: () => <span>category</span> }));
vi.mock("../lightbox/StackSection", () => ({
  StackSection: (props: React.ComponentProps<typeof StackSection>) => {
    stubs.stacks.push(props);
    return null;
  },
}));

beforeAll(setUpMantineDom);

const mounted: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (mounted.length) await defined(mounted.pop())();
  stubs.stacks.length = 0;
  stubs.navigate.mockClear();
});

async function renderCard(photo: ReturnType<typeof makePhoto>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <FileCard photo={photo} />
      </MantineProvider>
    );
  });
  mounted.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  return container;
}

const mainPath = "C:\\Photos\\2024\\Algarve\\IMG_1.HEIC";
const rawPath = "C:\\Photos\\2024\\Algarve\\IMG_1.RAF";

const photo = makePhoto({
  id: "p1",
  image_hash: "h1",
  image_path: [mainPath, rawPath, "D:\\Backup\\IMG_1.HEIC"],
  width: 6240,
  height: 4160,
  size: 8_800_000,
  file_variants: [
    { hash: "h1", path: mainPath, type: "image", type_id: 1, is_main: true, filename: null },
    { hash: "r1", path: rawPath, type: "raw", type_id: 3, is_main: false, filename: null },
  ],
  stacks: [
    {
      id: "s1",
      type: "burst",
      type_display: "Burst",
      photo_count: 2,
      is_primary: true,
      photos: [
        { id: "p2", image_hash: "h2", is_primary: false, thumbnail_url: null, size: null, width: null, height: null },
      ],
    },
  ],
});

describe("file card", () => {
  it("names the file, its size and its other formats to download", async () => {
    const container = await renderCard(photo);
    expect(container.textContent).toContain("IMG_1.HEIC");
    expect(container.textContent).toContain("6240 × 4160 · 26 MP · 8.8 MB");
    const download = defined(container.querySelector<HTMLAnchorElement>("a[download]"));
    expect(download.getAttribute("download")).toBe("IMG_1.RAF");
    expect(download.getAttribute("href")).toContain("r1");
    expect(container.textContent).toContain("category");
  });

  it("shows the folder below the library root, each part linking to its full path", async () => {
    const container = await renderCard(photo);
    const folderLinks = [...container.querySelectorAll<HTMLAnchorElement>('a[href^="/album/folder"]')];
    expect(folderLinks.map(link => link.textContent)).toEqual(["2024", "Algarve", "D:", "Backup"]);
    expect(folderLinks[1]?.getAttribute("href")).toContain(encodeURIComponent("C:/Photos/2024/Algarve"));
  });

  it("lists a copy of the file that is not one of its formats", async () => {
    const container = await renderCard(photo);
    expect(container.textContent).toContain("exif.duplicates");
  });

  it("opens a photo of the stack on its own page, by its hash", async () => {
    await renderCard(photo);
    const { onPhotoSelect } = defined(stubs.stacks.at(-1));
    await act(async () => defined(onPhotoSelect)("p2"));
    expect(stubs.navigate).toHaveBeenCalledWith({ to: "/photo/$id", params: { id: "h2" } });
    await act(async () => defined(onPhotoSelect)("unknown"));
    expect(stubs.navigate).toHaveBeenCalledTimes(1);
  });

  it("ends with the All metadata button", async () => {
    const container = await renderCard(photo);
    expect(container.textContent).toContain("all metadata button");
  });

  it("says when the file name is unknown and lists nothing it does not have", async () => {
    const container = await renderCard(makePhoto({ image_hash: "h3" }));
    expect(container.textContent).toContain("photopage.unknownfilename");
    expect(container.textContent).not.toContain("exif.duplicates");
    expect(container.textContent).not.toContain("photopage.file.formats");
  });
});
