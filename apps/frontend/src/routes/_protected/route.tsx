import { AppShell, useComputedColorScheme, useMantineTheme } from "@mantine/core";
import { createFileRoute, Navigate, Outlet } from "@tanstack/react-router";
import React from "react";
import { useIsAuthenticatedQuery } from "../../api_client/auth";
import { FooterMenu } from "../../components/menubars/FooterMenu";
import { SideMenuNarrow } from "../../components/menubars/SideMenuNarrow";
import { TopMenu } from "../../components/menubars/TopMenu";
import { KeyboardShortcuts } from "../../components/shortcuts/KeyboardShortcuts";
import { SpotlightProvider } from "../../components/spotlight";
import { UploadDropTarget, UploadProgressCard, UploadProvider } from "../../components/upload";
import { WhatsNewProvider } from "../../components/whatsnew/WhatsNewProvider";
import { FOOTER_HEIGHT, LEFT_MENU_WIDTH, TOP_MENU_HEIGHT } from "../../uiConstants";

export const Route = createFileRoute("/_protected")({
  component: AppShellProtected,
});

function AppShellProtected() {
  const colorScheme = useComputedColorScheme();
  const theme = useMantineTheme();
  // A cookie read, known on the first render: the first paint is the app shell or the redirect,
  // never a loading state of its own (#2238).
  const { data: isAuthenticated } = useIsAuthenticatedQuery();
  // Keep the query string too, so the login can return to exactly this view.
  const { pathname, search } = window.location;

  if (!isAuthenticated) {
    return <Navigate to="/login" search={{ redirect: pathname + search }} replace />;
  }

  return (
    <UploadProvider>
      {/* Here, not in __root: its search queries need a session, and login,
          signup and public pages have none (each fired 401s on load). */}
      <SpotlightProvider />
      {/* The What's new card after an update, and the dialog the account menu opens (#2305). Inside
          the upload provider: the card waits while the upload card is open. */}
      <WhatsNewProvider>
        {/* Files dropped anywhere in the app are uploaded; not on login or public pages. */}
        <UploadDropTarget>
          {/* The g chords and the ? list (#2037); the account menu opens the list too. */}
          <KeyboardShortcuts>
            <AppShell
              header={{ height: TOP_MENU_HEIGHT }}
              navbar={{ width: LEFT_MENU_WIDTH, breakpoint: "sm", collapsed: { mobile: true, desktop: false } }}
              footer={{ height: { base: FOOTER_HEIGHT, sm: 0 } }}
              transitionDuration={0}
            >
              <AppShell.Header>
                <TopMenu />
              </AppShell.Header>
              <AppShell.Navbar>
                <SideMenuNarrow />
              </AppShell.Navbar>
              <AppShell.Main
                style={{
                  backgroundColor: colorScheme === "dark" ? theme.colors.dark[8] : theme.colors.gray[0],
                }}
              >
                <Outlet />
              </AppShell.Main>
              {/* The footer is the phone navigation. A 0px footer on desktop still
              drew a 1px border and left its links in the tab order. */}
              <AppShell.Footer hiddenFrom="sm">
                <FooterMenu />
              </AppShell.Footer>
            </AppShell>
          </KeyboardShortcuts>
        </UploadDropTarget>
      </WhatsNewProvider>
      <UploadProgressCard />
    </UploadProvider>
  );
}
