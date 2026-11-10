import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { defined } from "../util/defined.test-utils";
import { useKeyedState } from "./useKeyedState";

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

type Update = (next: (previous: number) => number) => void;

async function renderKeyed(key: string) {
  const rendered: string[] = [];
  const setters: Record<string, Update> = {};
  function Probe({ itemKey }: { itemKey: string }) {
    const [value, update] = useKeyedState(itemKey, () => 0);
    rendered.push(`${itemKey}:${value}`);
    setters[itemKey] = update;
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const render = (next: string) => act(async () => root.render(<Probe itemKey={next} />));
  await render(key);
  return { rendered, render, setter: (forKey: string) => defined(setters[forKey]) };
}

describe("useKeyedState", () => {
  it("starts over for a new key in the very render that shows it", async () => {
    const view = await renderKeyed("a");
    await act(async () => view.setter("a")(value => value + 2));

    await view.render("b");

    expect(view.rendered.slice(0, 2)).toEqual(["a:0", "a:2"]);
    expect(new Set(view.rendered.slice(2))).toEqual(new Set(["b:0"]));
  });

  it("ignores an update made through the setter of the item shown before", async () => {
    const view = await renderKeyed("a");
    await view.render("b");
    await act(async () => view.setter("b")(value => value + 1));

    await act(async () => view.setter("a")(() => 7));

    expect(view.rendered.at(-1)).toBe("b:1");
  });
});
