/**
 * The helpers that replaced lodash-es, at the inputs their callers give them. The deburr and
 * escapeRegExp tables (helpers.lodash.fixture.json) were captured from lodash-es 4.17 before it was
 * removed: every character from U+00A0 to U+024F and some names.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { alphabetMarkerLetter } from "../components/scrollscrubber/alphabetMarker";
import {
  chunk,
  debounce,
  deburr,
  escapeRegExp,
  groupEntries,
  orderBy,
  plainDataEqual,
  throttle,
  uniqBy,
} from "./helpers";
import lodash from "./helpers.lodash.fixture.json";

describe("groupEntries", () => {
  it("lists user-id groups in ascending id order, as toPairs(groupBy()) did, each in its items' order", () => {
    const shares = [
      { user_id: 12, photo: "a" },
      { user_id: 3, photo: "b" },
      { user_id: 12, photo: "c" },
      { user_id: 7, photo: "d" },
    ];
    expect(groupEntries(shares, share => share.user_id)).toEqual([
      ["3", [{ user_id: 3, photo: "b" }]],
      ["7", [{ user_id: 7, photo: "d" }]],
      [
        "12",
        [
          { user_id: 12, photo: "a" },
          { user_id: 12, photo: "c" },
        ],
      ],
    ]);
  });

  it("lists other keys (days) in order of first appearance, after any index keys", () => {
    const keys = ["2024-03-12", "2024-03-10", "2024-03-12", "undefined", "5", "2024-03-11"];
    expect(groupEntries(keys, key => key).map(([key, items]) => [key, items.length])).toEqual([
      ["5", 1],
      ["2024-03-12", 2],
      ["2024-03-10", 1],
      ["undefined", 1],
      ["2024-03-11", 1],
    ]);
  });

  it("names a missing owner 'undefined', as lodash's path lookup did", () => {
    const photos = [{ owner: { id: 2 } }, { owner: undefined }];
    expect(groupEntries(photos, photo => photo.owner?.id).map(([key]) => key)).toEqual(["2", "undefined"]);
  });

  it("is not fooled by keys an object would treat specially", () => {
    expect(groupEntries(["__proto__", "constructor"], key => key).map(([key]) => key)).toEqual([
      "__proto__",
      "constructor",
    ]);
  });
});

describe("chunk", () => {
  it("cuts into runs of the size, the last one shorter", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([1, 2], 6)).toEqual([[1, 2]]);
    expect(chunk([], 2)).toEqual([]);
    expect(chunk([1], 0)).toEqual([]);
  });
});

describe("uniqBy", () => {
  it("keeps the first of each key, in order", () => {
    const faces = [
      { face_id: 1, from: "selected" },
      { face_id: 2, from: "selected" },
      { face_id: 1, from: "loaded" },
      { face_id: 3, from: "loaded" },
    ];
    expect(uniqBy(faces, face => face.face_id)).toEqual([
      { face_id: 1, from: "selected" },
      { face_id: 2, from: "selected" },
      { face_id: 3, from: "loaded" },
    ]);
  });
});

describe("orderBy", () => {
  it("sorts people by name (by code unit, as lodash did), then most faces first", () => {
    const people = [
      { name: "anna", face_count: 1 },
      { name: "Zoe", face_count: 2 },
      { name: "Anna", face_count: 5 },
      { name: "Anna", face_count: 9 },
      { name: "Émile", face_count: 1 },
    ];
    expect(
      orderBy(people, [
        [person => person.name, "asc"],
        [person => person.face_count, "desc"],
      ]).map(person => `${person.name}/${person.face_count}`)
    ).toEqual(["Anna/9", "Anna/5", "Zoe/2", "anna/1", "Émile/1"]);
  });

  it("is stable, and puts a photo without a time after the others", () => {
    const photos = [
      { id: "a", exif_timestamp: "2024-03-12T10:00:00Z" },
      { id: "b", exif_timestamp: null },
      { id: "c", exif_timestamp: "2024-03-10T09:00:00Z" },
      { id: "d", exif_timestamp: "2024-03-12T10:00:00Z" },
      { id: "e", exif_timestamp: undefined },
      { id: "f", exif_timestamp: null },
    ];
    expect(orderBy(photos, [[photo => photo.exif_timestamp, "asc"]]).map(photo => photo.id)).toEqual([
      "c",
      "a",
      "d",
      "b",
      "f",
      "e",
    ]);
  });

  it("orders numbers by value, NaN last ascending and first descending, as lodash did", () => {
    const values = [3, Number.NaN, 10, null, 2, undefined];
    expect(orderBy(values, [[value => value, "asc"]])).toEqual([2, 3, 10, null, undefined, Number.NaN]);
    expect(orderBy(values, [[value => value, "desc"]])).toEqual([Number.NaN, undefined, null, 10, 3, 2]);
  });

  it("leaves its input alone", () => {
    const input = [2, 1];
    orderBy(input, [[value => value, "asc"]]);
    expect(input).toEqual([2, 1]);
  });
});

describe("plainDataEqual", () => {
  const user = {
    id: 1,
    username: "admin",
    image_scale: 1,
    groups: [{ id: 2, name: "family" }],
    nextcloud: null,
    favorite_min_rating: 4,
  };

  it("compares API data deeply, whatever the key order", () => {
    expect(plainDataEqual(user, { ...user, groups: [{ name: "family", id: 2 }] })).toBe(true);
    expect(plainDataEqual(user, { ...user, groups: [{ id: 3, name: "family" }] })).toBe(false);
    expect(plainDataEqual(user, { ...user, nextcloud: undefined })).toBe(false);
    expect(plainDataEqual(user, undefined)).toBe(false);
    expect(plainDataEqual(undefined, undefined)).toBe(true);
  });

  it("tells a missing key from one set to undefined, as lodash's isEqual did", () => {
    expect(plainDataEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });

  it("compares the auto-scan days in order", () => {
    expect(plainDataEqual([1, 3, 5], [1, 3, 5])).toBe(true);
    expect(plainDataEqual([1, 3, 5], [5, 3, 1])).toBe(false);
    expect(plainDataEqual([1, 3], [1, 3, 5])).toBe(false);
  });

  it("takes NaN as equal to itself, and an array as different from an object", () => {
    expect(plainDataEqual(Number.NaN, Number.NaN)).toBe(true);
    expect(plainDataEqual([], {})).toBe(false);
    expect(plainDataEqual({ allow_upload: true }, { allow_upload: "true" })).toBe(false);
  });
});

describe("escapeRegExp", () => {
  it.each(lodash.escapeRegExp)("escapes %j as lodash did", (input, escaped) => {
    expect(escapeRegExp(input)).toBe(escaped);
  });
});

describe("deburr", () => {
  it("maps every character from U+00A0 to U+024F, and some names, as lodash did", () => {
    const mismatches = Object.entries(lodash.deburr).filter(([input, output]) => deburr(input) !== output);
    expect(mismatches).toEqual([]);
  });

  it.each([
    ["Ærøskøbing", "AE"],
    ["ßeta", "SS"],
    ["Łódź", "L"],
    ["øre", "O"],
    ["Đặng", "D"],
    ["Émile", "E"],
    ["9 to 5", "#"],
    ["😀", ":-)"],
  ])("files %s under %s in the alphabet scrubber", (label, letter) => {
    expect(alphabetMarkerLetter(label)).toBe(letter);
  });
});

describe("debounce and throttle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounce calls once, after the last call's wait, with its arguments", () => {
    const fn = vi.fn<(value: number) => void>();
    const debounced = debounce(fn, 300);
    debounced(1);
    vi.advanceTimersByTime(200);
    debounced(2);
    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("debounce's cancel drops the pending call", () => {
    const fn = vi.fn<() => void>();
    const debounced = debounce(fn, 300);
    debounced();
    debounced.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });

  it("throttle calls at once, then at most once a wait, the last time with the latest arguments", () => {
    const fn = vi.fn<(value: number) => void>();
    const throttled = throttle(fn, 500);
    throttled(1);
    expect(fn.mock.calls).toEqual([[1]]);
    vi.advanceTimersByTime(100);
    throttled(2);
    vi.advanceTimersByTime(100);
    throttled(3);
    expect(fn.mock.calls).toEqual([[1]]);
    vi.advanceTimersByTime(300);
    expect(fn.mock.calls).toEqual([[1], [3]]);
    // The trailing call started a new wait
    throttled(4);
    vi.advanceTimersByTime(499);
    expect(fn.mock.calls).toEqual([[1], [3]]);
    vi.advanceTimersByTime(1);
    expect(fn.mock.calls).toEqual([[1], [3], [4]]);
    // Quiet for longer than the wait: the next call runs at once again
    vi.advanceTimersByTime(2000);
    throttled(5);
    expect(fn.mock.calls.at(-1)).toEqual([5]);
  });

  it("throttle times a later trailing call from the first call after the last one, as lodash does", () => {
    // A sequence a scroll produces: the trailing call after a pause comes a wait after the first new
    // call (1104), not a wait after the previous call ran (1000).
    const fn = vi.fn<(value: number) => void>();
    const throttled = throttle(fn, 500);
    const at: number[] = [];
    fn.mockImplementation(() => at.push(Date.now() - start));
    const start = Date.now();
    for (const [time, value] of [
      [0, 0],
      [301, 1],
      [320, 2],
      [604, 3],
      [645, 4],
      [825, 5],
    ] as const) {
      vi.advanceTimersByTime(time - (Date.now() - start));
      throttled(value);
    }
    vi.advanceTimersByTime(2000);
    expect(fn.mock.calls).toEqual([[0], [2], [5]]);
    expect(at).toEqual([0, 500, 1104]);
  });

  it("throttle's cancel drops the trailing call and lets the next run at once", () => {
    const fn = vi.fn<(value: number) => void>();
    const throttled = throttle(fn, 500);
    throttled(1);
    throttled(2);
    throttled.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn.mock.calls).toEqual([[1]]);
    throttled(3);
    expect(fn.mock.calls).toEqual([[1], [3]]);
  });
});
