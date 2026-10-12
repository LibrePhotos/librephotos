/**
 * A component that collects input and submits it is a form on `useForm` from @mantine/form with a
 * zod schema (AGENTS.md, "Forms"); lint (ban/form-validate-object) keeps the validation on the
 * schema. This test finds the forms still built from `useState`, in a file that never calls
 * `useForm(`:
 *
 * - one that renders a submit button (`type="submit"`, a `<form>` or `component="form"`);
 * - one without a submit button that keeps an input's value in `useState` and validates it by
 *   hand: the input shows an `error`, or a Button's `disabled` reads the value (or a `const`
 *   computed from it), the shape of a dialog whose OK button stays off until the input is right.
 *
 * A field component that gets its value from props (`setup/DirectoryPicker`, which checks a path
 * for the form around it) is not a form, nor is a search box whose value no button depends on.
 *
 * ALLOW_LIST holds the forms not converted yet (#2356; empty now). It only shrinks: a listed file
 * that is converted, renamed or deleted fails the second test until its entry goes.
 */
import { describe, expect, it } from "vitest";

const ALLOW_LIST = new Set<string>([]);

const SUBMITS = /type=(\{\s*)?["']submit["']|<form[\s>]|component=["']form["']/;
const USES_FORM = /\buseForm\(/;
const INPUT_TAG =
  /<(TextInput|PasswordInput|Textarea|NumberInput|Select|MultiSelect|Autocomplete|TagsInput|PinInput|JsonInput|ColorInput|DateInput|DateTimePicker|DatePickerInput|TimeInput)\b/g;
const STATE = /const \[(\w+), set\w+\] = useState\b/g;
const BUTTON_TAG = /<Button\b/g;

/** The JSX opening tag that starts at `start`, up to the `>` outside braces and strings. */
function openingTag(source: string, start: number): string {
  let depth = 0;
  let quote: string | undefined;
  for (let i = start + 1; i < source.length; i++) {
    const char = source.charAt(i);
    if (quote !== undefined) {
      if (char === quote && source.charAt(i - 1) !== "\\") quote = undefined;
    } else if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
    } else if (char === ">" && depth === 0) {
      return source.slice(start, i + 1);
    }
  }
  return source.slice(start);
}

/** The expression of `name={...}` in a JSX opening tag, if the tag has it. */
function attribute(tag: string, name: string): string | undefined {
  const at = tag.search(new RegExp(`\\s${name}=\\{`));
  if (at < 0) return undefined;
  const open = tag.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < tag.length; i++) {
    if (tag.charAt(i) === "{") depth++;
    else if (tag.charAt(i) === "}" && --depth === 0) return tag.slice(open + 1, i);
  }
  return undefined;
}

const tags = (source: string, pattern: RegExp) =>
  Array.from(source.matchAll(pattern), m => openingTag(source, m.index));
const mentions = (expression: string, names: readonly string[]) =>
  names.some(name => new RegExp(`\\b${name}\\b`).test(expression));

/** Whether `source` keeps an input's value in `useState` and validates it by hand. */
function hasHandValidatedInput(source: string): boolean {
  const state = Array.from(source.matchAll(STATE)).flatMap(m => m[1] ?? []);
  const buttonsDisabledBy = tags(source, BUTTON_TAG).flatMap(tag => attribute(tag, "disabled") ?? []);
  return tags(source, INPUT_TAG).some(tag => {
    const value = attribute(tag, "value")?.trim();
    if (value === undefined || !state.includes(value)) return false;
    if (attribute(tag, "error") !== undefined) return true;
    // `const trimmed = name.trim()` stands for the value in the button's condition
    const declaresFromValue = new RegExp(`const (\\w+) = [^;\\n]*\\b${value}\\b`, "g");
    const derived = Array.from(source.matchAll(declaresFromValue)).flatMap(m => m[1] ?? []);
    return buttonsDisabledBy.some(disabled => mentions(disabled, [value, ...derived]));
  });
}

/** Whether `source` is a form built without `useForm`. */
function isHandRolledForm(source: string): boolean {
  return !USES_FORM.test(source) && (SUBMITS.test(source) || hasHandValidatedInput(source));
}

const sources = import.meta.glob<string>(["/src/**/*.tsx", "!/src/**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("forms", () => {
  it("are built with useForm, outside the allow-list", () => {
    const offenders = Object.entries(sources)
      .filter(([path, source]) => !ALLOW_LIST.has(path) && isHandRolledForm(source))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it("leave the allow-list once they are converted, renamed or deleted", () => {
    const stale = [...ALLOW_LIST].filter(path => {
      const source = sources[path];
      return source === undefined || !isHandRolledForm(source);
    });

    expect(stale).toEqual([]);
  });

  it("flags a useState form with a submit button, and passes a useForm one", () => {
    const planted = `
      const [name, setName] = useState("");
      return (
        <form onSubmit={save}>
          <TextInput value={name} onChange={event => setName(event.currentTarget.value)} />
          <Button type="submit">Save</Button>
        </form>
      );`;
    const converted = `
      const form = useForm({ initialValues: { name: "" }, validate: schemaResolver(schema, { sync: true }) });
      return (
        <form onSubmit={form.onSubmit(save)}>
          <TextInput {...form.getInputProps("name")} />
          <Button type="submit">Save</Button>
        </form>
      );`;

    expect(isHandRolledForm(planted)).toBe(true);
    expect(isHandRolledForm(planted.replace("<form onSubmit={save}>", "<Stack>").replace("</form>", "</Stack>"))).toBe(
      true
    );
    expect(isHandRolledForm(converted)).toBe(false);
  });

  // The shapes TagRenameModal, TagMergeModal, ModalNextcloudScanDirectoryEdit and PasswordEntry
  // had before #2356 converted them: no submit button, so only these rules saw them.
  it("flags a useState input validated by hand, without a submit button", () => {
    const shownError = `
      const [newName, setNewName] = useState("");
      const nameTaken = existingNames.includes(newName.trim());
      return (
        <TextInput
          error={nameTaken ? t("tagalbum.tagalreadyexists", { name: newName.trim() }) : ""}
          value={newName}
          onChange={event => setNewName(event.currentTarget.value)}
        />
      );`;
    const gatedButton = `
      const [newScanDirectory, setNewScanDirectory] = useState(path ?? "");
      const trimmed = newScanDirectory.trim();
      return (
        <>
          <TextInput value={newScanDirectory} onChange={event => setNewScanDirectory(event.currentTarget.value)} />
          <Button disabled={!trimmed || trimmed === (path ?? "")} onClick={() => onChange(trimmed)}>
            Update
          </Button>
        </>
      );`;
    const gatedSelect = `
      const [mergeSource, setMergeSource] = useState<string | null>(null);
      return (
        <>
          <Select value={mergeSource} onChange={setMergeSource} data={options} />
          <Button disabled={!mergeSource} onClick={merge}>Merge</Button>
        </>
      );`;

    expect(isHandRolledForm(shownError)).toBe(true);
    expect(isHandRolledForm(gatedButton)).toBe(true);
    expect(isHandRolledForm(gatedSelect)).toBe(true);
  });

  it("passes a search box and a field component that checks a value for its form", () => {
    const searchBox = `
      const [query, setQuery] = useState("");
      return (
        <>
          <TextInput value={query} onChange={event => setQuery(event.currentTarget.value)} />
          <Button disabled={isLoading} onClick={refresh}>Refresh</Button>
        </>
      );`;
    const fieldComponent = `
      const [isValidPath, setIsValidPath] = useState(true);
      return (
        <TextInput
          value={value}
          onChange={event => onChange(event.currentTarget.value)}
          error={value && !isValidPath ? missingPathError : undefined}
        />
      );`;

    expect(isHandRolledForm(searchBox)).toBe(false);
    expect(isHandRolledForm(fieldComponent)).toBe(false);
  });
});
