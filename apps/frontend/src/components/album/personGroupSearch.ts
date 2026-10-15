import { z } from "zod";

/**
 * The `?group=` search param of People and the face dashboard (#1126): a group id, or nothing
 * for everybody. A hand-typed value that is no id falls back to everybody.
 */
export const PersonGroupParam = z.number().int().positive().optional().catch(undefined);
