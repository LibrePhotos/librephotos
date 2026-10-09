import { ColorSchemeScript, createTheme, MantineProvider, v8CssVariablesResolver } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import "@mantine/notifications/styles.css";
import "@mantine/spotlight/styles.css";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import React from "react";
import "./App.css";
import { routeTree } from "./routeTree.gen";
import "./i18n";

// Set up a Router instance
const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultStaleTime: 5000,
  scrollRestoration: true,
});

// Mantine 9 changed two defaults that restyle the whole app: the default radius
// went from sm to md, and light variants use solid colours instead of
// transparent ones. Keep the Mantine 8 look until the UI is reviewed for 9.
const theme = createTheme({ defaultRadius: "sm" });

// Register things for typesafety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function App() {
  return (
    <>
      <ColorSchemeScript defaultColorScheme="auto" />
      <MantineProvider defaultColorScheme="auto" theme={theme} cssVariablesResolver={v8CssVariablesResolver}>
        {/* Mantine 9 pauses every notification when one is hovered; keep 8's per-notification pause. */}
        <Notifications autoClose={3000} zIndex={1001} pauseResetOnHover="notification" />
        <RouterProvider router={router} />
      </MantineProvider>
    </>
  );
}
