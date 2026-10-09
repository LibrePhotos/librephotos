import { describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { getNavigationItems, isNavItemActive } from "./navigation";

// Only the links are checked here; the labels come from whatever i18n returns.
const t = i18n.getFixedT("en");
function item(link: string) {
  const entry = getNavigationItems(t, true).find(candidate => candidate.link === link);
  if (!entry) {
    throw new Error(`no nav item for ${link}`);
  }
  return entry;
}

describe("isNavItemActive", () => {
  it("keeps the timeline entry to its own views, not every path under /", () => {
    const photos = item("/");
    expect(isNavItemActive(photos, "/")).toBe(true);
    expect(isNavItemActive(photos, "/favorites")).toBe(true);
    expect(isNavItemActive(photos, "/videos")).toBe(true);
    expect(isNavItemActive(photos, "/album")).toBe(false);
    expect(isNavItemActive(photos, "/deleted")).toBe(false);
  });

  it("highlights a section on its sub-pages", () => {
    expect(isNavItemActive(item("/album"), "/album")).toBe(true);
    expect(isNavItemActive(item("/album"), "/album/user/3")).toBe(true);
    expect(isNavItemActive(item("/sharing"), "/sharing/byme/photos")).toBe(true);
  });

  it("matches whole path segments only", () => {
    expect(isNavItemActive({ link: "/album" }, "/albums")).toBe(false);
    expect(isNavItemActive(item("/deleted"), "/deletedfoo")).toBe(false);
  });

  it("keeps Organizing active on both of its tabs", () => {
    const organizing = item("/organizing/duplicates");
    expect(isNavItemActive(organizing, "/organizing/duplicates")).toBe(true);
    expect(isNavItemActive(organizing, "/organizing/stacks")).toBe(true);
    expect(isNavItemActive(organizing, "/")).toBe(false);
  });
});
