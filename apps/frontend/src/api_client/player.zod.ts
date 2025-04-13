import { z } from "zod";

export const PlayerSchema = z.object({
  playing: z.boolean(),
});

export type PlayerState = z.infer<typeof PlayerSchema>;
