import { wdyrReady } from "./wdyr";
import "@mantine/core/styles.css";
// The app's own colour variables (scrims, shadows and a few deliberate accents).
import "./theme/colors.css";
import { ApiClientProvider } from "@librephotos/api-client";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
// css
import { createRoot } from "react-dom/client";
import { apiClient, queryClient } from "./api_client/api";
import { App } from "./App";
import { i18nReady } from "./i18n";
import { installErrorReporting } from "./service/errorReporting/reportBrowserError";
import { installNewBuildReload } from "./service/newBuildReload";

const container = document.getElementById("root");
if (!container) {
  throw new Error("index.html has no #root element to render into");
}
// Uncaught errors go to the server's saved error reports (#2938), which sends nothing on its own.
installErrorReporting();
installNewBuildReload();
const root = createRoot(container);
Promise.allSettled([wdyrReady, i18nReady]).then(() =>
  root.render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={apiClient}>
        <App />
      </ApiClientProvider>
    </QueryClientProvider>
  )
);
