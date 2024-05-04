import { z } from "zod";

import { notification } from "../service/notifications";
import { UserSchema } from "../store/user/user.zod";
import { api } from "./api";

type User = z.infer<typeof UserSchema>;

enum Endpoints {
  updateAvatar = "updateAvatar",
  updateUser = "updateUser",
}

export const userApi = api
  .injectEndpoints({
    endpoints: builder => ({
      [Endpoints.updateAvatar]: builder.mutation<User, { id: string; data: FormData }>({
        query: ({ id, data }) => ({
          url: `user/${id}/`,
          method: "PATCH",
          body: data,
        }),
        async onQueryStarted(_, { queryFulfilled }) {
          const { data } = await queryFulfilled;
          notification.updateUser(data.username);
        },
      }),
      [Endpoints.updateUser]: builder.mutation<User, User>({
        query: user => ({
          url: `user/${user.id}/`,
          method: "PATCH",
          body: user,
        }),
        async onQueryStarted(_, { queryFulfilled }) {
          const { data } = await queryFulfilled;
          notification.updateUser(data.username);
        },
      }),
    }),
  })
  .enhanceEndpoints<"UserSelfDetails" | "UserList" | "NextcloudDirs">({
    endpoints: {
      [Endpoints.updateAvatar]: {
        invalidatesTags: ["UserSelfDetails", "UserList"],
      },
      [Endpoints.updateUser]: {
        invalidatesTags: ["UserSelfDetails", "UserList", "NextcloudDirs"],
      },
    },
  });

export const { useUpdateAvatarMutation, useUpdateUserMutation } = userApi;
