/**
 * The lightbox toolbar's centred title (#12 of the design review): the day, then the place and which
 * photo of how many, so stepping through a long list keeps its bearings.
 */
import React from "react";
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { LightboxTitle } from "./LightboxTitle";

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

async function text(props: React.ComponentProps<typeof LightboxTitle>) {
  // Mantine adds its style tags next to the component: read the title's own box
  const { container } = await renderInMantine(
    <div data-testid="title">
      <LightboxTitle {...props} />
    </div>
  );
  return container.querySelector('[data-testid="title"]')?.textContent;
}

describe("LightboxTitle", () => {
  it("says the day, the place's first two parts and the position", async () => {
    expect(
      await text({
        timestamp: "2026-10-17T09:31:00Z",
        place: "Baixa, Lisbon, Portugal",
        position: { current: 12, total: 1198 },
      })
    ).toBe("Sat, Oct 17, 2026Baixa, Lisbon·12 of 1,198");
  });

  it("leaves out what it does not know, and the position of a single photo", async () => {
    expect(await text({ timestamp: null, place: "Lisbon", position: { current: 1, total: 1 } })).toBe("Lisbon");
  });

  it("renders nothing with nothing to say", async () => {
    expect(await text({})).toBe("");
  });
});
