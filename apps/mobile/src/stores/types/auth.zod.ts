import { z } from 'zod'

export const AuthErrorSchema = z.object({
  data: z.object({
    errors: z
      .object({
        field: z.string(),
        message: z.string(),
      })
      .array(),
  }),
})

export const TokenSchema = z.object({
  token: z.string(),
  token_type: z.string().regex(/access|refresh/),
  exp: z.number(),
  jti: z.string(),
  user_id: z.number(),
  name: z.string(),
  is_admin: z.boolean(),
  first_name: z.string(),
  last_name: z.string(),
  scan_directory: z.string().nullable(),
  confidence: z.number(),
  semantic_search_topk: z.number(),
  nextcloud_server_address: z.string().nullable(),
  nextcloud_username: z.string().nullable(),
})

export const AuthStateSchema = z.object({
  access: TokenSchema.nullable(),
  refresh: TokenSchema.nullable(),
  error: AuthErrorSchema.nullable(),
})

export const UserSignupRequestSchema = z.object({
  username: z.string(),
  password: z.string(),
  email: z.string(),
  first_name: z.string(),
  last_name: z.string(),
})

export const UserSignupResponseSchema = z.object({
  username: z.string(),
  email: z.string(),
  first_name: z.string(),
  last_name: z.string(),
})

export const ApiLoginPostSchema = z.object({
  username: z.string(),
  password: z.string(),
})

const ApiLoginResponseSchema = z.object({
  refresh: z.string(),
  access: z.string(),
})

const ApiDeleteUserSchema = z.object({
  id: z.number(),
})

export const ApiRefreshPostSchema = z.object({ refresh: z.string() })

export const ApiRefreshResponseSchema = z.object({ access: z.string() })

export type UserSignupRequest = z.infer<typeof UserSignupRequestSchema>
export type UserSignupResponse = z.infer<typeof UserSignupResponseSchema>
export type IApiDeleteUserPost = z.infer<typeof ApiDeleteUserSchema>
export type IApiLoginPost = z.infer<typeof ApiLoginPostSchema>
export type IApiLoginResponse = z.infer<typeof ApiLoginResponseSchema>
export type IApiRefreshPost = z.infer<typeof ApiRefreshPostSchema>
export type IApiRefreshResponse = z.infer<typeof ApiRefreshResponseSchema>
export type IToken = z.infer<typeof TokenSchema>
export type IAuthError = z.infer<typeof AuthErrorSchema>
export type IAuthState = z.infer<typeof AuthStateSchema>
