/**
 * The few general helpers the web app needs that the platform does not have for every browser in
 * `browserslist` (Chrome 109 and iOS Safari 16.6 have neither `Object.groupBy` nor `toSorted`).
 * They replaced lodash-es and keep its behaviour where a caller depends on it (helpers.test.ts).
 * Lint bans lodash and lodash-es and points here.
 */

// ---------------------------------------------------------------------------------------------------
// Collections

/** An array index as a property key ("0", "42"): JavaScript lists such keys first, in numeric order. */
const ARRAY_INDEX = /^(0|[1-9]\d*)$/;
const isArrayIndex = (key: string) => ARRAY_INDEX.test(key) && Number(key) < 2 ** 32 - 1;

/**
 * Groups `items` by the string form of `keyOf(item)`, as `[key, items]` pairs in the order lodash's
 * `toPairs(groupBy(...))` gave them, which is an object's key order: keys that are array indices
 * (user ids, say) first in ascending numeric order, then the others in order of first appearance.
 * Each group keeps its items' order.
 */
export function groupEntries<T>(items: readonly T[], keyOf: (item: T) => unknown): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = String(keyOf(item));
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  const entries = [...groups.entries()];
  const indices = entries.filter(([key]) => isArrayIndex(key)).sort(([a], [b]) => Number(a) - Number(b));
  return [...indices, ...entries.filter(([key]) => !isArrayIndex(key))];
}

/** `items` in runs of `size` (the last one shorter). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const runs: T[][] = [];
  if (size < 1) return runs;
  for (let start = 0; start < items.length; start += size) runs.push(items.slice(start, start + size));
  return runs;
}

/** `items` without repeats of `keyOf`, each kept where it first appears. */
export function uniqBy<T>(items: readonly T[], keyOf: (item: T) => unknown): T[] {
  const seen = new Set<unknown>();
  return items.filter(item => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type SortValue = string | number | null | undefined;

/**
 * lodash's ascending order for one sort key: values compared with `<` (strings by code unit, not
 * by locale), then null, then undefined, then NaN.
 */
function compareAscending(a: SortValue, b: SortValue): number {
  const rank = (value: SortValue) => {
    if (value === undefined) return 2;
    if (value === null) return 1;
    if (typeof value === "number" && Number.isNaN(value)) return 3;
    return 0;
  };
  const ranks = rank(a) - rank(b);
  if (ranks !== 0 || rank(a) !== 0) return ranks;
  if (a === b) return 0;
  // Both are plain values of rank 0: strings or numbers, compared as lodash does.
  return (a ?? 0) > (b ?? 0) ? 1 : (a ?? 0) < (b ?? 0) ? -1 : 0;
}

/** One key of an `orderBy`: what to sort by, and which way. */
export type SortKey<T> = Readonly<[keyOf: (item: T) => SortValue, direction: "asc" | "desc"]>;

/**
 * A sorted copy of `items` by `keys`, the first key first: lodash's `orderBy`. Stable, so items that
 * compare equal keep their order. Ascending puts null, undefined and NaN last; descending reverses
 * the whole comparison, so they come first.
 */
export function orderBy<T>(items: readonly T[], keys: readonly SortKey<T>[]): T[] {
  const sorted = items.map((item, index) => ({ item, index, values: keys.map(([keyOf]) => keyOf(item)) }));
  sorted.sort((a, b) => {
    for (const [i, [, direction]] of keys.entries()) {
      const order = compareAscending(a.values[i], b.values[i]);
      if (order !== 0) return direction === "desc" ? -order : order;
    }
    return a.index - b.index;
  });
  return sorted.map(entry => entry.item);
}

// ---------------------------------------------------------------------------------------------------
// Equality

/**
 * Whether two values of plain data are equal: the same primitives (NaN equal to NaN), or arrays and
 * plain objects with the same keys and equal values, however deep. Enough for what the settings
 * drafts compare (parsed API responses and the forms built from them); not for Dates, Maps, Sets or
 * cyclic values, which none of them holds.
 */
export function plainDataEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return Number.isNaN(a) && Number.isNaN(b);
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => plainDataEqual(value, b[index]));
  }
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(key => Object.hasOwn(b, key) && plainDataEqual(Reflect.get(a, key), Reflect.get(b, key)));
}

// ---------------------------------------------------------------------------------------------------
// Text

/** The characters a regular expression gives a meaning to: lodash's set. */
const REGEXP_CHARS = /[\\^$.*+?()[\]{}|]/g;

/** `text` with every character a regular expression gives a meaning to escaped. */
export const escapeRegExp = (text: string) => text.replace(REGEXP_CHARS, "\\$&");

