/**
 * The editor of a place being drawn (#1365): a name the user has for no other place, the size,
 * the icon and the title switch, the live count, and the save with the circle from the map.
 */
import type { UserPlace, UserPlaceFields, UserPlacePreview } from "@librephotos/api-client";
import { act } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api_client/apiError";
import i18n from "../../i18n";
import { PlaceEditorPanel } from "./PlaceEditorPanel";
import { renderPlaces } from "./renderPlaces.test-utils";
import type { PlaceEditorState } from "./usePlaceEditor";

type SaveParams = { id?: number; fields: UserPlaceFields };
type SaveOptions = { onSuccess?: () => void; onError?: (error: Error) => void };

type Stubs = { preview: UserPlacePreview | undefined; saveError: Error | null; saved: SaveParams[] };

const stubs = vi.hoisted((): Stubs => ({ preview: undefined, saveError: null, saved: [] }));

vi.mock("../../api_client/albums/hooks", () => ({
  useUserPlacePreviewQuery: () => ({ data: stubs.preview, isFetching: false, isError: false }),
  useSaveUserPlaceMutation: () => ({
    isPending: false,
    mutate: (params: SaveParams, options: SaveOptions) => {
      stubs.saved.push(params);
      if (stubs.saveError) options.onError?.(stubs.saveError);
      else options.onSuccess?.();
    },
  }),
}));
vi.mock("../../api_client/urls", () => ({ serverAddress: "" }));

const work: UserPlace = {
  id: 9,
  name: "Work",
  icon: "work",
  center_lat: 48.2,
  center_lon: 11.6,
  radius_m: 300,
  use_in_titles: true,
  photo_count: 0,
  cover_photos: [],
};

const NEW: PlaceEditorState = {
  center: { lat: 48.1, lon: 11.5 },
  radiusM: 150,
  name: "",
  icon: "home",
  useInTitles: true,
};

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  stubs.preview = undefined;
  stubs.saveError = null;
  stubs.saved = [];
});

async function renderPanel(editor: PlaceEditorState = NEW) {
  const onClose = vi.fn<() => void>();
  const onRadiusChange = vi.fn<(radius: number) => void>();
  const page = await renderPlaces(
    <PlaceEditorPanel editor={editor} places={[work]} onRadiusChange={onRadiusChange} onClose={onClose} floating />
  );
  const name = page.container.querySelector<HTMLInputElement>('input[data-path="name"]');
  async function typeName(value: string) {
    await act(async () => {
      if (!name) throw new Error("no name field");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(name, value);
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function submit() {
    await act(async () => {
      page.container.querySelector("form")?.requestSubmit();
    });
  }
  return { ...page, onClose, onRadiusChange, typeName, submit };
}

describe("PlaceEditorPanel", () => {
  it("asks for a centre first, and does not save without one", async () => {
    const panel = await renderPanel({ ...NEW, center: null });
    expect(panel.text()).toContain(i18n.t("yourplaces.editor.hint"));
    await panel.typeName("Home");
    await panel.submit();
    expect(stubs.saved).toEqual([]);
    await panel.unmount();
  });

  it("saves a new place with the circle from the map", async () => {
    stubs.preview = { photo_count: 3, cover_photos: [], overlaps: [] };
    const panel = await renderPanel();
    expect(panel.text()).toContain("3 photos were taken inside");
    await panel.typeName("  Home ");
    await panel.submit();
    expect(stubs.saved).toEqual([
      {
        id: undefined,
        fields: {
          name: "Home",
          icon: "home",
          use_in_titles: true,
          center_lat: 48.1,
          center_lon: 11.5,
          radius_m: 150,
        },
      },
    ]);
    expect(panel.onClose).toHaveBeenCalled();
    await panel.unmount();
  });

  it("refuses a name the user has for another place, in any case", async () => {
    const panel = await renderPanel();
    await panel.typeName("work");
    await panel.submit();
    expect(stubs.saved).toEqual([]);
    expect(panel.text()).toContain("You already have a place called work");
    await panel.unmount();
  });

  it("keeps an edited place's own name, and shows why the server refused", async () => {
    stubs.saveError = new ApiError("refused", 400, "You can have at most 100 places.");
    const panel = await renderPanel({ ...NEW, id: 9, name: "Work", icon: "work" });
    expect(panel.text()).toContain(i18n.t("yourplaces.editor.editTitle"));
    await panel.submit();
    expect(stubs.saved[0]?.id).toBe(9);
    expect(panel.text()).toContain("You can have at most 100 places.");
    expect(panel.onClose).not.toHaveBeenCalled();
    await panel.unmount();
  });

  it("closes on Cancel", async () => {
    const panel = await renderPanel();
    await panel.click(panel.button(i18n.t("cancel")));
    expect(panel.onClose).toHaveBeenCalled();
    await panel.unmount();
  });
});
