/**
 * PhotoListView is memoised, and used to be memoised with a comparator that
 * only looked at `loading`, `idx2hash` and `mediaType`. Every other prop change
 * (title, photoset, header, emptyStateConfig, updateGroups, ...) was dropped
 * until one of those three happened to change too.
 *
 * Its throttled updateGroups/updateItems wrappers were also built once with an
 * empty-deps useCallback, so they called the first-render callback forever.
 */
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PhotoListView } from "./PhotoListView";

const pig = vi.hoisted(() => ({ props: [] as any[] }));
// TanStack Router's useNavigate returns a stable function.
const navigate = vi.hoisted(() => () => {});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ pathname: "/photos" }),
}));
vi.mock("../../api_client/apiClient", () => ({ serverAddress: "" }));
vi.mock("../../api_client/albums/hooks", () => ({
  useSetPersonAlbumCoverMutation: () => ({ mutate: () => {} }),
  useSetUserAlbumCoverMutation: () => ({ mutate: () => {} }),
}));
vi.mock("../../api_client/auth/hooks", () => ({
  useAccessToken: () => ({ data: undefined }),
}));
vi.mock("../../api_client/user/hooks", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: { id: 1, image_scale: 1 }, isLoading: false }),
  UserSelfDetailsQueryKeys: ["user"],
  useUpdateUserMutation: () => ({ mutate: () => {} }),
}));
// A fresh array per call, like the real formatter: that is what made Pig
// re-lay-out the grid on every parent render.
vi.mock("../../util/util", () => ({
  formatDateForPhotoGroups: (groups: any[]) => groups.map(group => ({ ...group })),
}));
vi.mock("../react-pig", () => ({
  default: React.forwardRef((props: any, _ref) => {
    pig.props.push(props);
    return <div data-testid="pig" />;
  }),
}));
vi.mock("./DefaultHeader", () => ({
  DefaultHeader: ({ title }: { title: string }) => <h1 data-testid="title">{title}</h1>,
}));
vi.mock("../scrollscrubber/ScrollScrubber", () => ({
  ScrollScrubber: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../lightbox/Lightbox", () => ({ Lightbox: () => null }));
vi.mock("../modals/AlbumCoverPickerModal", () => ({ AlbumCoverPickerModal: () => null }));
vi.mock("../modals/AlbumEdit/AlbumEditModal", () => ({ AlbumEditModal: () => null }));
vi.mock("../modals/ModalTagEdit", () => ({ ModalTagEdit: () => null }));
vi.mock("../sharing/ModalAlbumShare", () => ({ ModalAlbumShare: () => null }));
vi.mock("../sharing/ModalPhotosShare", () => ({ ModalPhotosShare: () => null }));
vi.mock("./MediaTypeSelector", () => ({ MediaTypeSelector: () => null }));
vi.mock("./SelectionActions", () => ({ SelectionActions: () => null }));
vi.mock("./SelectionBar", () => ({ SelectionBar: () => null }));
vi.mock("./TrashcanActions", () => ({ TrashcanActions: () => null }));

const items = [
  { id: "a", image_hash: "a", url: "a" },
  { id: "b", image_hash: "b", url: "b" },
];
const photoset = [{ date: "2024-01-01", location: null, items }];

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const queryClient = new QueryClient();

async function render(props: Partial<React.ComponentProps<typeof PhotoListView>>) {
  if (!container) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  await act(async () => {
    root!.render(
      <QueryClientProvider client={queryClient}>
        <MantineProvider>
          <PhotoListView
            title="Photos"
            loading={false}
            icon={null}
            photoset={photoset}
            idx2hash={items}
            selectable
            {...props}
          />
        </MantineProvider>
      </QueryClientProvider>
    );
  });
  return container;
}

beforeAll(() => {
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
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  pig.props = [];
  vi.useRealTimers();
});

describe("PhotoListView memoisation", () => {
  it("re-renders when only the title changes", async () => {
    const el = await render({ title: "Before" });
    expect(el.querySelector('[data-testid="title"]')?.textContent).toBe("Before");

    await render({ title: "After" });
    expect(el.querySelector('[data-testid="title"]')?.textContent).toBe("After");
  });

  it("re-renders when only the header changes", async () => {
    const el = await render({ header: <p data-testid="header">one</p> });
    expect(el.querySelector('[data-testid="header"]')?.textContent).toBe("one");

    await render({ header: <p data-testid="header">two</p> });
    expect(el.querySelector('[data-testid="header"]')?.textContent).toBe("two");
  });

  it("keeps Pig's props stable across a re-render that changes nothing Pig uses", async () => {
    await render({ title: "Before", updateGroups: () => {} });
    const first = pig.props.at(-1);

    await render({ title: "After", updateGroups: () => {} });
    const last = pig.props.at(-1);

    // The date groups are only re-formatted when the photoset changes, so Pig
    // does not re-lay-out the grid.
    expect(last.imageData).toBe(first.imageData);
    expect(last.updateGroups).toBe(first.updateGroups);
    expect(last.updateItems).toBe(first.updateItems);
    expect(last.handleClick).toBe(first.handleClick);
    expect(last.handleSelection).toBe(first.handleSelection);
    expect(last.selectedItems).toBe(first.selectedItems);
  });
});

describe("PhotoListView throttled callbacks", () => {
  it("calls the latest updateGroups, not the one from the first render", async () => {
    vi.useFakeTimers();
    const first = vi.fn();
    const latest = vi.fn();

    await render({ updateGroups: first });
    await render({ updateGroups: latest });

    const visible = [{ id: "group" }];
    pig.props.at(-1).updateGroups(visible);

    expect(latest).toHaveBeenCalledWith(visible);
    expect(first).not.toHaveBeenCalled();
  });

  it("calls the latest updateItems", async () => {
    vi.useFakeTimers();
    const first = vi.fn();
    const latest = vi.fn();

    await render({ updateItems: first });
    await render({ updateItems: latest });

    pig.props.at(-1).updateItems(["x"]);

    expect(latest).toHaveBeenCalledWith(["x"]);
    expect(first).not.toHaveBeenCalled();
  });

  it("still throttles: a burst of calls reaches the callback twice at most", async () => {
    vi.useFakeTimers();
    const updateGroups = vi.fn();
    await render({ updateGroups });

    const throttled = pig.props.at(-1).updateGroups;
    for (let i = 0; i < 10; i += 1) throttled([i]);
    vi.advanceTimersByTime(600);

    // leading call + one trailing call with the last arguments
    expect(updateGroups).toHaveBeenCalledTimes(2);
    expect(updateGroups).toHaveBeenLastCalledWith([9]);
  });

  it("drops a pending trailing call on unmount", async () => {
    vi.useFakeTimers();
    const updateGroups = vi.fn();
    await render({ updateGroups });

    const throttled = pig.props.at(-1).updateGroups;
    throttled([1]);
    throttled([2]);
    await act(async () => root?.unmount());
    root = null;
    vi.advanceTimersByTime(600);

    expect(updateGroups).toHaveBeenCalledTimes(1);
  });
});
