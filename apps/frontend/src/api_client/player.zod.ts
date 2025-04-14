import { z } from "zod";

export const Player = z.object({
  playing: z.boolean(),
});

export type Player= z.infer<typeof Player>;
