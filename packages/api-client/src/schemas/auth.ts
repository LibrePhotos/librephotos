import { z } from "zod";

export const LoginPost = z.object({
  username: z.string(),
  password: z.string(),
});
export type LoginPost = z.infer<typeof LoginPost>;

/** POST /api/auth/token/obtain/ response — the JWT access + refresh pair. */
export const LoginResponse = z.object({
  refresh: z.string(),
  access: z.string(),
});
export type LoginResponse = z.infer<typeof LoginResponse>;

export const RefreshPost = z.object({ refresh: z.string() });
export type RefreshPost = z.infer<typeof RefreshPost>;

export const RefreshResponse = z.object({ access: z.string() });
export type RefreshResponse = z.infer<typeof RefreshResponse>;

/** Decoded JWT access-token claims (LibrePhotos custom token). */
export const TokenClaims = z.object({
  token_type: z.string().optional(),
  exp: z.number(),
  jti: z.string().optional(),
  user_id: z.union([z.number(), z.string()]),
  name: z.string().optional(),
  is_admin: z.boolean().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  scan_directory: z.string().nullable().optional(),
  confidence: z.number().optional(),
  semantic_search_topk: z.number().optional(),
});
export type TokenClaims = z.infer<typeof TokenClaims>;

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
export type AuthError = z.infer<typeof AuthError>;

/** GET /api/user/ availability probe used to detect first-time setup. */
export const IsFirstTimeSetupResponse = z.object({
  isFirstTimeSetup: z.boolean(),
});
export type IsFirstTimeSetupResponse = z.infer<typeof IsFirstTimeSetupResponse>;
