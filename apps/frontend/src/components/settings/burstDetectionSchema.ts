import { z } from "zod";

// Burst rule categories
const BurstRuleCategory = z.enum(["hard", "soft"]);
type BurstRuleCategory = z.infer<typeof BurstRuleCategory>;

// Base properties for all burst rules. Loose: a key the schema does not know (a param added on the
// backend later) stays on the rule, so it is saved back with it.
const BaseBurstRuleProps = z
  .object({
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
  })
  .loose();

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

// A rule in a user's burst_detection_rules. The predefined rules always have these keys, but the
// backend (BurstDetectionRule.__init__ in api/stacks/burst_rules.py) fills in a missing name,
// category, enabled and is_default, so a rule saved through the API without them still applies
// and the list keeps it.
const SavedRuleDefaults = {
  name: z.string().optional(),
  category: BurstRuleCategory.optional(),
  enabled: z.boolean().optional(),
  is_default: z.boolean().optional(),
};

export const SavedBurstDetectionRule = z.union([
  ExifBurstModeRuleProps.extend(SavedRuleDefaults),
  ExifSequenceNumberRuleProps.extend(SavedRuleDefaults),
  FilenamePatternRuleProps.extend(SavedRuleDefaults),
  TimestampProximityRuleProps.extend(SavedRuleDefaults),
  VisualSimilarityRuleProps.extend(SavedRuleDefaults),
]);

export type SavedBurstDetectionRule = z.infer<typeof SavedBurstDetectionRule>;

// Whether the list shows a rule as enabled: only with enabled set to true
export function isRuleEnabled(rule: SavedBurstDetectionRule): boolean {
  return rule.enabled === true;
}

// Helper to check if a rule is a hard criterion
export function isHardRule(rule: SavedBurstDetectionRule): boolean {
  return rule.category === "hard";
}
