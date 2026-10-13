import type { HotkeyItem } from "@mantine/hooks";
import { RATINGS_HIGHEST_FIRST } from "../../util/rating";
import type { LightboxCommands } from "./lightboxCommands";

/**
 * The keys that act on the shown photo, as commands to the toolbar: F toggles
 * the favorite, 0-5 set the star rating (the toolbar acts on whichever matches
 * the user's rating style, #2202), H hides, P shares and D trashes. They do
 * nothing while the photo's details are missing and on a public page.
 */
export function photoActionHotkeys(commands: LightboxCommands, enabled: boolean): HotkeyItem[] {
  const whenEnabled = (action: () => void) => () => {
    if (enabled) action();
  };
  return [
    ["f", whenEnabled(() => commands.emit("favorite"))],
    ["h", whenEnabled(() => commands.emit("hide"))],
    ["p", whenEnabled(() => commands.emit("public"))],
    ["d", whenEnabled(() => commands.emit("delete"))],
    ...RATINGS_HIGHEST_FIRST.map((rating): HotkeyItem => [
      String(rating),
      whenEnabled(() => commands.emit("rate", rating)),
    ]),
  ];
}
