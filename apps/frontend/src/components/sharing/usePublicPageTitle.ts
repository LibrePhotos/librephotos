import { useDocumentTitle } from "@mantine/hooks";
import { useLayoutEffect } from "react";

const APP_TITLE = "LibrePhotos";

/**
 * Names the browser tab after what a share link shows, so a visitor with a few
 * shared albums open can tell the tabs apart. useDocumentTitle never restores
 * the title, so leaving the page puts the app name back.
 */
export function usePublicPageTitle(title: string | null | undefined) {
  useDocumentTitle(title ? `${title} · ${APP_TITLE}` : APP_TITLE);
  // A layout cleanup, not a passive one: useDocumentTitle sets the title in a layout
  // effect, and a left page's passive cleanup runs after the next page's layout
  // effects, so it would overwrite the next public page's title with the app name.
  useLayoutEffect(
    () => () => {
      document.title = APP_TITLE;
    },
    []
  );
}
