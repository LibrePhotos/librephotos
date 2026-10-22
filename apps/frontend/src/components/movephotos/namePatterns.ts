/**
 * The tokens and presets of the name and folder patterns (#2773, #2774). The server checks every
 * pattern again (`api/photos/naming.py`); these keep the dialogs from asking about one it refuses.
 */

/** The tokens of the capture date, in the order the dialog lists them. */
export const DATE_TOKENS = ["{year}", "{month}", "{day}", "{hour}", "{minute}", "{second}"] as const;
/** The main file's current name without its extension. */
export const NAME_TOKEN = "{name}";

/** The longest pattern the server takes. */
export const MAX_PATTERN_LENGTH = 200;

/** The name presets of "Rename files…", by the key of their label. */
export const NAME_PRESETS = {
  datetime: "{year}{month}{day}_{hour}{minute}{second}",
  datetimename: "{year}{month}{day}_{hour}{minute}{second}_{name}",
  datename: "{year}{month}{day}_{name}",
} as const;

type NamedPreset = keyof typeof NAME_PRESETS;
export type NamePreset = NamedPreset | "custom";

export const NAMED_PRESETS: readonly NamedPreset[] = ["datetime", "datetimename", "datename"];

/** The preset `pattern` is, or "custom". */
export function presetOf(pattern: string): NamePreset {
  return NAMED_PRESETS.find(preset => NAME_PRESETS[preset] === pattern) ?? "custom";
}

/** The folder presets of "Sort into folders by date". */
export const FOLDER_PRESETS = ["{year}", "{year}/{month}", "{year}/{month}/{day}"] as const;
export const DEFAULT_FOLDER_PATTERN = "{year}/{month}";

const KNOWN_TOKENS: ReadonlySet<string> = new Set([...DATE_TOKENS, NAME_TOKEN]);
const TOKEN = /\{[a-z]+\}/g;
// Separators and the characters Windows refuses; control characters are checked by code.
const UNSAFE = /[\\/:*?"<>|]/;
const isControl = (char: string) => {
  const code = char.charCodeAt(0);
  return code < 0x20 || code === 0x7f;
};

/** Why the server would refuse a name pattern, or null. */
export type PatternProblem = "empty" | "toolong" | "unknowntoken" | "unsafe" | null;

export function namePatternProblem(pattern: string): PatternProblem {
  if (!pattern.trim()) return "empty";
  if (pattern.length > MAX_PATTERN_LENGTH) return "toolong";
  const tokens = pattern.match(TOKEN) ?? [];
  const literal = pattern.replace(TOKEN, "");
  if (tokens.some(token => !KNOWN_TOKENS.has(token)) || /[{}]/.test(literal)) return "unknowntoken";
  if (pattern.startsWith(".") || UNSAFE.test(literal) || [...literal].some(isControl)) return "unsafe";
  return null;
}

/** `value` with `token` put in place of the text selected from `start` to `end`; the caret after it. */
export function insertToken(value: string, token: string, start: number, end: number): [string, number] {
  return [value.slice(0, start) + token + value.slice(end), start + token.length];
}
