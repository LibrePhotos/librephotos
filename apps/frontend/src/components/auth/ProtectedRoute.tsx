import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useIsAuthenticatedQuery } from '../../api_client/auth';

interface ProtectedRouteProps {
  requireAuth?: boolean;
  children?: React.ReactNode;
}

export function ProtectedRoute({ requireAuth = true, children }: ProtectedRouteProps) {
  const { data: isAuthenticated } = useIsAuthenticatedQuery();
  const location = useLocation();

  if (requireAuth && !isAuthenticated) {
    console.log("Redirecting to login");
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children ? <>{children}</> : <Outlet />;
} 