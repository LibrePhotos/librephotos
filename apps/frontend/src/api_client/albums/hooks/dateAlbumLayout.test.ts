import { describe, expect, it } from "vitest";
import { applyDayLayout, needsDayLayout } from "./dateAlbumLayout";

const temp = (id: string) => ({ id, isTemp: true, aspectRatio: 1 });
const photo = (id: string, aspectRatio: number) => ({ id, aspectRatio });

describe("applyDayLayout", () => {
  it("shapes the placeholders and leaves loaded photos alone", () => {
    const items = [photo("a", 0.75), temp("1"), temp("2"), temp("3")];
    const shaped = applyDayLayout(items, [1.5, 1.5, 0.75, 2.4]);
    expect(shaped?.map(item => item.aspectRatio)).toEqual([0.75, 1.5, 0.75, 2.4]);
    expect(shaped?.[0]).toBe(items[0]);
    expect(items[1]?.aspectRatio).toBe(1);
  });

  it("keeps placeholders square where the layout has no ratio, or ends early", () => {
    const shaped = applyDayLayout([temp("0"), temp("1"), temp("2")], [null, 1.5]);
    expect(shaped?.map(item => item.aspectRatio)).toEqual([1, 1.5, 1]);
  });

  it("returns null when nothing changes, so the list is not copied", () => {
    expect(applyDayLayout([temp("0"), photo("b", 1.5)], [1, 2])).toBeNull();
  });
});

describe("needsDayLayout", () => {
  it("is only for days of more than one page", () => {
    expect(needsDayLayout(100)).toBe(false);
    expect(needsDayLayout(101)).toBe(true);
  });
});
