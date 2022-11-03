import { z } from "zod";

const ScrollerData = z.object({
  label: z.string(),
  targetY: z.number(),
});
export type IScrollerData = z.infer<typeof ScrollerData>;

const ScrollerPositions = z.object({
  label: z.string(),
  targetY: z.number(),
  scrollerY: z.number(),
  scrollerYPercent: z.number(),
});
export type IScrollerPositions = z.infer<typeof ScrollerPositions>;

export const ScrollerType = z.enum(["alphabet", "date", "labels"]);
export type IScrollerType = z.infer<typeof ScrollerType>;

