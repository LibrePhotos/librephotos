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
 *
 * A public album's slideshow link (#1457) opens the lightbox on the first photo, playing, once
 * the photos are there; closing it hands back to the page, which drops the flag.
 *
 * The lightbox lived in component state, so Back left the page instead of closing it, a reload
 * dropped it, and no link could point at a photo in a list (#2231): the open photo is now the
 * list's `?photo=` search param.
 *
 * The selection bar ("0 selected", two mostly disabled menus) took a row on every list while
 * browsing; it shows only while selecting, and the header's Select button brings it up (#2240).
 */
import { Media } from "@librephotos/api-client";
import type { DatePhotosGroup, Photo, PigPhoto } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import { IconPhoto } from "@tabler/icons-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useUpdateUserMutation } from "../../api_client/user/hooks";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { createTestRouter, searchOf, settle, type TestRouter } from "../../util/memoryRouter.test-utils";
import type { Lightbox } from "../lightbox/Lightbox";
import { makePhoto } from "../lightbox/photoFixture.test-utils";
import type { GroupedImageItem, PigHandle, PigProps } from "../react-pig";
import { validateMediaSearch } from "./mediaTypeFilter";
import { PhotoListView } from "./PhotoListView";
import type { SelectionBar } from "./SelectionBar";

type LightboxProps = React.ComponentProps<typeof Lightbox>;
type SelectionBarProps = React.ComponentProps<typeof SelectionBar>;
type PhotoListViewProps = React.ComponentProps<typeof PhotoListView>;
type UpdateGroups = NonNullable<PhotoListViewProps["updateGroups"]>;
type UpdateItems = NonNullable<PhotoListViewProps["updateItems"]>;
type UpdateUser = ReturnType<typeof useUpdateUserMutation>["mutate"];

const pig = vi.hoisted(() => ({ props: [] as PigProps<PigPhoto>[] }));
const lightbox = vi.hoisted(() => ({ props: [] as LightboxProps[] }));
const selectionBar = vi.hoisted(() => ({ props: undefined as SelectionBarProps | undefined }));
// The photo details a photo the list does not hold is checked against.
const details = vi.hoisted(() => ({
  result: { data: undefined as Photo | undefined, isError: false },
  asked: [] as string[],
}));
const userHooks = vi.hoisted(() => ({
  self: { id: 1, image_scale: 1 } as Record<string, unknown>,
  mutate: vi.fn<UpdateUser>(),
}));

vi.mock("../../api_client/urls", () => ({ serverAddress: "", shareAddress: "" }));
vi.mock("../../api_client/albums/hooks", () => ({
  useSetPersonAlbumCoverMutation: () => ({ mutate: () => {} }),
  useSetEventCoverMutation: () => ({ mutate: () => {} }),
  useSetUserAlbumCoverMutation: () => ({ mutate: () => {} }),
}));
vi.mock("../../api_client/auth/hooks", () => ({
  useAccessToken: () => ({ data: undefined }),
}));
vi.mock("../../api_client/photos/hooks", () => ({
  useFetchPhotoDetailsQuery: (hash: string, skip = false) => {
    if (skip) return { data: undefined, isError: false };
    details.asked.push(hash);
    return details.result;
  },
}));
vi.mock("../../api_client/user/hooks", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: userHooks.self, isLoading: false }),
  useUpdateUserMutation: vi.fn(() => ({ mutate: userHooks.mutate })),
}));
// A fresh array per call, like the real formatter: that is what made Pig
// re-lay-out the grid on every parent render.
vi.mock("../../util/util", () => ({
  formatDateForPhotoGroups: (groups: DatePhotosGroup[]) => groups.map(group => ({ ...group })),
}));
vi.mock("../react-pig", () => ({
  default: React.forwardRef<PigHandle<PigPhoto>, PigProps<PigPhoto>>((props, _ref) => {
    pig.props.push(props);
    return <div data-testid="pig" />;
  }),
}));
vi.mock("./DefaultHeader", () => ({
  DefaultHeader: ({ title, titleBadge }: { title: string; titleBadge?: React.ReactNode }) => (
    <h1 data-testid="title">
      {title}
      {titleBadge}
    </h1>
  ),
}));
vi.mock("../scrollscrubber/ScrollScrubber", () => ({
  ScrollScrubber: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../lightbox/Lightbox", () => ({
  Lightbox: (props: LightboxProps) => {
    lightbox.props.push(props);
    return <div data-testid="lightbox" />;
  },
}));
vi.mock("../modals/AlbumCoverPickerModal", () => ({ AlbumCoverPickerModal: () => null }));
vi.mock("../modals/AlbumEdit/AlbumEditModal", () => ({ AlbumEditModal: () => null }));
vi.mock("../modals/ModalTagEdit", () => ({ ModalTagEdit: () => null }));
vi.mock("../sharing/ModalAlbumShare", () => ({ ModalAlbumShare: () => null }));
vi.mock("../sharing/ModalPhotosShare", () => ({ ModalPhotosShare: () => null }));
vi.mock("./MediaTypeSelector", () => ({ MediaTypeSelector: () => <span data-testid="media-filter" /> }));
vi.mock("./SelectionActions", () => ({ SelectionActions: () => null }));
vi.mock("./SelectionBar", () => ({
  SelectionBar: (props: SelectionBarProps) => {
    selectionBar.props = props;
    return null;
  },
}));
vi.mock("./TrashcanActions", () => ({ TrashcanActions: () => null }));

