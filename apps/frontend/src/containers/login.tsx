import React, { useEffect } from "react";

import { fetchUserList } from "../actions/utilActions";
import { FirstTimeSetupPage } from "../layouts/login/FirstTimeSetupPage";
import { LoginPage } from "../layouts/login/LoginPage";
import { useAppDispatch, useAppSelector } from "../store/store";

export interface LocationState {
  from: {
    pathname: string;
  };
}

export function Login(): JSX.Element {
  const { userList, fetchedUserList } = useAppSelector(state => state.util);
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(fetchUserList());
  }, [dispatch]);

  if (fetchedUserList && userList.length === 0) {
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
