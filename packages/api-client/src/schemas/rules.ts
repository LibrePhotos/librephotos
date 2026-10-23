import { z } from "zod";

/* ---- date-time rules --------------------------------------------------- *
 * A date-time rule with the params the backend's TimeExtractionRule reads
 * (api/metadata/datetime_rules.py). The predefined rules come from
 * /predefinedrules/, and a user's datetime_rules is the JSON list of the rules
 * picked from them.
 * ----------------------------------------------------------------------- */

/** "utc", "gps_timezonefinder", "server_local", "user_default" or "name:<timezone>". */
const TimezoneDescription = z.string();

// Loose: a key the schema does not know (a param added on the backend later) stays on the rule, so
// it is saved back with it.
const BaseDateTimeProps = z
  .object({
    id: z.number(),
    name: z.string(),
    // The predefined rules always have it; a rule saved before the flag was added (2022-12) does not.
    is_default: z.boolean().optional(),
    // A rule written in the settings' rule form (#2272), with an id from DateRuleOptions.first_custom_id up.
    custom: z.boolean().optional(),
    // The rule only applies to a file whose full path, filename or ExifTool tag
    // ("<tag name>//<regexp>") matches.
    condition_path: z.string().optional(),
    condition_filename: z.string().optional(),
    condition_exif: z.string().optional(),
    // With transform_tz set, the time read in source_tz is reported in report_tz.
    transform_tz: z.number().optional(),
    source_tz: TimezoneDescription.optional(),
    report_tz: TimezoneDescription.optional(),
  })
  .loose();

const ExifDateTimeProps = BaseDateTimeProps.extend({
  rule_type: z.literal("exif"),
  // An ExifTool tag name, such as "EXIF:DateTimeOriginal" or "XMP:DateCreated".
  exif_tag: z.string(),
});

const PathDateTimeProps = BaseDateTimeProps.extend({
  rule_type: z.literal("path"),
  path_part: z.enum(["filename", "full_path"]).optional(),
  predefined_regexp: z.string().optional(),
  // Older rules saved through the API; new ones cannot set it (api/metadata/date_rule_checks.py).
  custom_regexp: z.string().optional(),
  // Where the date is in the name, as "YYYY-MM-DD HH.mm.ss" (api/metadata/date_patterns.py).
  date_pattern: z.string().optional(),
});

const FilesystemDateTimeProps = BaseDateTimeProps.extend({
  rule_type: z.literal("filesystem"),
  file_property: z.enum(["ctime", "mtime"]),
});

const UserDefinedDateTimeProps = BaseDateTimeProps.extend({
  rule_type: z.literal("user_defined"),
});

// The UTC capture time in the Google Takeout JSON next to the file (api/metadata/takeout.py).
const TakeoutJsonDateTimeProps = BaseDateTimeProps.extend({
  rule_type: z.literal("takeout_json"),
});

export const DateTimeRule = z.discriminatedUnion("rule_type", [
  ExifDateTimeProps,
  PathDateTimeProps,
  FilesystemDateTimeProps,
  UserDefinedDateTimeProps,
  TakeoutJsonDateTimeProps,
]);
export type DateTimeRule = z.infer<typeof DateTimeRule>;

/** GET /api/predefinedrules/ (PREDEFINED_RULES_JSON, sent as a JSON string). */
export const PredefinedRules = z.array(DateTimeRule);
export type PredefinedRules = z.infer<typeof PredefinedRules>;

/** A tag a custom date rule may read; `utc` when its value is usually in UTC. */
export const DateTag = z.object({ name: z.string(), utc: z.boolean() });
export type DateTag = z.infer<typeof DateTag>;

/** GET /api/datetime-rules/options/: what a custom date rule may use (#2272). */
export const DateRuleOptions = z.object({
  date_tags: z.array(DateTag),
  condition_tags: z.array(z.string()),
  first_custom_id: z.number(),
});
export type DateRuleOptions = z.infer<typeof DateRuleOptions>;

/** POST /api/datetime-rules/check/: the rule, which can be saved (a 400 names each param that cannot). */
export const DateRuleCheck = z.object({ rule: z.record(z.string(), z.unknown()) });
export type DateRuleCheck = z.infer<typeof DateRuleCheck>;

/** What one saved rule reads from a photo's files. */
export const DateRuleOutcome = z.object({
  rule_id: z.number().nullable(),
  name: z.string(),
  outcome: z.enum(["applies", "not_applicable", "error"]),
  // The local wall-clock time, tagged UTC like exif_timestamp.
  local_time: z.string().nullable(),
  utc_offset: z.number().nullable(),
  error: z.string().nullable(),
});
export type DateRuleOutcome = z.infer<typeof DateRuleOutcome>;

/** GET /api/datetime-rules/test/?photo_id=: what each saved date rule reads from one photo ("Why this date?"). */
export const DateRulesTest = z.object({
  photo_id: z.string(),
  exif_timestamp: z.string().nullable(),
  date_set_by_user: z.boolean(),
  // Index in outcomes of the rule a scan takes the date from.
  winner: z.number().nullable(),
  outcomes: z.array(DateRuleOutcome),
});
export type DateRulesTest = z.infer<typeof DateRulesTest>;

/* ---- burst detection rules --------------------------------------------- *
 * api/stacks/burst_rules.py. The predefined rules come from
 * /predefinedburstrules/, and a user's burst_detection_rules is the JSON list
 * of the rules picked from them.
 * ----------------------------------------------------------------------- */

const BurstRuleCategory = z.enum(["hard", "soft"]);

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

export const BurstDetectionRule = z.union([
  ExifBurstModeRuleProps,
  ExifSequenceNumberRuleProps,
  FilenamePatternRuleProps,
  TimestampProximityRuleProps,
  VisualSimilarityRuleProps,
]);
export type BurstDetectionRule = z.infer<typeof BurstDetectionRule>;

/** GET /api/predefinedburstrules/ (PREDEFINED_RULES_JSON in api/stacks/burst_rules.py, sent as a JSON string). */
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