// A grid photo; `image_hash` is what Pig builds the thumbnail address from.
function photo(id: string, extra: Partial<PigPhoto> = {}): PigPhoto {
  return {
    id,
    image_hash: id,
    aspectRatio: 1,
    type: Media.IMAGE,
    is_hdr: false,
    rating: 0,
    shared_to: [],
    isTemp: false,
    has_raw_variant: false,
    ...extra,
  };
}

// A day of the paginated date list, as Pig reports it on screen.
function visibleGroup(id: number | string | undefined, groupItems: PigPhoto[] = []): GroupedImageItem<PigPhoto> {
  return { id, date: "2024-01-01", location: null, items: groupItems };
}

// A real React click event with these modifier keys, caught on a button rendered for the
// purpose: the handlers read the modifier keys of the click Pig hands them.
function click(modifiers: Pick<MouseEventInit, "shiftKey" | "ctrlKey" | "metaKey"> = {}): React.MouseEvent {
  let caught: React.MouseEvent | undefined;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const clickRoot = createRoot(host);
  act(() => {
    clickRoot.render(
      <button
        type="button"
        onClick={event => {
          caught = event;
        }}
      />
    );
  });
  act(() => {
    host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true, ...modifiers }));
  });
  act(() => clickRoot.unmount());
  host.remove();
  if (!caught) throw new Error("the click did not reach React");
  return caught;
}

function lastPigProps() {
  const props = pig.props.at(-1);
  if (!props) throw new Error("Pig was not rendered");
  return props;
}

const items = [photo("a"), photo("b")];
const photoset: DatePhotosGroup[] = [{ date: "2024-01-01", location: null, items }];

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let router: TestRouter | null = null;
const queryClient = new QueryClient();

// The list is the page of a real (in-memory) router, so the lightbox's `?photo=` really moves
// through history; each render hands the page its props through context.
const ListProps = React.createContext<Partial<PhotoListViewProps>>({});
function ListPage() {
  const props = React.useContext(ListProps);
  return (
    <PhotoListView
      title="Photos"
      loading={false}
      icon={IconPhoto}
      photoset={photoset}
      idx2hash={items}
      selectable
      {...props}
    />
  );
}

const theRouter = () => defined(router, "the router");

