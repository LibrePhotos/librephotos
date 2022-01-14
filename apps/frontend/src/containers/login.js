import React from "react";
import { connect } from "react-redux";
import { Redirect } from "react-router-dom";
import { LoginPage } from "../layouts/login/LoginPage";
import { isRefreshTokenExpired } from "../reducers";

const Login = (props) => {
  if (props.isAuthenticated) {
    if (props.location.state) {
      return <Redirect to={props.location.state.from.pathname} />;
    } else {
      return <Redirect to="/" />;
    }
  } else {
    return (
      <div className="login-page">
        <LoginPage {...props} />
      </div>
    );
  }
};

const mapStateToProps = (state) => ({
  isAuthenticated: !isRefreshTokenExpired(state),
});

const mapDispatchToProps = () => ({});

export default connect(mapStateToProps, mapDispatchToProps)(Login);
