import "./wdyr";

import "@mantine/core/styles.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
// css
import { createRoot } from "react-dom/client";
import "react-vis/dist/style.css";

import { App } from "./App";
import { queryClient } from "./api_client/api";

const container = document.getElementById("root");
const root = createRoot(container!); // createRoot(container!) if you use TypeScript
root.render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
);
