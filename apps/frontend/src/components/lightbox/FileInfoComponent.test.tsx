/**
 * The camera row hid every focal length ending in 0 (50 mm, 200 mm) and every
 * lens name containing "0 mm", because a zero focal length was matched as a
 * substring rather than as the whole value.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { FileInfoComponent } from "./FileInfoComponent";

beforeAll(() => {
  // @ts-ignore - jsdom has no matchMedia, MantineProvider needs it
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

async function renderedText(info: string | undefined, description?: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <FileInfoComponent info={info} description={description} />
      </MantineProvider>
    );
  });
  // Only the component's own text, not the provider's <style> blocks.
  const text = Array.from(container.querySelectorAll("p"))
    .map(p => p.textContent)
    .join(" ");
  await act(async () => root.unmount());
  container.remove();
  return text;
}

describe("FileInfoComponent", () => {
  it.each(["50 mm", "200 mm", "EF 70-200 mm", "ISO100"])("shows %s", async info => {
    expect(await renderedText(info)).toBe(info);
  });

  it.each(["0 mm", "null mm", "ISOundefined", "NaN mm", "", undefined])("hides %s", async info => {
    expect(await renderedText(info)).toBe("");
  });

  it("shows a described value with its label", async () => {
    expect(await renderedText("50 mm", "Focal Length 35mm Equivalent")).toBe("Focal Length 35mm Equivalent 50 mm");
  });
});
