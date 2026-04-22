import { ColorSchemeScript, MantineProvider } from "@mantine/core";
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
      <MantineProvider defaultColorScheme="auto">
        <Notifications autoClose={3000} zIndex={1001} />
        <RouterProvider router={router} />
      </MantineProvider>
    </>
  );
}
