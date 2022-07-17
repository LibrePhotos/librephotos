import { showNotification } from "@mantine/notifications";
import type { Middleware, MiddlewareAPI } from "@reduxjs/toolkit";
import { isRejectedWithValue } from "@reduxjs/toolkit";

import { Endpoints } from "../../api_client/api";
import i18n from "../../i18n";
import { toUpperCase } from "../../util/stringUtils";
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
          const title =
            action.meta.arg.endpointName === Endpoints.login && i18n.exists(`login.error${error.field}`)
              ? i18n.t<string>(`login.error${error.field}`)
              : error.message;

          showNotification({
            message: title,
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
