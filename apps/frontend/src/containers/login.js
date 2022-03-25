import React, { useEffect, useState } from "react";
import { connect } from "react-redux";
import { Redirect } from "react-router-dom";
import { LoginPage } from "../layouts/login/LoginPage";
import { isRefreshTokenExpired } from "../reducers";
import { fetchUserList } from "../actions/utilActions";
import { useAppDispatch, useAppSelector } from "../hooks";
import { FirstTimeSetupPage } from "../layouts/login/FirstTimeSetupPage";

const Login = (props) => {
  const dispatch = useAppDispatch();
  const { fetchedUserList, userList } = useAppSelector((state) => state.util);
  useEffect(() => {
    dispatch(fetchUserList());
  }, []);

  if (props.isAuthenticated) {
    if (props.location.state) {
      return <Redirect to={props.location.state.from.pathname} />;
    } else {
      return <Redirect to="/" />;
    }
  } else {
    if (fetchedUserList && userList.length === 0) {
      return (
        <div className="login-page">
          <FirstTimeSetupPage {...props} />
        </div>
      );
    } else {
      return (
        <div className="login-page">
          <LoginPage {...props} />
        </div>
      );
    }
  }
};

const mapStateToProps = (state) => ({
  isAuthenticated: !isRefreshTokenExpired(state),
});

const mapDispatchToProps = () => ({});

export default connect(mapStateToProps, mapDispatchToProps)(Login);
