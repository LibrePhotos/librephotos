/**
 * The claims of an access token, as the backend's CustomTokenObtainPairSerializer writes them.
 * Only a type: the cookie's JWT is decoded, not validated.
 */
export type Token = {
  token_type: string;
  exp: number;
  iat: number;
  jti: string;
  // simplejwt (5.5+) writes the user id claim as a string.
  user_id: string;
  name: string;
  is_admin: boolean;
  first_name: string;
  last_name: string;
  scan_directory: string | null;
  confidence: number;
  semantic_search_topk: number;
  nextcloud_server_address?: string | null;
  nextcloud_username?: string | null;
};
