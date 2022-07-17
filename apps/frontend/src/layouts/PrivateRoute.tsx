import React from "react";
import { Navigate, Outlet } from "react-router-dom";

import { selectIsAuthenticated } from "../store/auth/authSelectors";
import { useAppSelector } from "../store/store";

export function ProtectedRoute() {
  const isAuth = useAppSelector(selectIsAuthenticated);

  if (!isAuth) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
