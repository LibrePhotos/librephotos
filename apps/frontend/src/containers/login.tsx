import React, { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { fetchUserList } from "../actions/utilActions";
import { FirstTimeSetupPage } from "../layouts/login/FirstTimeSetupPage";
import { LoginPage } from "../layouts/login/LoginPage";
import { selectIsAuthenticated } from "../store/auth/authSelectors";
import { useAppDispatch, useAppSelector } from "../store/store";

export interface LocationState {
  from: {
    pathname: string;
  };
}

export function Login(): JSX.Element {
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const location = useLocation();

  const { userList, fetchedUserList } = useAppSelector(state => state.util);
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(fetchUserList());
  }, [dispatch]);

  // if (isAuthenticated) {
  //   if (location.state) {
  //     // return <Navigate to="/" />;
  //     return <Navigate to="/" state={{ from: location }} />;
  //   }
  //   return <Navigate to="/" />;
  // }

  // if (fetchedUserList && userList.length === 0) {
  //   return (
  //     <div className="login-page">
  //       <FirstTimeSetupPage />
  //     </div>
  //   );
  // }

  return (
    <div className="login-page">
      <LoginPage />
    </div>
  );
}
