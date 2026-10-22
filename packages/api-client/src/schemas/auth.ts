import { z } from "zod";
import { IntegerId } from "./common";

export const LoginPost = z.object({
  username: z.string(),
  password: z.string(),
  // "Remember me" (#2024): a refresh token for the server's REMEMBER_ME_DAYS and a remember_until
  // claim the web turns into persistent cookies. Older servers ignore it.
  remember_me: z.boolean().optional(),
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
  // simplejwt writes it as a string since 5.5.0, as a number before.
  user_id: IntegerId,
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

/** GET /api/firsttimesetup/: true while the instance has no admin (the login page offers sign-up). */
export const IsFirstTimeSetupResponse = z.object({
  isFirstTimeSetup: z.boolean(),
});
export type IsFirstTimeSetupResponse = z.infer<typeof IsFirstTimeSetupResponse>;

/**
 * POST /api/auth/token/blacklist/ response: simplejwt's TokenBlacklistView answers `{}`. The
 * server clears the auth cookies whatever it answers (LogoutView in librephotos/urls.py).
 */
export const LogoutResponse = z.looseObject({});
export type LogoutResponse = z.infer<typeof LogoutResponse>;

/** POST /api/user/ body: sign up (the first user becomes the admin, see IsFirstTimeSetupResponse). */
export type SignupRequest = {
  username: string;
  password: string;
  email: string;
  first_name: string;
  last_name: string;
};

/** POST /api/user/ response (SignupUserSerializer). */
export const SignupUser = z.object({
  username: z.string(),
  email: z.string(),
  first_name: z.string(),
  last_name: z.string(),
});
export type SignupUser = z.infer<typeof SignupUser>;

/** POST /api/auth/password/reset/ and .../reset/confirm/ success: `status` is always true. */
export const PasswordResetResponse = z.object({
  status: z.boolean(),
  message: z.string(),
});
export type PasswordResetResponse = z.infer<typeof PasswordResetResponse>;

/** POST /api/auth/password/reset/confirm/ body: the emailed link's uid and token plus the new password. */
export type PasswordResetConfirmRequest = { uid: string; token: string; new_password: string };

/**
 * GET /api/auth/sso/config/ (api/views/sso.py): whether the login screen offers single sign-on,
 * the button's label, and one login URL per configured OIDC provider.
 */
export const SsoConfig = z.object({
  enabled: z.boolean(),
  label: z.string(),
  providers: z.array(z.object({ id: z.string(), name: z.string(), login_url: z.string() })),
});
export type SsoConfig = z.infer<typeof SsoConfig>;
