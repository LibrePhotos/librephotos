import type { Middleware, MiddlewareAPI } from "@reduxjs/toolkit";
import { isRejectedWithValue } from "@reduxjs/toolkit";
import { Endpoints } from "../../api_client/api";
import { AuthErrorSchema } from "../auth/auth.zod";
import i18n from "../../i18n";
import { notify } from "reapop";
import { toUpperCase } from "../../util/stringUtils";

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
          const title =
            action.meta.arg.endpointName === Endpoints.login && i18n.exists("login.error" + error.field)
              ? i18n.t("login.error" + error.field)
              : error.message;

          dispatch(
            notify(title, {
              title: toUpperCase(error.field),
              status: "error",
              dismissible: true,
              dismissAfter: 5000,
              position: "bottom-center",
            })
          );
        });
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return next(action);
  };
