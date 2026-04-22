import { z } from "zod";

// Burst rule categories
export const BurstRuleCategory = z.enum(["hard", "soft"]);
export type BurstRuleCategory = z.infer<typeof BurstRuleCategory>;

// Burst rule types
export const BurstRuleType = z.enum([
  "exif_burst_mode",
  "exif_sequence_number",
  "filename_pattern",
  "timestamp_proximity",
  "visual_similarity",
]);
export type BurstRuleType = z.infer<typeof BurstRuleType>;

// Base properties for all burst rules
const BaseBurstRuleProps = z.object({
  id: z.number(),
  name: z.string(),
  category: BurstRuleCategory,
  enabled: z.boolean(),
  is_default: z.boolean(),
  description: z.string().optional(),
  // Optional conditions
  condition_path: z.string().optional(),
  condition_filename: z.string().optional(),
  condition_exif: z.string().optional(),
});

// EXIF Burst Mode rule (hard criterion)
const ExifBurstModeRuleProps = BaseBurstRuleProps.extend({
  rule_type: z.literal("exif_burst_mode"),
});

// EXIF Sequence Number rule (hard criterion)
const ExifSequenceNumberRuleProps = BaseBurstRuleProps.extend({
  rule_type: z.literal("exif_sequence_number"),
});

// Filename Pattern rule (hard criterion)
const FilenamePatternRuleProps = BaseBurstRuleProps.extend({
  rule_type: z.literal("filename_pattern"),
  pattern_type: z
    .enum(["all", "burst_suffix", "sequence_suffix", "bracketed_sequence", "samsung_burst", "iphone_burst", "custom"])
    .optional(),
  custom_pattern: z.string().optional(),
});

// Timestamp Proximity rule (soft criterion)
const TimestampProximityRuleProps = BaseBurstRuleProps.extend({
  rule_type: z.literal("timestamp_proximity"),
  interval_ms: z.number().optional(),
  require_same_camera: z.boolean().optional(),
});

// Visual Similarity rule (soft criterion)
const VisualSimilarityRuleProps = BaseBurstRuleProps.extend({
  rule_type: z.literal("visual_similarity"),
  similarity_threshold: z.number().optional(),
});

// Union of all burst rule types
export const BurstDetectionRule = z.union([
  ExifBurstModeRuleProps,
  ExifSequenceNumberRuleProps,
  FilenamePatternRuleProps,
  TimestampProximityRuleProps,
  VisualSimilarityRuleProps,
]);

export type BurstDetectionRule = z.infer<typeof BurstDetectionRule>;

// Predefined burst rules (all available rules)
export const PredefinedBurstRules = z.array(BurstDetectionRule);
export type PredefinedBurstRules = z.infer<typeof PredefinedBurstRules>;

// Helper to check if a rule is a hard criterion
export function isHardRule(rule: BurstDetectionRule): boolean {
  return rule.category === "hard";
}

// Helper to check if a rule is a soft criterion
export function isSoftRule(rule: BurstDetectionRule): boolean {
  return rule.category === "soft";
}

// Helper to get enabled rules
export function getEnabledRules(rules: BurstDetectionRule[]): BurstDetectionRule[] {
  return rules.filter(r => r.enabled);
}

// Helper to get hard rules
export function getHardRules(rules: BurstDetectionRule[]): BurstDetectionRule[] {
  return rules.filter(r => r.category === "hard");
}

// Helper to get soft rules
export function getSoftRules(rules: BurstDetectionRule[]): BurstDetectionRule[] {
  return rules.filter(r => r.category === "soft");
}
