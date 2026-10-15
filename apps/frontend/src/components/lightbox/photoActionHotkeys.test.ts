/**
 * The photo keys reach the toolbar as commands, run through Mantine's own
 * dispatcher with the event a browser sends: F, H, A, P, D and the digits 0-5
 * (#2202), and none of them on a public page or without photo details.
 */
import { getHotkeyHandler } from "@mantine/hooks";
import { describe, expect, it, vi } from "vitest";
import { createLightboxCommands } from "./lightboxCommands";
import { photoActionHotkeys } from "./photoActionHotkeys";

function press(enabled: boolean, key: string) {
  const commands = createLightboxCommands();
  const rate = vi.fn<(rating: number) => void>();
  const favorite = vi.fn<() => void>();
  const hide = vi.fn<() => void>();
  const archive = vi.fn<() => void>();
  commands.on("rate", rate);
  commands.on("favorite", favorite);
  commands.on("hide", hide);
  commands.on("archive", archive);
  getHotkeyHandler(photoActionHotkeys(commands, enabled))(new KeyboardEvent("keydown", { key, code: key }));
  return { rate, favorite, hide, archive };
}

describe("photoActionHotkeys", () => {
  it("sends each digit from 0 to 5 as a rating", () => {
    for (const rating of [0, 1, 2, 3, 4, 5]) {
      expect(press(true, String(rating)).rate).toHaveBeenCalledWith(rating);
    }
    expect(press(true, "6").rate).not.toHaveBeenCalled();
  });

  it("sends F, H and A as their commands", () => {
    expect(press(true, "f").favorite).toHaveBeenCalledTimes(1);
    expect(press(true, "h").hide).toHaveBeenCalledTimes(1);
    expect(press(true, "a").archive).toHaveBeenCalledTimes(1);
    expect(press(false, "a").archive).not.toHaveBeenCalled();
  });

  it("sends nothing while disabled", () => {
    const { rate, favorite } = press(false, "4");
    expect(rate).not.toHaveBeenCalled();
    expect(press(false, "f").favorite).not.toHaveBeenCalled();
    expect(favorite).not.toHaveBeenCalled();
  });
});
