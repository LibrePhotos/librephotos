/**
 * The saved date-time rules list.
 *
 * - A rule saved before the is_default flag existed (2022-12) is shown and kept.
 * - Anything in the saved list that is not a rule, or a value that is not JSON, used to throw while
 *   rendering and took the settings page down. Such an entry is now not listed with the rules, and
 *   every save writes it back unchanged, in its place: rules apply in order. The backend may still
 *   apply it (it needs only a rule_type and that type's params), so it is listed read-only below
 *   the rules, and can be deleted.
 * - Reordering moves the rules among the slots rules hold; every other entry keeps its place.
 */
import type { DateTimeRule } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { ConfigDateTime } from "./ConfigDateTime";

// SortableTbody hands its onMove here, so a test can drop a row without dragging it in jsdom.
const sortable = vi.hoisted(() => {
  const holder: { ids: string[]; onMove?: (from: number, to: number) => void } = { ids: [] };
  return holder;
});

const predefinedRules: DateTimeRule[] = [
  { id: 1, name: "Date taken", rule_type: "exif", exif_tag: "EXIF:DateTimeOriginal", is_default: true },
  { id: 15, name: "File modified", rule_type: "filesystem", file_property: "mtime", is_default: false },
  // Servers before #2254 still list it.
  { id: 14, name: "Timestamp set by user", rule_type: "user_defined", is_default: false },
];

vi.mock("../../api_client/settings/hooks/useFetchPredefinedRulesQuery", () => ({
  useFetchPredefinedRulesQuery: () => ({ data: predefinedRules }),
}));
vi.mock("./SortableTableRows", () => ({
  SortableTbody: ({
    ids,
    onMove,
    children,
  }: Readonly<{ ids: string[]; onMove: (from: number, to: number) => void; children: React.ReactNode }>) => {
    sortable.ids = ids;
    sortable.onMove = onMove;
    return <tbody>{children}</tbody>;
  },
  SortableTr: ({ id, children }: Readonly<{ id: string; children: React.ReactNode }>) => (
    <tr data-sortable-id={id}>{children}</tr>
  ),
}));
// The dialog adds every rule it offers.
vi.mock("../modals/ModalConfigDatetime", () => ({
  ModalConfigDatetime: ({
    availableRules,
    onAddRules,
  }: Readonly<{ availableRules: DateTimeRule[]; onAddRules: (rules: DateTimeRule[]) => void }>) => (
    <button type="button" data-testid="add-offered-rules" onClick={() => onAddRules(availableRules)} />
  ),
}));

let root: Root;
let container: HTMLDivElement;

beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
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
  // jsdom has no ResizeObserver, Mantine's ScrollArea needs it
  globalThis.ResizeObserver = class ResizeObserverStub implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function renderList(value: string, onChange: (rules: string) => void = () => {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <ConfigDateTime value={value} onChange={onChange} />
      </MantineProvider>
    );
  });
}

function found<T>(element: T | null | undefined, what: string): T {
  if (element === null || element === undefined) throw new Error(`${what} not found`);
  return element;
}

const rowIds = () =>
  [...container.querySelectorAll<HTMLTableRowElement>("tr[data-sortable-id]")].map(r => r.dataset.sortableId);

// Saved before is_default was added.
const legacyRule = { id: 1, name: "Date taken", rule_type: "exif", exif_tag: "EXIF:DateTimeOriginal" };
// A key the schema does not know is saved back unchanged.
const ruleWithExtraKey = { ...predefinedRules[1], note: "kept" };
// Saved entries the list does not read: a rule type this page does not know, and junk.
const unknownRule = { id: 20, name: "Added later", rule_type: "made_up" };
const notARule = "not a rule";
// The backend applies this one (TimeExtractionRule reads only rule_type and its params), but it has
// no name and its id is not a number, so the page cannot list it with the rules.
const unnamedRule = { id: "3", rule_type: "path" };

const unreadableRows = () => [
  ...container.querySelectorAll<HTMLTableRowElement>('tr[data-testid="unreadable-saved-entry"]'),
];

const deleteButton = (id: number) =>
  found(
    container.querySelector<HTMLButtonElement>(`tr[data-sortable-id="${id}"] button[aria-label]`),
    `delete button of rule ${id}`
  );
const addButton = () =>
  found(container.querySelector<HTMLButtonElement>('[data-testid="add-offered-rules"]'), "add button");

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
}

