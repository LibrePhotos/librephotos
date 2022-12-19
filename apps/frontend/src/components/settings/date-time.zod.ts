import { z } from "zod";

const BaseDateTimeProps = z.object({
  id: z.number(),
  name: z.string(),
});

const TransformTimezoneProps = BaseDateTimeProps.extend({
  transform_tz: z.number().optional(),
  source_tz: z.string().optional(),
  report_tz: z.enum(["gps_timezonefinder", "user_default"]).optional(),
});

const PathDateTimeProps = BaseDateTimeProps.extend({
  rule_type: z.enum(["path"]),
  predefined_regexp: z.string().optional(),
});

const FilesystemDateTimeProps = TransformTimezoneProps.extend({
  rule_type: z.enum(["filesystem"]),
  file_property: z.enum(["ctime", "mtime"]),
});

const SimpleDateTimeProps = BaseDateTimeProps.extend({
  rule_type: z.enum(["path", "filesystem", "user_defined"]),
});

const SimpleExifDateTimeProps = BaseDateTimeProps.extend({
  rule_type: z.enum(["exif"]),
  exif_tag: z.enum(["EXIF:DateTime", "EXIF:DateTimeOriginal"]),
});

const ExtendedExifDateTimeProps = TransformTimezoneProps.extend({
  rule_type: z.enum(["exif"]),
  exif_tag: z.enum(["QuickTime:CreateDate", "Composite:GPSDateTime"]),
});

export const DateTimeRuleSchema = z.union([
  PathDateTimeProps,
  FilesystemDateTimeProps,
  SimpleDateTimeProps,
  SimpleExifDateTimeProps,
  ExtendedExifDateTimeProps,
]);

export type DateTimeRule = z.infer<typeof DateTimeRuleSchema>;
