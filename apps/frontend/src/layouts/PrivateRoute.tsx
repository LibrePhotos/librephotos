import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { selectIsAuthenticated } from "../store/auth/authSelectors";
import { useAppSelector } from "../store/store";

export function ProtectedRoutes() {
  const isAuth = useAppSelector(selectIsAuthenticated);
  const { pathname } = useLocation();

  return isAuth ? <Outlet /> : <Navigate to="login" state={{ from: pathname }} replace />;
}
