import { createContext } from "react";

/**
 * The user album the lightbox was opened from (#262), whose comments and likes the details panel
 * shows; undefined anywhere else (the timeline, a person, a public page).
 */
export const AlbumThreadContext = createContext<string | undefined>(undefined);
