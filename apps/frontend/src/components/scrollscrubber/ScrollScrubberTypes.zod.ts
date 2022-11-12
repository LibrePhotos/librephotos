import { z } from "zod";

const ScrollerData = z.object({
  label: z.string(),
  targetY: z.number(),
  year: z.number().nullable().optional(),
  month: z.number().nullable().optional(),
});
export type IScrollerData = z.infer<typeof ScrollerData>;

const ScrollerPosition = z.object({
  label: z.string(),
  year: z.number().nullable().optional(),
  month: z.string().nullable().optional(),
  targetY: z.number(),
  scrollerY: z.number(),
  scrollerYPercent: z.number(),
});
export type IScrollerPosition = z.infer<typeof ScrollerPosition>;

export const ScrollerType = z.enum(["alphabet", "date", "labels"]);
export type IScrollerType = z.infer<typeof ScrollerType>;

