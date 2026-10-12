import { z } from "zod";

// The claims of an access token, as the backend's CustomTokenObtainPairSerializer
// writes them. Only a type: the cookie's JWT is decoded, not validated.
export const Token = z.object({
  token_type: z.string().regex(/access|refresh/),
  exp: z.number(),
  iat: z.number(),
  jti: z.string(),
  // simplejwt (5.5+) writes the user id claim as a string.
  user_id: z.string(),
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

export type SsoConfig = {
  enabled: boolean;
  label: string;
  providers: { id: string; name: string; login_url: string }[];
};

const _DeleteUser = z.object({
  id: z.number(),
});
export type Token = z.infer<typeof Token>;
