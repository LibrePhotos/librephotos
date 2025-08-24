/// <reference types="@welldone-software/why-did-you-render" />
import whyDidYouRender from "@welldone-software/why-did-you-render";
import React from "react";

if (import.meta.env.NODE_ENV === "development" && import.meta.env.VITE_APP_WDYR === "true") {
  whyDidYouRender(React, {
    trackAllPureComponents: true,
    trackHooks: true,
  });
}
