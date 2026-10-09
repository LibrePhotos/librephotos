/**
 * PhotoListView is memoised, and used to be memoised with a comparator that
 * only looked at `loading`, `idx2hash` and `mediaType`. Every other prop change
 * (title, photoset, header, emptyStateConfig, updateGroups, ...) was dropped
 * until one of those three happened to change too.
 *
 * Its throttled updateGroups/updateItems wrappers were also built once with an
 * empty-deps useCallback, so they called the first-render callback forever.
 *
 * The photo size / text alignment / header size menu used to save by sending
 * the whole profile back, avatar URL included, which the backend rejected with
 * 400 "The submitted data was not a file" (#2153).
 *
 * The items handed to the lightbox dropped date and location, so a non-owner's
 * details panel never showed when or where a photo was taken.
 */
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useUpdateUserMutation } from "../../api_client/user/hooks";
import { PhotoListView } from "./PhotoListView";

const pig = vi.hoisted(() => ({ props: [] as any[] }));
const lightbox = vi.hoisted(() => ({ props: [] as any[] }));
// TanStack Router's useNavigate returns a stable function.
const navigate = vi.hoisted(() => () => {});
const userHooks = vi.hoisted(() => ({
  self: { id: 1, image_scale: 1 } as Record<string, unknown>,
  mutate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ pathname: "/photos" }),
}));
vi.mock("../../api_client/apiClient", () => ({ serverAddress: "", shareAddress: "" }));
vi.mock("../../api_client/albums/hooks", () => ({
  useSetPersonAlbumCoverMutation: () => ({ mutate: () => {} }),
  useSetUserAlbumCoverMutation: () => ({ mutate: () => {} }),
}));
vi.mock("../../api_client/auth/hooks", () => ({
  useAccessToken: () => ({ data: undefined }),
}));
vi.mock("../../api_client/user/hooks", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: userHooks.self, isLoading: false }),
  UserSelfDetailsQueryKeys: ["user"],
  useUpdateUserMutation: vi.fn(() => ({ mutate: userHooks.mutate })),
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
vi.mock("../lightbox/Lightbox", () => ({
  Lightbox: (props: any) => {
    lightbox.props.push(props);
    return null;
  },
}));
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
  // jsdom has no ResizeObserver; the header-size SegmentedControl uses one
  // @ts-ignore
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  pig.props = [];
  lightbox.props = [];
  userHooks.self = { id: 1, image_scale: 1 };
  userHooks.mutate.mockReset();
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

describe("PhotoListView range selection", () => {
  const four = ["a", "b", "c", "d"].map(id => ({ id, image_hash: id, url: id }));
  const placeholder = { id: "0", isTemp: true };

  async function shiftClick(item: object) {
    await act(async () => pig.props.at(-1).handleClick({ shiftKey: true }, item));
  }

  it("selects the whole shift-clicked range and keeps what was already selected", async () => {
    const list = [four[0], four[1], placeholder, four[2], four[3]];
    await render({ photoset: [{ date: "2024-01-01", location: null, items: list }], idx2hash: list });

    await act(async () => pig.props.at(-1).handleSelection(four[0]));
    await act(async () => pig.props.at(-1).handleSelection(four[2]));
    // c .. d, then back to b: c lies in that second range and used to be toggled off
    await shiftClick(four[3]);
    await shiftClick(four[1]);

    const selected = pig.props.at(-1).selectedItems.map((item: { id: string }) => item.id);
    expect(selected.sort()).toEqual(["a", "b", "c", "d"]);
  });
});

// Public and shared views have no photo details, so the lightbox learns from
// the grid item whether to play a video and what date / place to show a
// non-owner. Each side was tested on its own, and the grid dropped date and
// location on the way.
describe("PhotoListView lightbox items", () => {
  const video = {
    id: "v",
    image_hash: "v",
    url: "v",
    type: "video",
    isTemp: false,
    date: "2024-01-01T10:00:00Z",
    location: "Berlin, Germany",
  };
  const placeholder = { id: "0", isTemp: true };

  it("passes each item's type, isTemp, date and location to the lightbox", async () => {
    const list = [video, placeholder];
    await render({ isPublic: true, photoset: [{ date: "2024-01-01", location: null, items: list }], idx2hash: list });

    await act(async () => pig.props.at(-1).handleClick({}, video));

    const { idx2hash } = lightbox.props.at(-1);
    expect(idx2hash[0]).toMatchObject({
      id: "v",
      image_hash: "v",
      type: "video",
      isTemp: false,
      date: "2024-01-01T10:00:00Z",
      location: "Berlin, Germany",
    });
    expect(idx2hash[1]).toMatchObject({ id: "0", isTemp: true });
  });
});

describe("PhotoListView display preferences", () => {
  async function openSettingsMenu() {
    const toggle = document.querySelector<HTMLButtonElement>('button[aria-label="Photo Display Settings"]');
    expect(toggle).not.toBeNull();
    await act(async () => toggle!.click());
    // let the menu's open transition mount the dropdown
    await act(async () => new Promise(resolve => setTimeout(resolve, 50)));
  }

  // The header sizes are a SegmentedControl: a radio input per option, picked
  // through its label.
  function headerSizeButton(label: string) {
    return Array.from(document.querySelectorAll<HTMLLabelElement>("label")).find(
      option => option.textContent === label
    );
  }

  it("saves only the changed preferences, never the avatar URL (#2153)", async () => {
    userHooks.self = {
      id: 1,
      username: "admin",
      image_scale: 1,
      text_alignment: "right",
      header_size: "large",
      avatar: "http://localhost/media/avatars/admin.png",
      avatar_url: "/media/avatars/admin.png",
      scan_directory: "/data",
    };
    await render({});
    await openSettingsMenu();
    vi.useFakeTimers();

    const leftAlign = document.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(leftAlign).not.toBeNull();
    await act(async () => leftAlign!.click());
    await act(async () => headerSizeButton("Small")!.click());
    await act(async () => vi.advanceTimersByTime(600));

    // Both changes arrive in one debounced save, and nothing else is sent.
    expect(userHooks.mutate).toHaveBeenCalledTimes(1);
    expect(userHooks.mutate.mock.calls[0][0]).toEqual({ id: 1, text_alignment: "left", header_size: "small" });
    // The saves are silent, so tweaking the grid does not pop an "Update user" toast.
    expect(vi.mocked(useUpdateUserMutation)).toHaveBeenCalledWith({ silent: true });
  });
});
