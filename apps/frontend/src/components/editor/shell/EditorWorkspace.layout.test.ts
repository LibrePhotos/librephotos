/**
 * The panel's layout rules (jsdom lays nothing out, so the stylesheet is read): on a phone the
 * "Simple | Advanced" header sits above the panel's scrolling body instead of sticking inside it,
 * so nothing scrolled can show above or behind it, and it is opaque. Checked in Chromium at 390 px.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve("src/components/editor/shell/EditorWorkspace.module.css"), "utf8");

/** The declarations of the first rule with exactly this selector. */
function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no rule ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

describe("the editor panel's layout", () => {
  it("scrolls its body, not the panel that holds the header", () => {
    expect(rule(".panel")).toMatch(/overflow:\s*hidden/);
    expect(rule(".panelBody")).toMatch(/overflow-y:\s*auto/);
    expect(rule(".panelBody")).toMatch(/min-height:\s*0/);
  });

  it("keeps the header out of the scrolled content, on an opaque background", () => {
    const header = rule(".panelHeader");
    expect(header).not.toMatch(/position:\s*sticky/);
    expect(header).toMatch(/flex:\s*none/);
    expect(header).toMatch(/background:\s*var\(--mantine-color-body\)/);
  });
});
