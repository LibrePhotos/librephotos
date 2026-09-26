/// <reference types="@welldone-software/why-did-you-render" />
import React from "react";

// Loaded on demand so production builds leave it out: the library is CommonJS,
// so a static import shipped all of it (and, through it, all of lodash) even
// though the call below never runs outside the dev server. index.tsx waits for
// this before the first render, so every component is still tracked.
export const wdyrReady: Promise<void> =
  import.meta.env.DEV && import.meta.env.VITE_APP_WDYR === "true"
    ? import("@welldone-software/why-did-you-render").then(({ default: whyDidYouRender }) => {
        whyDidYouRender(React, {
          trackAllPureComponents: true,
          trackHooks: true,
        });
      })
    : Promise.resolve();