async function render(props: Partial<PhotoListViewProps>, url = "/photos") {
  if (!container) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    router = createTestRouter(
      [
        { path: "/photos", component: ListPage, validateSearch: validateMediaSearch },
        { path: "/photo/$id", component: () => null },
      ],
      url
    );
  }
  const current = theRouter();
  await act(async () => {
    defined(root).render(
      <QueryClientProvider client={queryClient}>
        <MantineProvider>
          <ListProps.Provider value={props}>
            <RouterProvider router={current} />
          </ListProps.Provider>
        </MantineProvider>
      </QueryClientProvider>
    );
  });
  await settle(current);
  return container;
}

beforeAll(() => {
  // jsdom has no matchMedia, MantineProvider needs it
  window.matchMedia = (query: string): MediaQueryList => ({
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
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

// The first render of the page in a router pays for setting up Mantine, the router and the
// list's modules: seconds on a busy machine. Paid here, under the hook's longer timeout, rather
// than by whichever test happens to run first.
beforeAll(async () => {
  await render({});
  await cleanUp();
}, 30_000);

async function cleanUp() {
  await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  router = null;
  pig.props = [];
  lightbox.props = [];
  details.result = { data: undefined, isError: false };
  details.asked = [];
  userHooks.self = { id: 1, image_scale: 1 };
  userHooks.mutate.mockReset();
  vi.useRealTimers();
}

afterEach(cleanUp);

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

  it("leaves the sticky header out for a null header, under the page's own header", async () => {
    const el = await render({ header: null, isPublic: true });

    expect(el.querySelector('[data-testid="title"]')).toBeNull();
    expect(el.querySelector('[data-testid="pig"]')).not.toBeNull();
  });

  it("keeps Pig's props stable across a re-render that changes nothing Pig uses", async () => {
    await render({ title: "Before", updateGroups: () => {} });
    const first = lastPigProps();

    await render({ title: "After", updateGroups: () => {} });
    const last = lastPigProps();

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

describe("PhotoListView thumbnail addresses", () => {
  it("builds them from the image hash Pig passes, small below 250px", async () => {
    await render({});
    const getUrl = defined(lastPigProps().getUrl);

    expect(getUrl("abc123", 100)).toMatch(/\/media\/square_thumbnails_small\/abc123$/);
    expect(getUrl("abc123", 400)).toMatch(/\/media\/square_thumbnails\/abc123$/);
  });
});

describe("PhotoListView throttled callbacks", () => {
  it("calls the latest updateGroups, not the one from the first render", async () => {
    vi.useFakeTimers();
    const first = vi.fn<UpdateGroups>();
    const latest = vi.fn<UpdateGroups>();

    await render({ updateGroups: first });
    await render({ updateGroups: latest });

    const visible = [visibleGroup(1)];
    defined(lastPigProps().updateGroups)(visible);

    expect(latest).toHaveBeenCalledWith(visible);
    expect(first).not.toHaveBeenCalled();
  });

  it("passes on only the groups with a date album id, the page loader's key", async () => {
    vi.useFakeTimers();
    const updateGroups = vi.fn<UpdateGroups>();
    await render({ updateGroups });

    // A string id is a client-side key (the sharing page's per-user groups): nothing to load.
    defined(lastPigProps().updateGroups)([visibleGroup(undefined), visibleGroup("user-3"), visibleGroup(2)]);

    expect(updateGroups).toHaveBeenCalledWith([visibleGroup(2)]);
  });

  it("calls the latest updateItems", async () => {
    vi.useFakeTimers();
    const first = vi.fn<UpdateItems>();
    const latest = vi.fn<UpdateItems>();

    await render({ updateItems: first });
    await render({ updateItems: latest });

    defined(lastPigProps().updateItems)([photo("x")]);

    expect(latest).toHaveBeenCalledWith([photo("x")]);
    expect(first).not.toHaveBeenCalled();
  });

  it("still throttles: a burst of calls reaches the callback twice at most", async () => {
    vi.useFakeTimers();
    const updateGroups = vi.fn<UpdateGroups>();
    await render({ updateGroups });

    const throttled = defined(lastPigProps().updateGroups);
    for (let i = 0; i < 10; i += 1) throttled([visibleGroup(i)]);
    vi.advanceTimersByTime(600);

    // leading call + one trailing call with the last arguments
    expect(updateGroups).toHaveBeenCalledTimes(2);
    expect(updateGroups).toHaveBeenLastCalledWith([visibleGroup(9)]);
  });

  it("drops a pending trailing call on unmount", async () => {
    vi.useFakeTimers();
    const updateGroups = vi.fn<UpdateGroups>();
    await render({ updateGroups });

    const throttled = defined(lastPigProps().updateGroups);
    throttled([visibleGroup(1)]);
    throttled([visibleGroup(2)]);
    await act(async () => root?.unmount());
    root = null;
    vi.advanceTimersByTime(600);

    expect(updateGroups).toHaveBeenCalledTimes(1);
  });
});

describe("PhotoListView range selection", () => {
  const four: [PigPhoto, PigPhoto, PigPhoto, PigPhoto] = [photo("a"), photo("b"), photo("c"), photo("d")];
  const placeholder = photo("0", { isTemp: true });

  async function shiftClick(item: PigPhoto) {
    const event = click({ shiftKey: true });
    await act(async () => defined(lastPigProps().handleClick)(event, item));
  }

  it("selects the whole shift-clicked range and keeps what was already selected", async () => {
    const list = [four[0], four[1], placeholder, four[2], four[3]];
    await render({ photoset: [{ date: "2024-01-01", location: null, items: list }], idx2hash: list });

    await act(async () => defined(lastPigProps().handleSelection)(four[0]));
    await act(async () => defined(lastPigProps().handleSelection)(four[2]));
    // c .. d, then back to b: c lies in that second range and used to be toggled off
    await shiftClick(four[3]);
    await shiftClick(four[1]);

    const selected = (lastPigProps().selectedItems ?? []).map(item => item.id);
    expect(selected.sort()).toEqual(["a", "b", "c", "d"]);
  });
});

// Public and shared views have no photo details, so the lightbox learns from
// the grid item whether to play a video and what date / place to show a
// non-owner. Each side was tested on its own, and the grid dropped date and
// location on the way.
describe("PhotoListView lightbox items", () => {
  const video = photo("v", {
    type: Media.VIDEO,
    date: "2024-01-01T10:00:00Z",
    location: "Berlin, Germany",
  });
  const placeholder = photo("0", { isTemp: true });

  it("passes each item's type, isTemp, date and location to the lightbox", async () => {
    const list = [video, placeholder];
    await render({ isPublic: true, photoset: [{ date: "2024-01-01", location: null, items: list }], idx2hash: list });

    const event = click();
    await act(async () => defined(lastPigProps().handleClick)(event, video));

    const { idx2hash } = defined(lightbox.props.at(-1));
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

describe("PhotoListView slideshow (#1457)", () => {
  const isLightboxOpen = (el: HTMLElement) => el.querySelector('[data-testid="lightbox"]') !== null;
  const lastLightbox = () => defined(lightbox.props.at(-1), "the lightbox");

  it("opens the lightbox on the first photo, playing", async () => {
    const el = await render({ isPublic: true, slideshow: true });

    expect(isLightboxOpen(el)).toBe(true);
    expect(lastLightbox()).toMatchObject({ selectedImage: "a", startSlideshow: true });
  });

  it("waits for the photos before it starts", async () => {
    const el = await render({ isPublic: true, slideshow: true, loading: true, photoset: [], idx2hash: [] });
    expect(isLightboxOpen(el)).toBe(false);

    await render({ isPublic: true, slideshow: true });
    expect(lastLightbox()).toMatchObject({ selectedImage: "a", startSlideshow: true });
  });

  it("does not start on a placeholder that has not loaded yet", async () => {
    const list = [photo("0", { isTemp: true })];
    const el = await render({ isPublic: true, slideshow: true, photoset: list, idx2hash: list });

    expect(isLightboxOpen(el)).toBe(false);
  });

  it("hands the close back to the page once, and does not start again while the flag stays", async () => {
    const onSlideshowClose = vi.fn<() => void>();
    const el = await render({ isPublic: true, slideshow: true, onSlideshowClose });

    await act(async () => lastLightbox().onCloseRequest());

    expect(isLightboxOpen(el)).toBe(false);
    expect(onSlideshowClose).toHaveBeenCalledTimes(1);
    // The page has not dropped the flag yet: a re-render must not open it again.
    await render({ isPublic: true, slideshow: true, onSlideshowClose, title: "Again" });
    expect(isLightboxOpen(el)).toBe(false);
  });

  it("starts again when the page asks again (Play slideshow)", async () => {
    const el = await render({ isPublic: true, slideshow: true });
    await act(async () => lastLightbox().onCloseRequest());
    await render({ isPublic: true, slideshow: false });

    await render({ isPublic: true, slideshow: true });

    expect(isLightboxOpen(el)).toBe(true);
    expect(lastLightbox().startSlideshow).toBe(true);
  });

  it("leaves a photo opened from the grid alone: no slideshow, no close for the page", async () => {
    const onSlideshowClose = vi.fn<() => void>();
    await render({ isPublic: true, onSlideshowClose });

    const event = click();
    await act(async () => defined(lastPigProps().handleClick)(event, defined(items[1])));
    expect(lastLightbox()).toMatchObject({ selectedImage: "b", startSlideshow: false });
    await act(async () => lastLightbox().onCloseRequest());

    expect(onSlideshowClose).not.toHaveBeenCalled();
  });
});

describe("PhotoListView photo page", () => {
  it("opens the photo page on Ctrl/Cmd-click", async () => {
    await render({});

    const event = click({ ctrlKey: true });
    await act(async () => defined(lastPigProps().handleClick)(event, defined(items[0])));
    await settle(theRouter());

    expect(theRouter().state.location.pathname).toBe("/photo/a");
  });
});

describe("PhotoListView display preferences", () => {
  async function openSettingsMenu() {
    const toggle = document.querySelector<HTMLButtonElement>('button[aria-label="Photo Display Settings"]');
    expect(toggle).not.toBeNull();
    await act(async () => defined(toggle).click());
    // let the menu's open transition mount the dropdown
    await act(async () => new Promise(resolve => setTimeout(resolve, 50)));
  }

  // The header sizes are a SegmentedControl: a radio input per option, picked
  // through its label.
  function headerSizeButton(label: string) {
    return Array.from(document.querySelectorAll("label")).find(option => option.textContent === label);
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
    await act(async () => defined(leftAlign).click());
    await act(async () => defined(headerSizeButton("Small")).click());
    await act(async () => vi.advanceTimersByTime(600));

    // Both changes arrive in one debounced save, and nothing else is sent.
    expect(userHooks.mutate).toHaveBeenCalledTimes(1);
    expect(defined(userHooks.mutate.mock.calls[0])[0]).toEqual({ id: 1, text_alignment: "left", header_size: "small" });
    // The saves are silent, so tweaking the grid does not pop an "Update user" toast.
    expect(vi.mocked(useUpdateUserMutation)).toHaveBeenCalledWith({ silent: true });
  });
});

describe("PhotoListView header actions", () => {
  // The main timeline's Filter button refetches the view on every toggle; an
  // open filter popover closed under the pointer when the toolbar unmounted
  // for the reload (issue #2130).
  it("keeps headerActions mounted while the view reloads", async () => {
    let mounts = 0;
    function Probe() {
      React.useEffect(() => {
        mounts += 1;
      }, []);
      return <span data-testid="filter-button" />;
    }
    const el = await render({ headerActions: <Probe /> });
    expect(el.querySelector('[data-testid="filter-button"]')).not.toBeNull();

    await render({ headerActions: <Probe />, loading: true });
    expect(el.querySelector('[data-testid="filter-button"]')).not.toBeNull();
    await render({ headerActions: <Probe />, loading: false, photoset: [], idx2hash: [] });
    expect(el.querySelector('[data-testid="filter-button"]')).not.toBeNull();
    expect(mounts).toBe(1);
  });

  // A shared album is read-only for its recipient, yet "Leave album" lives in its toolbar (#2210).
  it("shows headerActions on a read-only view, without the list's own controls", async () => {
    const display = `[aria-label="${i18n.t("photodisplay.settings")}"]`;
    const mediaFilter = '[data-testid="media-filter"]';
    const props = { mediaType: "all", headerActions: <span data-testid="leave-menu" /> } as const;
    // The owner's view: the list's controls next to the actions
    const own = await render({ ...props, isPublic: false });
    expect(own.querySelector(display)).not.toBeNull();
    expect(own.querySelector(mediaFilter)).not.toBeNull();

    const shared = await render({ ...props, isPublic: true });

    expect(shared.querySelector('[data-testid="leave-menu"]')).not.toBeNull();
    expect(shared.querySelector(display)).toBeNull();
    expect(shared.querySelector(mediaFilter)).toBeNull();
  });

  it("hands the title badge to the header", async () => {
    const el = await render({ title: "Lisbon 2026", titleBadge: <span data-testid="badge">Locked</span> });

    expect(el.querySelector('h1 [data-testid="badge"]')).not.toBeNull();
  });
});

const selectionToolbar = () =>
  document.body.querySelector(`[role="toolbar"][aria-label="${i18n.t("selectionbar.toolbar")}"]`);

function selectButton(): HTMLButtonElement {
  const found = Array.from(document.body.querySelectorAll("button")).find(
    el => el.textContent?.trim() === i18n.t("selectionbar.selectmode")
  );
  return defined(found, "the Select button");
}

function doneButton(): HTMLButtonElement {
  return defined(
    document.body.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t("selectionbar.done")}"]`),
    "the ✕"
  );
}

const pressEscape = (target: Element = document.body) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });

describe("PhotoListView selection bar on demand (#2240)", () => {
  it("shows no selection bar while browsing, only the Select button", async () => {
    await render({});

    expect(selectionToolbar()).toBeNull();
    expect(selectButton().getAttribute("aria-pressed")).toBe("false");
  });

  it("brings the bar up from Select, with focus on its ✕, and puts it away from the ✕", async () => {
    await render({});

    await act(async () => selectButton().click());
    expect(selectionToolbar()).not.toBeNull();
    expect(selectionBar.props?.selectMode).toBe(true);
    expect(document.activeElement).toBe(doneButton());

    await act(async () => doneButton().click());
    expect(selectionToolbar()).toBeNull();
    // Focus does not drop to the top of the page with the bar
    expect(document.activeElement).toBe(selectButton());
  });

  it("puts the bar away on Select again and on Escape", async () => {
    await render({});
    await act(async () => selectButton().click());
    await act(async () => selectButton().click());
    expect(selectionToolbar()).toBeNull();

    await act(async () => selectButton().click());
    await pressEscape();
    expect(selectionToolbar()).toBeNull();
  });

  it("leaves Escape to an open menu or dialog", async () => {
    await render({});
    await act(async () => selectButton().click());
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);

    await pressEscape(dialog);

    expect(selectionToolbar()).not.toBeNull();
    dialog.remove();
  });

  it("shows the bar when a tile is ticked and clears it with the selection", async () => {
    await render({});

    await act(async () => defined(lastPigProps().handleSelection)(defined(items[0])));
    expect(selectionToolbar()).not.toBeNull();
    expect(selectionBar.props?.selectedItems.map(item => item.id)).toEqual(["a"]);

    await act(async () => doneButton().click());
    expect(selectionToolbar()).toBeNull();
    expect(lastPigProps().selectedItems).toEqual([]);

    // Unticking the last photo also ends selecting
    await act(async () => defined(lastPigProps().handleSelection)(defined(items[0])));
    await act(async () => defined(lastPigProps().handleSelection)(defined(items[0])));
    expect(selectionToolbar()).toBeNull();
  });

  it("offers no Select button on a list that cannot be selected from", async () => {
    const view = await render({ selectable: false });

    expect(view.textContent).not.toContain(i18n.t("selectionbar.selectmode"));
  });
});

describe("PhotoListView selection", () => {
  // Select all, change the timeline filter, then delete: the carried-over
  // select-all query would act on the old filter (issue #2130).
  it("clears a select-all when the photoset query changes", async () => {
    await render({ photosetQuery: { hide_screenshots: true } });
    await act(async () => selectButton().click());
    await act(async () => {
      defined(selectionBar.props).updateSelectionState({
        selectMode: true,
        selectAllMode: true,
        selectAllQuery: { hide_screenshots: true },
      });
    });
    expect(selectionBar.props?.selectAllMode).toBe(true);

    // An equal query passed as a fresh literal keeps the selection.
    await render({ photosetQuery: { hide_screenshots: true } });
    expect(selectionBar.props?.selectAllMode).toBe(true);

    await render({ photosetQuery: {} });
    // Nothing is selected any more, so the bar is gone with the select all
    expect(selectionToolbar()).toBeNull();
    expect(lastPigProps().selectedItems).toEqual([]);
  });
});

describe("a failed photo list (#2221)", () => {
  const emptyStateConfig = { title: "No photos yet", description: "Scan your library" };
  const failure = { onRetry: vi.fn<() => void>(), retrying: false };

  it("shows the error with Retry instead of the empty state", async () => {
    const view = await render({ photoset: [], idx2hash: [], emptyStateConfig, error: failure });

    expect(view.textContent).not.toContain("No photos yet");
    expect(view.textContent).toContain(i18n.t("errorstate.title"));
    const retry = [...view.querySelectorAll("button")].find(b => b.textContent === i18n.t("errorstate.retry"));
    await act(async () => defined(retry).click());
    expect(failure.onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps the grid when photos are on screen", async () => {
    const view = await render({ emptyStateConfig, error: failure });

    expect(view.querySelector("[data-testid=pig]")).not.toBeNull();
    expect(view.textContent).not.toContain(i18n.t("errorstate.title"));
  });
});

describe("PhotoListView lightbox in the address (#2231)", () => {
  const isLightboxOpen = () => container?.querySelector('[data-testid="lightbox"]') !== null;
  const lastLightbox = () => defined(lightbox.props.at(-1), "the lightbox");
  const photoParam = () => searchOf(theRouter()).get("photo");
  const historyLength = () => theRouter().history.length;

  async function openFromGrid(item: PigPhoto) {
    const event = click();
    await act(async () => defined(lastPigProps().handleClick)(event, item));
    await settle(theRouter());
  }
  async function step(run: () => void) {
    await act(async () => run());
    await settle(theRouter());
  }

  it("opens a photo as a new history entry on the same page", async () => {
    await render({});
    await openFromGrid(defined(items[1]));

    expect(theRouter().state.location.pathname).toBe("/photos");
    expect(photoParam()).toBe("b");
    expect(historyLength()).toBe(2);
    expect(lastLightbox()).toMatchObject({ selectedImage: "b" });
  });

  it("closes on Back and stays on the grid", async () => {
    await render({});
    await openFromGrid(defined(items[1]));

    await step(() => theRouter().history.back());

    expect(isLightboxOpen()).toBe(false);
    expect(photoParam()).toBeNull();
    expect(theRouter().state.location.pathname).toBe("/photos");
  });

  it("closes by going back to the grid's entry, leaving no entry behind", async () => {
    await render({});
    await openFromGrid(defined(items[1]));

    await step(() => lastLightbox().onCloseRequest());

    expect(isLightboxOpen()).toBe(false);
    expect(photoParam()).toBeNull();
    expect(theRouter().history.canGoBack()).toBe(false);
  });

  it("steps to another photo in place, so Back still closes the lightbox", async () => {
    await render({});
    await openFromGrid(defined(items[1]));

    await step(() => defined(lastLightbox().onImageChange)("a"));

    expect(photoParam()).toBe("a");
    expect(historyLength()).toBe(2);
    expect(lastLightbox()).toMatchObject({ selectedImage: "a" });

    await step(() => theRouter().history.back());
    expect(isLightboxOpen()).toBe(false);
  });

  it("keeps the page's other params, and leaves them when it closes", async () => {
    await render({}, "/photos?media=videos");
    await openFromGrid(defined(items[0]));
    expect(searchOf(theRouter()).get("media")).toBe("videos");

    await step(() => lastLightbox().onCloseRequest());

    expect(searchOf(theRouter()).get("media")).toBe("videos");
    expect(photoParam()).toBeNull();
  });

  it("opens the photo a link names once the list has loaded, and closes it in place", async () => {
    await render({ loading: true, photoset: [], idx2hash: [] }, "/photos?photo=b");
    expect(isLightboxOpen()).toBe(false);

    await render({});
    expect(lastLightbox()).toMatchObject({ selectedImage: "b" });
    expect(details.asked).toEqual([]);

    // Nothing behind a linked photo to go back to: the param goes, the entry stays the page's.
    await step(() => lastLightbox().onCloseRequest());
    expect(isLightboxOpen()).toBe(false);
    expect(photoParam()).toBeNull();
    expect(historyLength()).toBe(1);
  });

  it("shows a linked photo the list does not hold on its own, once its details confirm it", async () => {
    details.result = { data: makePhoto({ image_hash: "hz", video: true }), isError: false };
    await render({}, "/photos?photo=z");

    expect(details.asked).toContain("z");
    expect(lastLightbox()).toMatchObject({
      selectedImage: "z",
      idx2hash: [{ id: "z", image_hash: "hz", type: "video" }],
    });
  });

  it("shows the grid for a linked photo that cannot be shown", async () => {
    details.result = { data: undefined, isError: true };
    await render({}, "/photos?photo=gone");

    expect(isLightboxOpen()).toBe(false);
    expect(photoParam()).toBeNull();
    expect(container?.querySelector('[data-testid="pig"]')).not.toBeNull();
  });

  it("opens a public page's link to a photo of the list", async () => {
    await render({ isPublic: true }, "/photos?photo=a");

    expect(lastLightbox()).toMatchObject({ selectedImage: "a", isPublic: true });
  });

  it("drops a public page's link to a photo the list does not hold: there are no details to check", async () => {
    await render({ isPublic: true }, "/photos?photo=z");

    expect(isLightboxOpen()).toBe(false);
    expect(photoParam()).toBeNull();
    expect(details.asked).toEqual([]);
  });

  it("keeps the grid and the selection as they are: the open photo is not part of the list", async () => {
    await render({});
    await act(async () => defined(lastPigProps().handleSelection)(defined(items[0])));
    const before = lastPigProps();

    // As Forward onto an entry the lightbox pushed would.
    await step(() => void theRouter().navigate({ to: "/photos", search: { photo: "b" } }));

    expect(lastLightbox()).toMatchObject({ selectedImage: "b" });
    expect(lastPigProps().imageData).toBe(before.imageData);
    expect((lastPigProps().selectedItems ?? []).map(item => item.id)).toEqual(["a"]);
  });

  it("starts a slideshow in place, and its close drops the photo too", async () => {
    const onSlideshowClose = vi.fn<() => void>();
    await render({ isPublic: true, slideshow: true, onSlideshowClose });
    expect(photoParam()).toBe("a");
    expect(historyLength()).toBe(1);

    await step(() => lastLightbox().onCloseRequest());

    expect(photoParam()).toBeNull();
    expect(onSlideshowClose).toHaveBeenCalledTimes(1);
  });
});
