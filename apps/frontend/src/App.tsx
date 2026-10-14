import { createTheme, MantineProvider, Modal, PasswordInput, useMatches, v8CssVariablesResolver } from "@mantine/core";
import { DatesProvider } from "@mantine/dates";
import { Notifications, type NotificationsProps } from "@mantine/notifications";
import "@mantine/notifications/styles.css";
import "@mantine/spotlight/styles.css";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import notificationClasses from "./App.module.css";
import { NotFoundPage, RouteErrorPage } from "./components/common/RouteFallbacks";
import { modalTitleStyles } from "./components/modals/modalTitleStyles";
import { loadDayjsLocale } from "./i18n";
import { routeTree } from "./routeTree.gen";
import { TOP_MENU_HEIGHT } from "./uiConstants";
import { firstDayOfWeek } from "./util/dateUtils";

// Set up a Router instance
const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultStaleTime: 5000,
  scrollRestoration: true,
  // Router-wide defaults rather than root-route options: every route then gets
  // its own boundary, so a page that crashes (or throws notFound()) is replaced
  // inside its layout and keeps the header and menu. A root notFoundComponent
  // would pull every not-found up to the root.
  defaultNotFoundComponent: NotFoundPage,
  defaultErrorComponent: RouteErrorPage,
});

// Register things for typesafety
declare module "@tanstack/react-router" {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- module augmentation merges into the router's interface
  interface Register {
    router: typeof router;
  }
}

const theme = createTheme({
  // Mantine 9 changed two defaults that restyle the whole app: the default radius
  // went from sm to md, and light variants use solid colours instead of
  // transparent ones (v8CssVariablesResolver below). Keep the Mantine 8 look
  // until the UI is reviewed for 9.
  defaultRadius: "sm",
  components: {
    // PasswordInput has no default size, so its text fell back to 16px next to
    // the 14px of every TextInput in the same form.
    PasswordInput: PasswordInput.extend({ defaultProps: { size: "sm" } }),
    // One title look for every dialog: plain-text titles were 16px/400 next to
    // the bold ones in components/modals.
    Modal: Modal.extend({ styles: modalTitleStyles }),
  },
});

/**
 * Toasts come in at the top, just below the top bar. The bottom corner is where
 * the "Save changes" dialog, the upload progress card and, on a phone, the
 * footer menu sit, so a toast there covered their buttons (a rejected save hid
 * Cancel and Update); right at the top it covered the search field and the
 * lightbox toolbar.
 */
function AppNotifications() {
  // No SSR here, so read the media query on the first render instead of a
  // frame later (a toast fired at start-up would land in the wrong place).
  const position = useMatches<NotificationsProps["position"]>(
    { base: "top-center", sm: "top-right" },
    { getInitialValueInEffect: false }
  );
  return (
    <Notifications
      position={position}
      autoClose={3000}
      zIndex={1001}
      // Mantine 9 pauses every toast when one is hovered; keep 8's per-toast pause.
      pauseResetOnHover="notification"
      classNames={{ root: notificationClasses.notifications }}
      // Applied to every position's container; only the top ones read it.
      style={{ "--app-notifications-top": `${TOP_MENU_HEIGHT + 8}px` }}
    />
  );
}

/** Date pickers in the UI language (Mantine formats them with dayjs, "en" by default). */
function LocalizedDatesProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const { i18n } = useTranslation();
  const [locale, setLocale] = useState("en");

  useEffect(() => {
    let current = true;
    loadDayjsLocale(i18n.resolvedLanguage).then(name => {
      if (current) setLocale(name);
    });
    return () => {
      current = false;
    };
  }, [i18n.resolvedLanguage]);

  return <DatesProvider settings={{ locale, firstDayOfWeek: firstDayOfWeek() }}>{children}</DatesProvider>;
}

export function App() {
  // No ColorSchemeScript here: React never runs a <script> it renders, so the
  // equivalent inline script lives in index.html's <head>.
  return (
    <MantineProvider defaultColorScheme="auto" theme={theme} cssVariablesResolver={v8CssVariablesResolver}>
      <AppNotifications />
      <LocalizedDatesProvider>
        <RouterProvider router={router} />
      </LocalizedDatesProvider>
    </MantineProvider>
  );
}
