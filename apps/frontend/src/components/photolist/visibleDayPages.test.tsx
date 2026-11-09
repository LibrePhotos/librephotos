/**
 * The day pages a photo list has placeholders of on screen: every page of every day, top first, so
 * they load together; and none of a list read under other filters.
 */
import type { PigPhoto } from "@librephotos/api-client";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { tempPigPhoto } from "../../util/util";
import type { PigVisibleGroup } from "./PhotoListView";
import { dayPagesOnScreen, useDayPagesOnScreen, type DayPage } from "./visibleDayPages";

const loaded = (id: string): PigPhoto => ({ ...tempPigPhoto(id), image_hash: `hash-${id}`, isTemp: false });
const day = (id: number, items: PigPhoto[]): PigVisibleGroup<PigPhoto> => ({ id, date: null, items });

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

describe("dayPagesOnScreen", () => {
  it("names the page of every day with a placeholder on screen, top first", () => {
    const pages = dayPagesOnScreen([
      day(20251018, [tempPigPhoto("0"), tempPigPhoto("1")]),
      day(20251017, [loaded("0")]),
      day(20251016, [tempPigPhoto("0")]),
    ]);
    expect(pages).toEqual([
      { day: 20251018, page: 1 },
      { day: 20251016, page: 1 },
    ]);
  });

  it("names each page of a big day once, from the placeholders' place in the day", () => {
    const items = [loaded("98"), loaded("99"), tempPigPhoto("100"), tempPigPhoto("199"), tempPigPhoto("200")];
    expect(dayPagesOnScreen([day(1, items)])).toEqual([
      { day: 1, page: 2 },
      { day: 1, page: 3 },
    ]);
  });
});

describe("useDayPagesOnScreen", () => {
  it("forgets the pages of a list read under other filters", async () => {
    let seen: DayPage[] = [];
    let report: (groups: PigVisibleGroup<PigPhoto>[]) => void = () => {};
    function List({ scope }: { scope: string }) {
      const { pages, updateGroups } = useDayPagesOnScreen(scope);
      seen = pages;
      report = updateGroups;
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<List scope="all" />));
    await act(async () => report([day(5, [tempPigPhoto("0")])]));
    expect(seen).toEqual([{ day: 5, page: 1 }]);

    await act(async () => root.render(<List scope="videos" />));
    expect(seen).toEqual([]);
    await act(async () => root.unmount());
  });
});
