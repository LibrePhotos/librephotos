import { useDisclosure } from "@mantine/hooks";
import React from "react";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { ChordHint } from "./ChordHint";
import { ShortcutsModal } from "./ShortcutsModal";
import { ShortcutsOverlayContext } from "./shortcutsOverlay";
import { useGoToHotkeys } from "./useGoToHotkeys";

/**
 * The signed-in app's keyboard shortcuts (#2037): the `g` chords, their hint and the `?` list,
 * which the account menu opens too.
 */
export function KeyboardShortcuts({ children }: Readonly<{ children: React.ReactNode }>) {
  const { data: user } = useCurrentUserSelfDetailsQuery();
  const isAdmin = user?.is_superuser === true;
  const [opened, { open, close }] = useDisclosure(false);
  const chordPending = useGoToHotkeys(isAdmin, open);

  return (
    <ShortcutsOverlayContext value={open}>
      {children}
      {chordPending && <ChordHint isAdmin={isAdmin} />}
      <ShortcutsModal opened={opened} onClose={close} isAdmin={isAdmin} />
    </ShortcutsOverlayContext>
  );
}
