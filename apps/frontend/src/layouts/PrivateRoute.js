import React from "react";
import { connect } from "react-redux";
import { isRefreshTokenExpired } from "../reducers";
// Router and Switch are needed Breaks site if not in import. DW
import { Switch, Route, Redirect } from "react-router-dom";
import { LEFT_MENU_WIDTH, TOP_MENU_HEIGHT } from "../ui-constants";

const PrivateRoute = ({
  component: Component,
  isAuthenticated,
  showSidebar,
  ...rest
}) => {
  return (
    <Route
      {...rest}
      render={(props) =>
        isAuthenticated ? (
          <div>
            <div
              style={{
                paddingLeft: showSidebar ? LEFT_MENU_WIDTH + 5 : 5,
                paddingRight: 0,
              }}
            >
              <div style={{ paddingTop: TOP_MENU_HEIGHT }}>
                <Component {...props} />
              </div>
            </div>
          </div>
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
};

const mapStateToProps = (state) => ({
  isAuthenticated: !isRefreshTokenExpired(state),
  showSidebar: state.ui.showSidebar,
});

export default connect(mapStateToProps, null)(PrivateRoute);
