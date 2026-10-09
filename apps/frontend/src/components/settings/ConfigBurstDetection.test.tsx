/**
 * The saved burst rules list.
 *
 * - A rule saved through the API without category, enabled or is_default is listed and kept. The
 *   list shows it as it always did: switched off, and not as a hard criterion.
 * - Anything in the saved list that is not a rule is not listed with the rules, and every save writes
 *   it back unchanged, in its place. It is listed read-only below them (the backend may still apply
 *   it), and can be deleted.
 * - Reordering moves the rules among the slots rules hold; every other entry keeps its place.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import type { BurstDetectionRule } from "./burst-detection.zod";
import { ConfigBurstDetection } from "./ConfigBurstDetection";

// SortableTbody hands its onMove here, so a test can drop a row without dragging it in jsdom.
const sortable = vi.hoisted(() => {
  const holder: { ids: string[]; onMove?: (from: number, to: number) => void } = { ids: [] };
  return holder;
});

const predefinedRules: BurstDetectionRule[] = [
  { id: 1, name: "EXIF burst mode", rule_type: "exif_burst_mode", category: "hard", enabled: true, is_default: true },
  {
    id: 4,
    name: "Timestamp proximity",
    rule_type: "timestamp_proximity",
    category: "soft",
    enabled: true,
    is_default: true,
    interval_ms: 2000,
  },
];

vi.mock("../../api_client/settings/hooks/useFetchPredefinedBurstRulesQuery", () => ({
  useFetchPredefinedBurstRulesQuery: () => ({ data: predefinedRules }),
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
vi.mock("../modals/ModalConfigBurstDetection", () => ({
  ModalConfigBurstDetection: ({
    availableRules,
    onAddRules,
  }: Readonly<{ availableRules: BurstDetectionRule[]; onAddRules: (rules: BurstDetectionRule[]) => void }>) => (
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

async function renderList(value: unknown, onChange: (entries: unknown[]) => void = () => {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <ConfigBurstDetection value={value} onChange={onChange} />
      </MantineProvider>
    );
  });
}

function found<T>(element: T | null | undefined, what: string): T {
  if (element === null || element === undefined) throw new Error(`${what} not found`);
  return element;
}

const rows = () => [...container.querySelectorAll<HTMLTableRowElement>("tr[data-sortable-id]")];
const row = (id: number) => found(container.querySelector(`tr[data-sortable-id="${id}"]`), `row ${id}`);
const unreadableRows = () => [
  ...container.querySelectorAll<HTMLTableRowElement>('tr[data-testid="unreadable-saved-entry"]'),
];
const enabledSwitches = () => [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
const enabledSwitch = (name: string) =>
  found(container.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`), `switch "${name}"`);

const savedFullRule = {
  id: 1,
  name: "EXIF burst mode",
  rule_type: "exif_burst_mode",
  category: "hard",
  enabled: true,
  is_default: true,
  // A key the schema does not know is saved back unchanged.
  added_by: "script",
};
const savedApiRule = { id: 7, name: "Sequence via API", rule_type: "exif_sequence_number" };
// Saved entries the list does not read: a rule type this page does not know, and junk.
const unknownRule = { id: 8, name: "Added later", rule_type: "made_up", enabled: true };
const notARule = "not a rule";

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
}

describe("ConfigBurstDetection", () => {
  it("shows a rule without category or enabled as before: switched off, not a hard criterion", async () => {
    await renderList([savedFullRule, savedApiRule]);

    expect(rows()).toHaveLength(2);
    expect(enabledSwitch("Sequence via API").checked).toBe(false);
    expect(row(7).textContent).toContain(i18n.t("settings.burst.soft_criterion"));
  });

  it("keeps such a rule, and every key of the others, when a rule is switched on", async () => {
    const onChange = vi.fn<(entries: unknown[]) => void>();
    await renderList([savedFullRule, savedApiRule], onChange);

    await click(enabledSwitch("Sequence via API"));

    expect(onChange).toHaveBeenCalledWith([savedFullRule, { ...savedApiRule, enabled: true }]);
  });

  it("does not list what is not a rule with the rules", async () => {
    await renderList(JSON.stringify([savedFullRule, notARule, unknownRule, null]));

    expect(rows().map(r => r.dataset.sortableId)).toEqual(["1"]);
  });

  it("lists what is not a rule read-only, with its place in the saved list and its JSON", async () => {
    await renderList(JSON.stringify([savedFullRule, notARule, unknownRule, null]));

    expect(unreadableRows().map(r => r.textContent)).toEqual([
      `${i18n.t("settings.unreadable_rule", { position: 2 })}${JSON.stringify(notARule)}`,
      `${i18n.t("settings.unreadable_rule", { position: 3 })}${JSON.stringify(unknownRule)}`,
      `${i18n.t("settings.unreadable_rule", { position: 4 })}null`,
    ]);
    expect(enabledSwitches()).toHaveLength(1);
  });

  it("deletes an entry it cannot read by its place, and keeps every other entry", async () => {
    const onChange = vi.fn<(entries: unknown[]) => void>();
    await renderList([unknownRule, savedFullRule, notARule], onChange);

    await click(found(unreadableRows()[0]?.querySelector<HTMLButtonElement>("button[aria-label]"), "delete button"));

    expect(onChange).toHaveBeenCalledWith([savedFullRule, notARule]);
  });

  it("reorders the rules among their own slots and keeps every other entry in its place", async () => {
    const onChange = vi.fn<(entries: unknown[]) => void>();
    await renderList([unknownRule, savedFullRule, notARule, savedApiRule], onChange);
    expect(sortable.ids).toEqual(["1", "7"]);

    await act(async () => {
      found(sortable.onMove, "onMove")(0, 1);
    });

    expect(onChange).toHaveBeenCalledWith([unknownRule, savedApiRule, notARule, savedFullRule]);
  });

  it("saves what is not a rule back unchanged, in its place, when a rule is switched off", async () => {
    const onChange = vi.fn<(entries: unknown[]) => void>();
    await renderList(JSON.stringify([unknownRule, savedFullRule, notARule, null]), onChange);

    await click(enabledSwitch("EXIF burst mode"));

    expect(onChange).toHaveBeenCalledWith([unknownRule, { ...savedFullRule, enabled: false }, notARule, null]);
  });

  it("saves what is not a rule back unchanged when a rule is added", async () => {
    const onChange = vi.fn<(entries: unknown[]) => void>();
    await renderList([unknownRule, savedFullRule, notARule], onChange);

    await click(found(container.querySelector<HTMLButtonElement>('[data-testid="add-offered-rules"]'), "add"));

    // Rule 1 is in the list already, so the dialog offers rule 4 only.
    expect(onChange).toHaveBeenCalledWith([unknownRule, savedFullRule, notARule, predefinedRules[1]]);
  });

  it("saves what is not a rule back unchanged when a rule is deleted", async () => {
    const onChange = vi.fn<(entries: unknown[]) => void>();
    await renderList([savedApiRule, unknownRule, savedFullRule], onChange);

    await click(found(row(7).querySelector<HTMLButtonElement>("button[aria-label]"), "delete button"));

    expect(onChange).toHaveBeenCalledWith([unknownRule, savedFullRule]);
  });

  it("does not offer a rule whose id an entry it does not list has", async () => {
    const onChange = vi.fn<(entries: unknown[]) => void>();
    await renderList([{ ...unknownRule, id: 4 }], onChange);

    await click(found(container.querySelector<HTMLButtonElement>('[data-testid="add-offered-rules"]'), "add"));

    expect(onChange).toHaveBeenCalledWith([{ ...unknownRule, id: 4 }, predefinedRules[0]]);
  });

  it("can reset a list of the defaults that also holds what it does not list", async () => {
    const onChange = vi.fn<(entries: unknown[]) => void>();
    await renderList([...predefinedRules, unknownRule], onChange);

    const reset = found(
      [...container.querySelectorAll("button")].find(
        button => button.textContent === i18n.t("settings.reset_to_defaults")
      ),
      "reset button"
    );
    expect(reset.disabled).toBe(false);
    await click(reset);

    expect(onChange).toHaveBeenCalledWith(predefinedRules);
  });

  it("shows an empty list for a value that is not JSON", async () => {
    await renderList("[{");

    expect(rows()).toHaveLength(0);
  });
});
