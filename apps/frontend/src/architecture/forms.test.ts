/**
 * A component that collects input and submits it is a form on `useForm` from @mantine/form with a
 * zod schema (AGENTS.md, "Forms"); lint (ban/form-validate-object) keeps the validation on the
 * schema. This test finds the forms still built from `useState`: a file that renders a submit
 * button (`type="submit"`, a `<form>` or `component="form"`) and never calls `useForm(`.
 *
 * ALLOW_LIST holds the forms not converted yet (#2356). It only shrinks: a listed file that is
 * converted, renamed or deleted fails the second test until its entry goes.
 */
import { describe, expect, it } from "vitest";

const ALLOW_LIST = new Set([
  "/src/components/album/PersonRenameModal.tsx",
  "/src/components/album/UserAlbumModals.tsx",
  "/src/components/facedashboard/HeaderComponent.tsx",
  "/src/components/modals/AlbumEdit/AlbumEditModal.tsx",
  "/src/components/modals/ModalPersonEdit.tsx",
]);

const SUBMITS = /type=(\{\s*)?["']submit["']|<form[\s>]|component=["']form["']/;
const USES_FORM = /\buseForm\(/;

/** Whether `source` renders a submit button without a `useForm` form behind it. */
function isHandRolledForm(source: string): boolean {
  return SUBMITS.test(source) && !USES_FORM.test(source);
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
});
