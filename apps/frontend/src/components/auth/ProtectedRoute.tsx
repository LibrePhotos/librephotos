import React from 'react';
import { Navigate, Outlet } from '@tanstack/react-router';
import { useIsAuthenticatedQuery } from '../../api_client/auth';

interface ProtectedRouteProps {
  requireAuth?: boolean;
  children?: React.ReactNode;
}

export function ProtectedRoute({ requireAuth = true, children }: ProtectedRouteProps) {
  const { data: isAuthenticated } = useIsAuthenticatedQuery();
  const {location} = window;

  if (requireAuth && !isAuthenticated) {
    console.log("Redirecting to login");
    return <Navigate to="/login" search={{ from: location.pathname }} replace />;
  }

  return children ? <>{children}</> : <Outlet />;
} 