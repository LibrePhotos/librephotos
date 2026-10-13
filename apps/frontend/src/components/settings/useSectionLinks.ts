import { useIsFetching, type QueryFilters } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { notification } from "../../service/notifications";
import { copyToClipboard } from "../../util/util";
import { revealSection, sectionElement, type SectionNavActions } from "./sectionNavigation";

/**
 * How long a deep link waits for the page's first loads before it scrolls anyway. Some admin queries
 * (server stats, a failing one that retries) take seconds without moving any card.
 */
const DEEP_LINK_MAX_WAIT_MS = 1500;

// Refetches of loaded queries (polling) do not move the cards; first loads do.
const FIRST_LOADS: QueryFilters = { predicate: query => query.state.status === "pending" };

/**
 * True once no query of the page is on its first load, or once the wait is over. Never in the first
 * render: the cards' queries start in their effects, so that render counts none of them.
 */
function usePageSettled(): boolean {
  const firstLoads = useIsFetching(FIRST_LOADS);
  const [started, setStarted] = useState(false);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    setStarted(true);
    const timer = window.setTimeout(() => setWaited(true), DEEP_LINK_MAX_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return started && (firstLoads === 0 || waited);
}

/**
 * The URL side of the section navigation: scrolls to the section in the hash once the page has
 * loaded (`/settings#settings-faces`), and gives the links their actions, which scroll and put the
 * id in the URL (TanStack Router location, no history entry per pick).
 */
export function useSectionLinks(): SectionNavActions {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const hash = useLocation({ select: location => location.hash });
  const settled = usePageSettled();
  // The hash this page already scrolled to, so a refetch or a re-render does not scroll again.
  const revealed = useRef("");

  useEffect(() => {
    if (!hash || hash === revealed.current || !settled) {
      return;
    }
    const element = sectionElement(hash);
    if (element) {
      revealed.current = hash;
      revealSection(element);
    }
  }, [hash, settled]);

  const goTo = useCallback(
    (id: string) => {
      revealed.current = id;
      const element = sectionElement(id);
      if (element) {
        revealSection(element);
      }
      // The scroll is ours: no reset to the top and no second scroll from the router.
      void navigate({ to: ".", hash: id, replace: true, resetScroll: false, hashScrollIntoView: false });
    },
    [navigate]
  );

  return useMemo(
    () => ({
      goTo,
      copyLink: (id: string) => {
        copyToClipboard(new URL(`#${id}`, window.location.href).href);
        notification.success(t("sectionnav.linkcopied"));
        goTo(id);
      },
    }),
    [goTo, t]
  );
}
