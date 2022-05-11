import React from "react";
import { connect } from "react-redux";
import { Redirect, Route, Switch } from "react-router-dom";

import { isRefreshTokenExpired } from "../store/auth/authSelectors";

// Router and Switch are needed Breaks site if not in import. DW

function PrivateRoute({ component: Component, isAuthenticated, showSidebar, ...rest }) {
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

const mapStateToProps = state => ({
  isAuthenticated: !isRefreshTokenExpired(state),
  showSidebar: state.ui.showSidebar,
});

export default connect(mapStateToProps, null)(PrivateRoute);
