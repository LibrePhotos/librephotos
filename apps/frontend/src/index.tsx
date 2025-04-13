import "./wdyr";

import "@mantine/core/styles.css";
import "font-awesome/css/font-awesome.min.css";
import React from "react";
// css
import { createRoot } from "react-dom/client";
import "react-leaflet-markercluster/dist/styles.min.css";
import "react-vis/dist/style.css";

import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './api_client/api';

import { App } from "./App";

const container = document.getElementById("root");
const root = createRoot(container!); // createRoot(container!) if you use TypeScript
root.render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
);
