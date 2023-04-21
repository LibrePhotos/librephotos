import { showNotification } from "@mantine/notifications";
import type { Middleware, MiddlewareAPI } from "@reduxjs/toolkit";
import { isRejectedWithValue } from "@reduxjs/toolkit";

import { Endpoints, api } from "../../api_client/api";
import i18n from "../../i18n";
import { toUpperCase } from "../../util/stringUtils";
import { AuthErrorSchema } from "../auth/auth.zod";
import { logout } from "../auth/authSlice";

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
              showNotification({
                message: i18n.t<string>("login.error.token_not_valid"),
                title: i18n.t<string>("login.error.token"),
                color: "red",
              });
              dispatch(logout());
              dispatch(api.util.resetApiState());
              return;
            }
          }

          if (error.field !== "detail") {
            return;
          }

          const message =
            action.meta.arg.endpointName === Endpoints.login && i18n.exists(`login.error${error.field}`)
              ? i18n.t<string>(`login.error${error.field}`)
              : error.message;

          showNotification({
            message: message,
            title: toUpperCase(error.field),
            color: "red",
            //To-Do: Add Cross Icon
          });
        });
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return next(action);
  };
