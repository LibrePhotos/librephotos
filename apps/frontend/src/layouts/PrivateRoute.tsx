import React, { FC } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { selectIsAuthenticated } from "../store/auth/authSelectors";
import { useAppSelector } from "../store/store";

// Router and Switch are needed Breaks site if not in import. DW

// export function PrivateRoute({ component: Component, path, ...rest }) {
//   const isAuthenticated = useAppSelector(state => !isRefreshTokenExpired(state));
//   return (
//     <Route
//       {...rest}
//       render={props =>
//         isAuthenticated ? (
//           <Component {...props} />
//         ) : (
//           <Redirect
//             to={{
//               pathname: "/login",
//               state: { from: props.location },
//             }}
//           />
//         )
//       }
//     />
//   );
// }

interface IProtectedRoute {
  children: JSX.Element[];
}

export function ProtectedRoute() {
  const isAuth = useAppSelector(selectIsAuthenticated);
  const location = useLocation();

  if (!isAuth) {
    console.info(Date.now(), "ProtectedRoute.isAuth: ", isAuth);
    // Redirect them to the /login page, but save the current location they were
    // trying to go to when they were redirected. This allows us to send them
    // along to that page after they login, which is a nicer user experience
    // than dropping them off on the home page.
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
