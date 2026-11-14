// Schemas the frontend defines inside hook files (which import React / TanStack),
// copied verbatim so the harness can parse with them. Source files are named
// next to each schema; keep them in sync.
import { z } from "zod";

import { ListUser } from "@fe/user/types";

// apps/frontend/src/api_client/user/hooks/useFetchUserListQuery.ts
export const UserListResponse = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: z.array(ListUser),
});

// apps/frontend/src/api_client/auth/hooks/useSignUpMutation.ts
export const UserSignupResponse = z.object({
  username: z.string(),
  email: z.string(),
  first_name: z.string(),
  last_name: z.string(),
});

// apps/frontend/src/api_client/auth/hooks/useIsFirstTimeSetupQuery.ts (typed only)
export const FirstTimeSetupResponse = z.object({ isFirstTimeSetup: z.boolean() });

// apps/frontend/src/api_client/auth/hooks/useRequestPasswordResetMutation.ts
export const PasswordResetResponse = z.object({
  status: z.boolean(),
  message: z.string(),
});

// apps/frontend/src/api_client/auth/hooks/useConfirmPasswordResetMutation.ts
export const PasswordResetConfirmResponse = z.object({
  status: z.boolean(),
  message: z.string(),
});

// apps/frontend/src/api_client/settings/hooks/useEmailConfig.ts
export const EmailTestResponse = z.object({
  status: z.boolean(),
  message: z.string(),
});

// /api/predefinedburstrules/ is JSON.parse'd into BurstDetectionRule[]
// (components/settings/burst-detection.zod.ts); the list UI reads these keys.
export const PredefinedBurstRule = z.object({
  id: z.number(),
  name: z.string(),
  rule_type: z.string(),
  category: z.string(),
  enabled: z.boolean(),
  is_default: z.boolean(),
});

// /api/predefinedrules/ is JSON.parse'd into PredefinedRules (string[] in types,
// but the rule editor reads rule objects with id/name/rule_type).
export const PredefinedDateRule = z.object({
  id: z.number(),
  name: z.string(),
  rule_type: z.string(),
});
