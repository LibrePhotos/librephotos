import { z } from "zod";

const ScrollerData = z.object({
  label: z.string(),
  targetY: z.number(),
  year: z.number().nullable().optional(),
  month: z.number().nullable().optional(),
});
export type ScrollerData = z.infer<typeof ScrollerData>;

const ScrollerPosition = z.object({
  label: z.string(),
  year: z.number().nullable().optional(),
  month: z.string().nullable().optional(),
  targetY: z.number(),
  scrollerY: z.number(),
  scrollerYPercent: z.number(),
});
export type ScrollerPosition = z.infer<typeof ScrollerPosition>;

export const ScrollerType = z.enum(["alphabet", "date", "labels"]);
export type ScrollerType = z.infer<typeof ScrollerType>;

