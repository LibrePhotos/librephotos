import { wdyrReady } from "./wdyr";
import "@mantine/core/styles.css";
// Every Mantine extension needs its stylesheet once, after core's. Imported
// here rather than next to the components: with route code splitting a page
// could otherwise render a picker or chart before its CSS chunk was loaded.
import "@mantine/carousel/styles.css";
import "@mantine/charts/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/tiptap/styles.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { ApiClientProvider } from "@librephotos/api-client";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
// css
import { createRoot } from "react-dom/client";
import { apiClient, queryClient } from "./api_client/api";
import { App } from "./App";
import { i18nReady } from "./i18n";

const container = document.getElementById("root");
if (!container) {
  throw new Error("index.html has no #root element to render into");
}
const root = createRoot(container);
// Non-English locales are fetched on demand; wait for the saved/detected one so
// the first paint is already in the right language (English resolves at once).
// Also wait for the dev-only why-did-you-render patch, so it sees every render.
Promise.allSettled([wdyrReady, i18nReady]).then(() =>
  root.render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={apiClient}>
        <App />
      </ApiClientProvider>
    </QueryClientProvider>
  )
);