/** The Latin-1 Supplement and Latin Extended-A letters lodash's deburr maps (not × and ÷). */
const LATIN_LETTERS = /[\xc0-\xd6\xd8-\xf6\xf8-\xffĀ-ſ]/g;
/** Combining marks: diacritical marks, half marks and marks for symbols. */
const COMBINING_MARKS = /[̀-ͯ︠-︯⃐-⃿]/g;
/** The letters of those blocks that have no decomposition into a base letter and marks. */
const WITHOUT_DECOMPOSITION: Readonly<Record<string, string>> = {
  Æ: "Ae",
  æ: "ae",
  Ð: "D",
  ð: "d",
  Ø: "O",
  ø: "o",
  Þ: "Th",
  þ: "th",
  ß: "ss",
  Đ: "D",
  đ: "d",
  Ħ: "H",
  ħ: "h",
  ı: "i",
  Ĳ: "IJ",
  ĳ: "ij",
  ĸ: "k",
  Ŀ: "L",
  ŀ: "l",
  Ł: "L",
  ł: "l",
  ŉ: "'n",
  Ŋ: "N",
  ŋ: "n",
  Œ: "Oe",
  œ: "oe",
  Ŧ: "T",
  ŧ: "t",
  ſ: "s",
};

/**
 * `text` with the Latin-1 Supplement and Latin Extended-A letters turned into basic Latin ones
 * ("é" → "e", "ß" → "ss", "Ł" → "L") and combining marks removed: lodash's deburr, character for
 * character. Letters of other blocks ("ạ", U+1EA1) stay as they are, as they did.
 */
export function deburr(text: string): string {
  return text
    .replace(LATIN_LETTERS, letter => WITHOUT_DECOMPOSITION[letter] ?? letter.normalize("NFD"))
    .replace(COMBINING_MARKS, "");
}

// ---------------------------------------------------------------------------------------------------
// Timing

type Cancellable<A extends unknown[]> = ((...args: A) => void) & { cancel: () => void };

/**
 * lodash's debounce machinery, with the two configurations the app uses: trailing only (debounce),
 * and leading and trailing with a maximum wait of `wait` (throttle). Kept to lodash's algorithm, not
 * a simpler one, because when a trailing call fires decides how a scroll or a search feels.
 */
function timed<A extends unknown[]>(fn: (...args: A) => void, wait: number, leading: boolean, maxWait?: number) {
  let lastArgs: A | undefined;
  let lastCallTime: number | undefined;
  let lastInvokeTime = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const invoke = (time: number) => {
    const args = lastArgs;
    lastArgs = undefined;
    lastInvokeTime = time;
    if (args) fn(...args);
  };
  const shouldInvoke = (time: number) => {
    if (lastCallTime === undefined) return true;
    const sinceCall = time - lastCallTime;
    return sinceCall >= wait || sinceCall < 0 || (maxWait !== undefined && time - lastInvokeTime >= maxWait);
  };
  const remainingWait = (time: number) => {
    const waiting = wait - (time - (lastCallTime ?? time));
    return maxWait === undefined ? waiting : Math.min(waiting, maxWait - (time - lastInvokeTime));
  };
  const trailingEdge = (time: number) => {
    timer = undefined;
    if (lastArgs) invoke(time);
    lastArgs = undefined;
  };
  const expired = () => {
    const time = Date.now();
    if (shouldInvoke(time)) trailingEdge(time);
    else timer = setTimeout(expired, remainingWait(time));
  };

  const call = (...args: A) => {
    const time = Date.now();
    const invoking = shouldInvoke(time);
    lastArgs = args;
    lastCallTime = time;
    if (invoking) {
      if (timer === undefined) {
        // The leading edge
        lastInvokeTime = time;
        timer = setTimeout(expired, wait);
        if (leading) invoke(time);
        return;
      }
      if (maxWait !== undefined) {
        clearTimeout(timer);
        timer = setTimeout(expired, wait);
        invoke(time);
        return;
      }
    }
    timer ??= setTimeout(expired, wait);
  };
  return Object.assign(call, {
    cancel: () => {
      clearTimeout(timer);
      lastInvokeTime = 0;
      lastArgs = undefined;
      lastCallTime = undefined;
      timer = undefined;
    },
  });
}

/**
 * `fn` called `wait` ms after the last of a run of calls, with that call's arguments (lodash's
 * `debounce` with its defaults: trailing edge only). `cancel` drops a pending call.
 */
export const debounce = <A extends unknown[]>(fn: (...args: A) => void, wait: number): Cancellable<A> =>
  timed(fn, wait, false);

/**
 * `fn` at most once every `wait` ms (lodash's `throttle` with its defaults): the first call runs at
 * once, and calls during the wait run once more at its end, with the latest arguments. `cancel`
 * drops that call and lets the next one run at once.
 */
export const throttle = <A extends unknown[]>(fn: (...args: A) => void, wait: number): Cancellable<A> =>
  timed(fn, wait, true, wait);
