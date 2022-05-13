import React from "react";
import { Redirect, Route, Switch } from "react-router-dom";

import { isRefreshTokenExpired } from "../store/auth/authSelectors";
import { useAppSelector } from "../store/store";

// Router and Switch are needed Breaks site if not in import. DW

export function PrivateRoute({ component: Component, path, ...rest }) {
  const isAuthenticated = useAppSelector(state => !isRefreshTokenExpired(state));
  return (
    <Route
      {...rest}
      render={props =>
        isAuthenticated ? (
          <Component {...props} />
        ) : (
          <Redirect
            to={{
              pathname: "/login",
              state: { from: props.location },
            }}
          />
        )
      }
    />
  );
}
