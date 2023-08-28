import { z } from "zod";

export type ServerStatsResponseType = z.infer<typeof ServerStatsResponse>;

// To-Do: Add a type for this
export const ServerStatsResponse = z.any();
