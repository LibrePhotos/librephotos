import React from "react";
import { Redirect, useLocation } from "react-router-dom";
import { LoginPage } from "../layouts/login/LoginPage";
import { selectIsAuthenticated } from "../store/auth/authSelectors";
import { FirstTimeSetupPage } from "../layouts/login/FirstTimeSetupPage";
import { useAppSelector } from "../store/store";
import { useFetchUserListQuery } from "../api_client/api";

export interface LocationState {
  from: {
    pathname: string;
  };
}

const Login = (): JSX.Element => {
  const isAuthenticated = useAppSelector(selectIsAuthenticated);

  const location = useLocation<LocationState>();
  const { count } = useFetchUserListQuery(undefined, {
    selectFromResult: ({ data }) => {
      return { count: data != null ? data.count : null };
    },
  });

  if (isAuthenticated) {
    if (location.state) {
      return <Redirect to={location.state.from.pathname} />;
    } else {
      return <Redirect to="/" />;
    }
  } else {
    if (count !== null && count === 0) {
      return (
        <div className="login-page">
          <FirstTimeSetupPage />
        </div>
      );
    } else {
      return (
        <div className="login-page">
          <LoginPage />
        </div>
      );
    }
  }
};

export default Login;
