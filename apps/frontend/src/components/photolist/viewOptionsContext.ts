import { createContext, type ReactNode } from "react";

/**
 * A photo list's display options (photo size, order, header size, scroll bar), which its toolbar
 * hands to the page's ⋯ (HeaderActionsMenu): the menu gets a "View options…" item that opens them
 * beside it, so a header never shows a second "adjust" button next to the ⋯. Null outside a
 * photo list's toolbar.
 */
export const ViewOptionsContext = createContext<ReactNode>(null);
