import React from "react";

import { useIsFirstTimeSetupQuery } from "../api_client/api";
import { FirstTimeSetupPage } from "../layouts/login/FirstTimeSetupPage";
import { LoginPage } from "../layouts/login/LoginPage";

export interface LocationState {
  from: {
    pathname: string;
  };
}

export function Login(): JSX.Element {
  const { data: isFirstTimeSetup, isLoading } = useIsFirstTimeSetupQuery();
  if (!isLoading && isFirstTimeSetup) {
    return (
      <div className="login-page">
        <FirstTimeSetupPage />
      </div>
    );
  }

  return (
    <div className="login-page">
      <LoginPage />
    </div>
  );
}
