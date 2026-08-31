import { describe, expect, test } from "vitest";
import { Memory, MemoryType } from "../../api_client/memories";
import { memoriesAreCapped, memoriesPhotoCount, memoriesToFlatItems, memoriesToPhotoGroups } from "./memoryPhotoset";

function photo(id: string) {
  return { id, image_hash: `hash-${id}`, aspectRatio: 1 } as any;
}

function memory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "years_ago-2024",
    type: MemoryType.YEARS_AGO,
    years_ago: 2,
    year: 2024,
    date: "2024-08-24",
    start_date: "2024-08-24",
    end_date: "2024-08-24",
    location: "",
    numberOfItems: 1,
    cover: photo("a"),
    items: [photo("a")],
    ...overrides,
  } as Memory;
}

describe("memoriesToPhotoGroups", () => {
  test("makes one timeline group per memory, in memory order", () => {
    const groups = memoriesToPhotoGroups([
      memory({ id: "years_ago-2024", date: "2024-08-24" }),
      memory({ id: "years_ago-2021", date: "2021-08-25", location: "Rome, Italy" }),
    ]);

    expect(groups.map(group => group.id)).toEqual(["years_ago-2024", "years_ago-2021"]);
    expect(groups[1].date).toBe("2021-08-25");
    expect(groups[1].location).toBe("Rome, Italy");
    expect(groups.every(group => group.incomplete === false)).toBe(true);
  });

  test("counts a group by the photos it carries, not by the memory's size", () => {
    // A group that claims more than it holds makes the grid reserve space for
    // photos that were never sent.
    const [group] = memoriesToPhotoGroups([memory({ numberOfItems: 400, items: [photo("a"), photo("b")] })]);
    expect(group.numberOfItems).toBe(2);
    expect(group.items).toHaveLength(2);
  });
});

describe("memoriesToFlatItems", () => {
  test("concatenates every memory's photos in order -- what play all plays", () => {
    const items = memoriesToFlatItems([
      memory({ items: [photo("a"), photo("b")] }),
      memory({ id: "years_ago-2021", items: [photo("c")] }),
    ]);
    expect(items.map(item => item.id)).toEqual(["a", "b", "c"]);
  });

  test("is empty when there is nothing to remember", () => {
    expect(memoriesToFlatItems([])).toEqual([]);
  });
});

describe("memoriesPhotoCount", () => {
  test("adds up what the day holds, not what was sent", () => {
    const memories = [memory({ numberOfItems: 400, items: [photo("a")] }), memory({ numberOfItems: 2 })];
    expect(memoriesPhotoCount(memories)).toBe(402);
  });
});

describe("memoriesAreCapped", () => {
  test("spots a memory that came back short", () => {
    expect(memoriesAreCapped([memory({ numberOfItems: 400, items: [photo("a")] })])).toBe(true);
  });

  test("stays quiet when every photo was sent", () => {
    expect(memoriesAreCapped([memory(), memory({ id: "years_ago-2021" })])).toBe(false);
  });
});
