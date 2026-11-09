import { createTheme, MantineProvider, Modal, PasswordInput, useMatches } from "@mantine/core";
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
import { photoListScrollRestorationKey } from "./components/photolist/photoSearch";
import { loadDayjsLocale } from "./i18n";
import { routeTree } from "./routeTree.gen";
import { controlsTheme } from "./theme/controlsTheme";
import { appCssVariablesResolver } from "./theme/cssVariables";
import dialogClasses from "./theme/dialogsTheme.module.css";
import { menuThemeComponents } from "./theme/menuTheme";
import { notificationsTheme } from "./theme/notificationsTheme";
import { BRAND_SCALE, DARK_SCALE } from "./theme/palette";
import { tooltipTheme } from "./theme/tooltipTheme";
import { appVariantColorResolver } from "./theme/variantColors";
import { FOOTER_HEIGHT, PAGE_GUTTER, PAGE_GUTTER_MOBILE, TOP_MENU_HEIGHT } from "./uiConstants";
import { firstDayOfWeek } from "./util/dateUtils";

// Set up a Router instance
const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultStaleTime: 5000,
  scrollRestoration: true,
  // A photo list's lightbox entry shares the grid entry's scroll position (#2231).
  getScrollRestorationKey: photoListScrollRestorationKey,
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
  // One accent of the app's own (theme/palette.ts), a pastel with dark text in the dark scheme, on
  // near-black surfaces: the photos supply the colour, as in Google Photos and Immich.
  primaryColor: "brand",
  primaryShade: { light: 6, dark: 2 },
  autoContrast: true,
  variantColorResolver: appVariantColorResolver,
  // `blue` is the accent too: components that name blue (35 of them) then match the primary in both
  // schemes instead of bringing a second blue.
  colors: { dark: DARK_SCALE, brand: BRAND_SCALE, blue: BRAND_SCALE },
  defaultRadius: "md",
  headings: {
    fontWeight: "700",
    sizes: {
      h1: { fontSize: "26px", lineHeight: "1.25" },
      h2: { fontSize: "22px", lineHeight: "1.3" },
      h3: { fontSize: "18px", lineHeight: "1.35" },
      h4: { fontSize: "16px", lineHeight: "1.4" },
    },
  },
  components: {
    // PasswordInput has no default size, so its text fell back to 16px next to
    // the 14px of every TextInput in the same form.
    PasswordInput: PasswordInput.extend({ defaultProps: { size: "sm" } }),
    // One title look for every dialog: plain-text titles were 16px/400 next to
    // the bold ones in components/modals.
    // One dialog look: centred, 16px corners, 24px padding, over a softly blurred page, with a
    // hairline edge in the dark scheme where the surface is close to the page (dialogsTheme.module.css).
    Modal: Modal.extend({
      defaultProps: {
        centered: true,
        // The md dialog width (components/modals/dialogSize.ts) for dialogs that set none.
        size: 520,
        radius: "lg",
        padding: 24,
        overlayProps: { backgroundOpacity: 0.55, blur: 2 },
      },
      classNames: { inner: dialogClasses.inner, content: dialogClasses.content },
      styles: modalTitleStyles,
    }),
    // Every menu and submenu fits the window and scrolls past it (#2707).
    ...menuThemeComponents,
    ...controlsTheme,
    ...notificationsTheme,
    ...tooltipTheme,
  },
});

/**
 * On a desktop, toasts come in at the top right, just below the top bar and
 * level with the page's content inset: the bottom corner is where the "Save
 * changes" dialog and the upload progress card sit, so a toast there covered
 * their buttons (a rejected save hid Cancel and Update), and right at the top
 * it covered the search field and the lightbox toolbar.
 *
 * On a phone they come in at the bottom, just above the footer menu, as Google
 * Photos' snackbar does: at the top they covered the page title and its
 * actions. While one of those bottom cards is up, they go back to the top
 * (App.module.css), so they still never cover its buttons.
 */
function AppNotifications() {
  // No SSR here, so read the media query on the first render instead of a
  // frame later (a toast fired at start-up would land in the wrong place).
  const position = useMatches<NotificationsProps["position"]>(
    { base: "bottom-center", sm: "top-right" },
    { getInitialValueInEffect: false }
  );
  return (
    <Notifications
      position={position}
      autoClose={3000}
      zIndex={1001}
      containerWidth={380}
      // Mantine 9 pauses every toast when one is hovered; keep 8's per-toast pause.
      pauseResetOnHover="notification"
      classNames={{ root: notificationClasses.notifications }}
      // Applied to every position's container; each reads the ones of its edge.
      style={{
        "--app-notifications-top": `${TOP_MENU_HEIGHT + 8}px`,
        "--app-notifications-bottom": `${FOOTER_HEIGHT + 8}px`,
        "--app-notifications-inset": `${PAGE_GUTTER}px`,
        "--app-notifications-inset-mobile": `${PAGE_GUTTER_MOBILE}px`,
      }}
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
    <MantineProvider defaultColorScheme="auto" theme={theme} cssVariablesResolver={appCssVariablesResolver}>
      <AppNotifications />
      <LocalizedDatesProvider>
        <RouterProvider router={router} />
      </LocalizedDatesProvider>
    </MantineProvider>
  );
}