describe("ConfigDateTime", () => {
  it("shows a rule saved before is_default existed", async () => {
    await renderList(JSON.stringify([legacyRule]));

    expect(rowIds()).toEqual(["1"]);
    expect(found(container.querySelector('tr[data-sortable-id="1"] strong'), "rule title").textContent).toBe(
      "Date taken"
    );
  });

  // #2225: laid out like the burst rule list.
  it("names its column in a header row and does not show the internal rule id", async () => {
    await renderList(JSON.stringify([legacyRule, predefinedRules[1]]));

    const headers = [...container.querySelectorAll("thead th")].map(th => th.textContent);
    expect(headers).toEqual([i18n.t("settings.burst.rule"), ""]);
    // One header cell per row cell, so the delete column lines up.
    expect(
      found(container.querySelector<HTMLTableRowElement>("tr[data-sortable-id]"), "a rule row").cells
    ).toHaveLength(headers.length);
    expect(container.textContent).not.toContain("(ID:");
    expect(container.textContent).toContain(i18n.t("rules.rule_type", { rule: i18n.t("rules.rule_type_names.exif") }));
  });

  // #2270
  it("lists a Google Takeout rule as a rule, with the name of its type", async () => {
    const takeoutRule = {
      id: 21,
      name: "Takeout capture time",
      rule_type: "takeout_json",
      transform_tz: 1,
      source_tz: "utc",
      report_tz: "user_default",
      is_default: true,
    };
    await renderList(JSON.stringify([takeoutRule]));

    expect(container.querySelectorAll("tr[data-sortable-id]")).toHaveLength(1);
    expect(container.textContent).toContain(
      i18n.t("rules.rule_type", { rule: i18n.t("rules.rule_type_names.takeout_json") })
    );
  });

  it("saves the other rules unchanged when one is deleted", async () => {
    const onChange = vi.fn<(rules: string) => void>();
    await renderList(JSON.stringify([legacyRule, ruleWithExtraKey]), onChange);

    await click(deleteButton(1));

    expect(onChange).toHaveBeenCalledWith(JSON.stringify([ruleWithExtraKey]));
  });

  it("does not list what is not a rule with the rules", async () => {
    await renderList(JSON.stringify([legacyRule, notARule, { id: 2, rule_type: "exif" }, unknownRule, null]));

    expect(rowIds()).toEqual(["1"]);
  });

  it("lists a saved entry it cannot read read-only, with its place in the saved list and its JSON", async () => {
    await renderList(JSON.stringify([unnamedRule, legacyRule, unknownRule]));

    expect(unreadableRows().map(r => r.textContent)).toEqual([
      `${i18n.t("settings.unreadable_rule", { position: 1 })}${JSON.stringify(unnamedRule)}`,
      `${i18n.t("settings.unreadable_rule", { position: 3 })}${JSON.stringify(unknownRule)}`,
    ]);
  });

  it("deletes an entry it cannot read by its place, and keeps every other entry", async () => {
    const onChange = vi.fn<(rules: string) => void>();
    await renderList(JSON.stringify([legacyRule, unnamedRule, notARule]), onChange);

    await click(found(unreadableRows()[0]?.querySelector<HTMLButtonElement>("button[aria-label]"), "delete button"));

    expect(onChange).toHaveBeenCalledWith(JSON.stringify([legacyRule, notARule]));
  });

  it("reorders the rules among their own slots and keeps every other entry in its place", async () => {
    const onChange = vi.fn<(rules: string) => void>();
    await renderList(JSON.stringify([unknownRule, legacyRule, notARule, ruleWithExtraKey]), onChange);
    expect(sortable.ids).toEqual(["1", "15"]);

    await act(async () => {
      found(sortable.onMove, "onMove")(0, 1);
    });

    expect(onChange).toHaveBeenCalledWith(JSON.stringify([unknownRule, ruleWithExtraKey, notARule, legacyRule]));
  });

  it("saves what is not a rule back unchanged, in its place, when a rule is deleted", async () => {
    const onChange = vi.fn<(rules: string) => void>();
    await renderList(JSON.stringify([unknownRule, legacyRule, notARule, ruleWithExtraKey, null]), onChange);

    await click(deleteButton(1));

    expect(onChange).toHaveBeenCalledWith(JSON.stringify([unknownRule, notARule, ruleWithExtraKey, null]));
  });

  it("saves what is not a rule back unchanged when a rule is added", async () => {
    const onChange = vi.fn<(rules: string) => void>();
    await renderList(JSON.stringify([unknownRule, legacyRule, notARule]), onChange);

    await click(addButton());

    // Rule 1 is in the list already, so the dialog offers rule 15 only.
    expect(onChange).toHaveBeenCalledWith(JSON.stringify([unknownRule, legacyRule, notARule, predefinedRules[1]]));
  });

  it("does not offer a rule whose id an entry it does not list has", async () => {
    const onChange = vi.fn<(rules: string) => void>();
    await renderList(JSON.stringify([{ ...unknownRule, id: 15 }]), onChange);

    await click(addButton());

    expect(onChange).toHaveBeenCalledWith(JSON.stringify([{ ...unknownRule, id: 15 }, predefinedRules[0]]));
  });

  it("does not offer Timestamp set by user, which a date set by hand replaced (#2254)", async () => {
    const onChange = vi.fn<(rules: string) => void>();
    await renderList(JSON.stringify([]), onChange);

    await click(addButton());

    expect(onChange).toHaveBeenCalledWith(JSON.stringify([predefinedRules[0], predefinedRules[1]]));
    expect(container.textContent).toContain(i18n.t("settings.configdatetime_manual_hint"));
  });

  it("shows an empty list for a value that is not JSON", async () => {
    await renderList("[{");

    expect(rowIds()).toEqual([]);
  });
});
