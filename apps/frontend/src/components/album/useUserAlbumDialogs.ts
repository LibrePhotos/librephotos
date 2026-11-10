import { useMemo, useState } from "react";

/** The dialogs an album card's menu opens; at most one at a time. */
type UserAlbumDialog = "rename" | "share" | "collections" | "delete";

type State = Readonly<{
  shown: UserAlbumDialog | null;
  /** Set with the dialog, in one update, and kept while it animates closed. */
  album: Readonly<{ id: string; title: string }>;
}>;

const NONE: State = { shown: null, album: { id: "", title: "" } };

/**
 * The album card menus' dialogs on an album list (#2240): which one is open and the album it is
 * about, as one value, so a dialog never shows one album's id with another's title and opening one
 * closes the other.
 */
export function useUserAlbumDialogs() {
  const [state, setState] = useState<State>(NONE);
  return useMemo(() => {
    const dialog = (kind: UserAlbumDialog) => ({
      opened: state.shown === kind,
      open: (id: string, title: string) => setState({ shown: kind, album: { id, title } }),
      close: () => setState(prev => (prev.shown === kind ? { ...prev, shown: null } : prev)),
    });
    return {
      album: state.album,
      rename: dialog("rename"),
      share: dialog("share"),
      collections: dialog("collections"),
      remove: dialog("delete"),
    };
  }, [state]);
}
