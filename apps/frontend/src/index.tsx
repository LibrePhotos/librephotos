import "./wdyr";
import "@mantine/core/styles.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
// css
import { createRoot } from "react-dom/client";
import { queryClient } from "./api_client/api";
import { App } from "./App";
import { i18nReady } from "./i18n";

const container = document.getElementById("root");
const root = createRoot(container!); // createRoot(container!) if you use TypeScript
// Non-English locales are fetched on demand; wait for the saved/detected one so
// the first paint is already in the right language (English resolves at once).
i18nReady.finally(() =>
  root.render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  )
);
