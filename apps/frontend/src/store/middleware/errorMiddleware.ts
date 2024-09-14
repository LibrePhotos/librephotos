import type { Middleware, MiddlewareAPI } from "@reduxjs/toolkit";
import { isRejectedWithValue } from "@reduxjs/toolkit";

import { Endpoints, api } from "../../api_client/api";
import { notification } from "../../service/notifications";
import { AuthErrorSchema } from "../auth/auth.zod";

export const errorMiddleware: Middleware =
  ({ dispatch }: MiddlewareAPI) =>
  next =>
  action => {
    if (isRejectedWithValue(action)) {
      if (action.meta.arg.endpointName in Endpoints) {
        const {
          data: { errors },
        } = AuthErrorSchema.parse(action.payload);
        errors.forEach(error => {
          if (error.field === "code") {
            if (error.message === "token_not_valid") {
              notification.invalidToken();
              dispatch(api.endpoints.logout.initiate());
              return;
            }
          }

          if (error.field !== "detail") {
            return;
          }

          const isLogin = action.meta.arg.endpointName === Endpoints.login;
          notification.authError(isLogin, error.field, error.message);
        });
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return next(action);
  };
