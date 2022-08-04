import React from "react";

import { useFetchUserListQuery } from "../api_client/api";
import { FirstTimeSetupPage } from "../layouts/login/FirstTimeSetupPage";
import { LoginPage } from "../layouts/login/LoginPage";

export interface LocationState {
  from: {
    pathname: string;
  };
}

export function Login(): JSX.Element {
  const { data: userList, isLoading } = useFetchUserListQuery();

  if (!isLoading && userList && userList.count == 0) {
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
