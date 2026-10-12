import { z } from "zod";

// A date-time rule with the params the backend's TimeExtractionRule reads
// (api/date_time_extractor.py). The predefined rules come from /predefinedrules/,
// and a user's datetime_rules is the JSON list of the rules picked from them.

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
  custom_regexp: z.string().optional(),
});

const FilesystemDateTimeProps = BaseDateTimeProps.extend({
  rule_type: z.literal("filesystem"),
  file_property: z.enum(["ctime", "mtime"]),
});

const UserDefinedDateTimeProps = BaseDateTimeProps.extend({
  rule_type: z.literal("user_defined"),
});

export const DateTimeRule = z.discriminatedUnion("rule_type", [
  ExifDateTimeProps,
  PathDateTimeProps,
  FilesystemDateTimeProps,
  UserDefinedDateTimeProps,
]);

export type DateTimeRule = z.infer<typeof DateTimeRule>;
