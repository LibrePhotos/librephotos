/// <reference types="@welldone-software/why-did-you-render" />
import React from "react";

// To-Do: Enable REACT_APP_WDYR in docker dev environment
if (process.env.NODE_ENV === "development" && process.env.REACT_APP_WDYR === "true") {
  // eslint-disable-next-line import/no-extraneous-dependencies,global-require
  const whyDidYouRender = require("@welldone-software/why-did-you-render");
  // eslint-disable-next-line global-require
  const ReactRedux = require("react-redux");
  whyDidYouRender(React, {
    trackAllPureComponents: true,
    trackHooks: true,
    trackExtraHooks: [[ReactRedux, "useAppSelector"]],
  });
}
