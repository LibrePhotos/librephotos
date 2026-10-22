import { createInstance } from "i18next";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import i18n from "../i18n";
import { thingLabel, useThingLabel } from "./useThingLabel";

async function i18nWith(tags: Record<string, Record<string, string>>) {
  const instance = createInstance();
  await instance.init({
    resources: Object.fromEntries(Object.entries(tags).map(([language, bundle]) => [language, { tags: bundle }])),
    fallbackLng: "en",
  });
  return instance;
}

describe("thingLabel", () => {
  it("names a thing in the first language that has it", async () => {
    const instance = await i18nWith({ de: { beach: "Strand" }, en: { beach: "beach" } });

    expect(thingLabel(instance, ["de", "en"], "beach")).toBe("Strand");
    expect(thingLabel(instance, ["de-DE", "de", "en"], "beach")).toBe("Strand");
  });

  it("keeps a dotted thing whole instead of reading it as a nested key", async () => {
    const instance = await i18nWith({ de: { "st. patrick's day": "St. Patrick's Day (Irland)" } });

    expect(thingLabel(instance, ["de"], "st. patrick's day")).toBe("St. Patrick's Day (Irland)");
  });

  it("falls back to English, then to the stored word", async () => {
    const instance = await i18nWith({ de: { beach: "Strand", kayak: "" }, en: { kayak: "kayak", sea: "sea" } });

    // Weblate leaves an untranslated string empty
    expect(thingLabel(instance, ["de", "en"], "kayak")).toBe("kayak");
    expect(thingLabel(instance, ["de", "en"], "sea")).toBe("sea");
    // A hashtag, or an admin's own word (custom_tags.txt), is in no file
    expect(thingLabel(instance, ["de", "en"], "#beach")).toBe("#beach");
    expect(thingLabel(instance, ["de", "en"], "aurora")).toBe("aurora");
    // Nor is a name every object has
    expect(thingLabel(instance, ["de", "en"], "constructor")).toBe("constructor");
    // A language with no bundle at all
    expect(thingLabel(instance, ["fr"], "beach")).toBe("beach");
  });
});

describe("useThingLabel", () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    i18n.removeResourceBundle("de", "tags");
    await i18n.changeLanguage("en");
  });

  function Label({ thing }: Readonly<{ thing: string }>) {
    const label = useThingLabel();
    return <span>{label(thing)}</span>;
  }

  it("follows the interface language, and shows the stored word otherwise", async () => {
    i18n.addResourceBundle("de", "tags", { beach: "Strand" });
    await i18n.changeLanguage("en");
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<Label thing="beach" />));
    expect(container.textContent).toBe("beach");

    await act(async () => {
      await i18n.changeLanguage("de");
    });
    expect(container.textContent).toBe("Strand");

    await act(async () => root.render(<Label thing="kayak" />));
    expect(container.textContent).toBe("kayak");
    act(() => root.unmount());
  });
});
