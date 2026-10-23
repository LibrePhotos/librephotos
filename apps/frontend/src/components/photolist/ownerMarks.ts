import { createContext } from "react";

/**
 * Whether every tile of a photo list shows whose photo it is. Off by default: a tile marks only
 * another user's photo (a library shared with me, #2731). The public gallery (#434) turns it on,
 * where every photo is someone's and the visitor may be no user at all.
 */
export const OwnerMarksContext = createContext(false);
