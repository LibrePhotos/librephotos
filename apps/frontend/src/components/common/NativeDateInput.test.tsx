import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { NativeDateInput, NativeDateTimeInput, NativeTimeInput } from "./NativeDateInput";

beforeAll(async () => {
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
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

async function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => createRoot(container).render(<MantineProvider env="test">{node}</MantineProvider>));
  return container;
}

const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

describe("the native date inputs", () => {
  it("are the browser's own inputs, with seconds where they are asked for", async () => {
    const container = await mount(
      <>
        <NativeDateInput label="Day" value="2024-06-14" min="2024-01-01" max="2024-12-31" onChange={() => {}} />
        <NativeTimeInput label="Time" withSeconds value="10:07:05" onChange={() => {}} />
        <NativeTimeInput label="At" value="03:00" onChange={() => {}} />
        <NativeDateTimeInput label="Until" value="2024-06-14T10:07" onChange={() => {}} />
      </>
    );
    const inputs = [...container.querySelectorAll("input")];

    expect(inputs.map(input => [input.type, input.step, input.value])).toEqual([
      ["date", "", "2024-06-14"],
      ["time", "1", "10:07:05"],
      ["time", "", "03:00"],
      ["datetime-local", "", "2024-06-14T10:07"],
    ]);
    expect([defined(inputs[0]).min, defined(inputs[0]).max]).toEqual(["2024-01-01", "2024-12-31"]);
    expect(container.querySelector("label")?.textContent).toBe("Day");
  });

  it("report the input's string as it changes", async () => {
    const onChange = vi.fn<(value: string) => void>();
    const container = await mount(<NativeDateInput label="Day" value="" onChange={onChange} />);
    const input = defined(container.querySelector("input"));

    await act(async () => {
      setValue?.call(input, "2024-06-20");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith("2024-06-20");
  });

  it("offer Clear only when clearable and filled", async () => {
    const onChange = vi.fn<(value: string) => void>();
    const filled = await mount(<NativeDateInput label="Day" clearable value="2024-06-14" onChange={onChange} />);
    const empty = await mount(<NativeDateInput label="Day" clearable value="" onChange={onChange} />);
    const plain = await mount(<NativeDateInput label="Day" value="2024-06-14" onChange={onChange} />);

    await act(async () => defined(filled.querySelector<HTMLButtonElement>('button[aria-label="Clear"]')).click());

    expect(onChange).toHaveBeenCalledWith("");
    expect(empty.querySelector("button")).toBeNull();
    expect(plain.querySelector("button")).toBeNull();
  });
});
