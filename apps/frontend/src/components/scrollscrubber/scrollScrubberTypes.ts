import { z } from "zod";

export const ScrollerData = z.object({
  label: z.string(),
  targetY: z.number(),
  year: z.number().nullable().optional(),
  month: z.number().nullable().optional(),
  // How many photos the position stands for (a date group's tiles); the density map sizes its bars by it.
  count: z.number().optional(),
});
export type ScrollerData = z.infer<typeof ScrollerData>;

export const ScrollerPosition = z.object({
  label: z.string(),
  year: z.number().nullable().optional(),
  month: z.string().nullable().optional(),
  targetY: z.number(),
  scrollerY: z.number(),
  scrollerYPercent: z.number(),
  count: z.number().optional(),
});
export type ScrollerPosition = z.infer<typeof ScrollerPosition>;

export const ScrollerType = z.enum(["alphabet", "date", "labels"]);
export type ScrollerType = z.infer<typeof ScrollerType>;

// How the scrubber looks: a thumb with a date bubble, or a map of how many photos each month holds.
export const ScrubberStyle = z.enum(["thumb", "density"]);
export type ScrubberStyle = z.infer<typeof ScrubberStyle>;
