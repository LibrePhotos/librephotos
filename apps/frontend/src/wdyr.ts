/// <reference types="@welldone-software/why-did-you-render" />
import React from "react";

if (process.env.NODE_ENV === "development") {
  // eslint-disable-next-line import/no-extraneous-dependencies,global-require
  const whyDidYouRender = require("@welldone-software/why-did-you-render");
  // eslint-disable-next-line global-require
  const ReactRedux = require("react-redux");
  whyDidYouRender(React, {
    trackAllPureComponents: process.env.REACT_APP_WDYR === "true",
    trackExtraHooks: [[ReactRedux, "useSelector"]],
  });
}
