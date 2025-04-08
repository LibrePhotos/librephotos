import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAppSelector } from '../../store/store';
import { selectIsAuthenticated } from '../../store/auth/authSelectors';

interface ProtectedRouteProps {
  requireAuth?: boolean;
  children?: React.ReactNode;
}

export function ProtectedRoute({ requireAuth = true, children }: ProtectedRouteProps) {
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const location = useLocation();

  if (requireAuth && !isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!requireAuth && isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return children ? <>{children}</> : <Outlet />;
} 