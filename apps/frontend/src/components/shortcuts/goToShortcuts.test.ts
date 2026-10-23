import { describe, expect, it } from "vitest";
import { belongsElsewhere, goToShortcuts, readKey, shortcutFor } from "./goToShortcuts";

const press = (key: string, extra: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "repeat", boolean>> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  repeat: false,
  ...extra,
});

describe("readKey (#2037)", () => {
  it("starts a chord on g and opens the list on ?", () => {
    expect(readKey(press("g"), false, false)).toEqual({ kind: "start" });
    expect(readKey(press("?"), false, false)).toEqual({ kind: "help" });
  });

  it("goes to the page of the second key, upper case too", () => {
    expect(readKey(press("s"), true, false)).toEqual({ kind: "go", to: "/settings" });
    expect(readKey(press("L"), true, false)).toEqual({ kind: "go", to: "/library" });
    expect(readKey(press("p"), true, false)).toEqual({ kind: "go", to: "/" });
    expect(readKey(press("j"), true, false)).toEqual({ kind: "go", to: "/jobs" });
  });

  it("gives the Admin Area chord to admins only", () => {
    expect(readKey(press("a"), true, true)).toEqual({ kind: "go", to: "/admin" });
    expect(readKey(press("a"), true, false)).toEqual({ kind: "none" });
  });

  it("ends a chord on any other key, and a second key alone does nothing", () => {
    expect(readKey(press("x"), true, true)).toEqual({ kind: "none" });
    expect(readKey(press("s"), false, true)).toEqual({ kind: "none" });
  });

  it("leaves browser shortcuts and held keys alone", () => {
    expect(readKey(press("g", { ctrlKey: true }), false, true)).toEqual({ kind: "none" });
    expect(readKey(press("g", { metaKey: true }), false, true)).toEqual({ kind: "none" });
    expect(readKey(press("s", { altKey: true }), true, true)).toEqual({ kind: "none" });
    expect(readKey(press("g", { repeat: true }), false, true)).toEqual({ kind: "none" });
  });
});

describe("goToShortcuts", () => {
  it("lists the Admin Area for admins only", () => {
    expect(goToShortcuts(false).map(shortcut => shortcut.key)).toEqual(["p", "l", "s", "j"]);
    expect(goToShortcuts(true).map(shortcut => shortcut.key)).toEqual(["p", "l", "s", "a", "j"]);
    expect(shortcutFor("/admin")?.key).toBe("a");
  });
});

describe("belongsElsewhere", () => {
  const make = (html: string) => {
    const doc = document.implementation.createHTMLDocument("test");
    doc.body.innerHTML = html;
    return doc;
  };

  it("lets keys on the page through", () => {
    const doc = make('<button id="target">x</button>');
    expect(belongsElsewhere(doc.getElementById("target"), doc)).toBe(false);
    expect(belongsElsewhere(null, doc)).toBe(false);
  });

  it("leaves typing in a field alone", () => {
    const doc = make('<input id="a" /><textarea id="b"></textarea><select id="c"></select>');
    for (const id of ["a", "b", "c"]) {
      expect(belongsElsewhere(doc.getElementById(id), doc)).toBe(true);
    }
  });

  it("leaves an open dialog alone, wherever the focus is", () => {
    const inside = make('<div role="dialog"><button id="target">x</button></div>');
    expect(belongsElsewhere(inside.getElementById("target"), inside)).toBe(true);
    const modal = make('<button id="target">x</button><div role="dialog" aria-modal="true"></div>');
    expect(belongsElsewhere(modal.getElementById("target"), modal)).toBe(true);
  });
});
