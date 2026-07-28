import { z } from "zod";

export const AuthError = z.object({
  data: z.object({
    errors: z
      .object({
        field: z.string(),
        message: z.string(),
      })
      .array(),
  }),
});

export const Token = z.object({
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
  nextcloud_server_address: z.string().nullable().optional(),
  nextcloud_username: z.string().nullable().optional(),
});

export const SsoProvider = z.object({
  id: z.string(),
  name: z.string(),
  login_url: z.string(),
});

export const SsoConfigSchema = z.object({
  enabled: z.boolean(),
  label: z.string(),
  providers: SsoProvider.array(),
});

export type SsoConfig = z.infer<typeof SsoConfigSchema>;

export const AuthState = z.object({
  access: Token.nullable(),
  refresh: Token.nullable(),
  error: AuthError.nullable(),
});

const _DeleteUser = z.object({
  id: z.number(),
});

export const RefreshPost = z.object({ refresh: z.string() });
export const RefreshResponse = z.object({ access: z.string() });

export type DeleteUserPost = z.infer<typeof _DeleteUser>;
export type RefreshPost = z.infer<typeof RefreshPost>;
export type RefreshResponse = z.infer<typeof RefreshResponse>;
export type Token = z.infer<typeof Token>;
export type AuthError = z.infer<typeof AuthError>;
export type AuthState = z.infer<typeof AuthState>;
