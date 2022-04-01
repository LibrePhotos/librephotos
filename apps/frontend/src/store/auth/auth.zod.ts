import { z } from "zod";

export const AuthErrorSchema = z.object({
  data: z.object({
    errors: z
      .object({
        field: z.string(),
        message: z.string(),
      })
      .array(),
  }),
});

export const TokenSchema = z.object({
  token: z.string(),
  token_type: z.string().regex(/access|refresh/), // "token_type": "access",
  exp: z.number(), //   "exp": 1648930590,
  jti: z.string(), //   "jti": "7d967fde7e384e77a01837def56fe826",
  user_id: z.number(), //   "user_id": 1,
  name: z.string(), //   "name": "admin",
  is_admin: z.boolean(), //   "is_admin": true,
  first_name: z.string(), //  "first_name": "Daniel",
  last_name: z.string(), //   "last_name": "Einars",
  scan_directory: z.string().nullable(), //   "scan_directory": "/data",
  confidence: z.number(), //   "confidence": 0.1,
  semantic_search_topk: z.number(), //   "semantic_search_topk": 0,
  nextcloud_server_address: z.string().nullable(), //   "nextcloud_server_address": null,
  nextcloud_username: z.string().nullable(), //   "nextcloud_username": null
});

export const AuthStateSchema = z.object({
  access: TokenSchema.nullable(),
  refresh: TokenSchema.nullable(),
  error: AuthErrorSchema.nullable(),
});

export const ApiUserSignUpPostSchema = z.object({
  username: z.string(),
  password: z.string(),
  email: z.string(),
  firstname: z.string(),
  lastname: z.string(),
  is_superuser: z.boolean(),
});

export const ApiLoginPostSchema = z.object({
  username: z.string(),
  password: z.string(),
});

const ApiLoginResponseSchema = z.object({
  refresh: z.string(),
  access: z.string(),
});

export const ApiRefreshPostSchema = z.object({ refresh: z.string() });

export const ApiRefreshResponseSchema = z.object({ access: z.string() });

export type IApiUserSignUpPost = z.infer<typeof ApiUserSignUpPostSchema>;
export type IApiLoginPost = z.infer<typeof ApiLoginPostSchema>;
export type IApiLoginResponse = z.infer<typeof ApiLoginResponseSchema>;
export type IApiRefreshPost = z.infer<typeof ApiRefreshPostSchema>;
export type IApiRefreshResponse = z.infer<typeof ApiRefreshResponseSchema>;
export type IToken = z.infer<typeof TokenSchema>;
export type IAuthError = z.infer<typeof AuthErrorSchema>;
export type IAuthState = z.infer<typeof AuthStateSchema>;
