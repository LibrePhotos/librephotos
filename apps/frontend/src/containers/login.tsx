import React from "react";
import { Redirect, useLocation } from "react-router-dom";

import { useFetchUserListQuery } from "../api_client/api";
import { FirstTimeSetupPage } from "../layouts/login/FirstTimeSetupPage";
import { LoginPage } from "../layouts/login/LoginPage";
import { selectIsAuthenticated } from "../store/auth/authSelectors";
import { useAppSelector } from "../store/store";

export interface LocationState {
  from: {
    pathname: string;
  };
}

function Login(): JSX.Element {
  const isAuthenticated = useAppSelector(selectIsAuthenticated);

  const location = useLocation<LocationState>();
  const { count } = useFetchUserListQuery(undefined, {
    selectFromResult: ({ data }) => ({ count: data != null ? data.count : null }),
  });

  if (isAuthenticated) {
    if (location.state) {
      return <Redirect to={location.state.from.pathname} />;
    }
    return <Redirect to="/" />;
  }
  if (count !== null && count === 0) {
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

export default Login;
