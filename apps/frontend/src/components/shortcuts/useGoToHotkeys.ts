import { useTimeout } from "@mantine/hooks";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useState } from "react";
import { belongsElsewhere, CHORD_TIMEOUT_MS, readKey } from "./goToShortcuts";

/**
 * The app-wide keys (#2037): `g` then a letter goes to a page, `?` opens the list of shortcuts.
 * Returns whether a chord waits for its second key, for the hint that lists them.
 *
 * Listens on window in the capture phase, so the second key of a chord reaches no other
 * single-key shortcut on the page.
 */
export function useGoToHotkeys(isAdmin: boolean, onHelp: () => void): boolean {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const expiry = useTimeout(() => setPending(false), CHORD_TIMEOUT_MS);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (belongsElsewhere(event.target)) {
      return;
    }
    const step = readKey(event, pending, isAdmin);
    expiry.clear();
    setPending(step.kind === "start");
    if (step.kind === "start") {
      expiry.start();
      return;
    }
    if (step.kind === "none") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (step.kind === "help") {
      onHelp();
      return;
    }
    void navigate({ to: step.to });
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, []);

  return pending;
}
