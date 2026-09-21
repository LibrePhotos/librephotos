import { z } from "zod";

/** Why the web server could not serve an original file.
 *
 * `mode_bits` means the diagnosis is conclusive and the offending path is named.
 * `not_mode_bits` is the more interesting answer: the permissions along the path
 * already allow the read, so whatever refused the request is something chmod
 * cannot reach -- SELinux labelling, a remapped runtime, or a rebuilt proxy.
 */
export const MediaDiagnosticsCause = z.enum(["missing", "mode_bits", "not_mode_bits", "unknown"]);

export type MediaDiagnosticsCause = z.infer<typeof MediaDiagnosticsCause>;

export const MediaDiagnosticsRemedy = z.enum([
  "chmod",
  "mount_options",
  "mount_deeper",
  "read_only",
  "network_fs",
  "labels",
]);

export type MediaDiagnosticsRemedy = z.infer<typeof MediaDiagnosticsRemedy>;

export const MediaDiagnostics = z.object({
  path: z.string().nullable(),
  exists: z.boolean().optional(),
  readable_by_webserver: z.boolean().optional(),
  cause: MediaDiagnosticsCause,
  blocking: z
    .object({
      path: z.string(),
      kind: z.enum(["directory", "file"]),
      mode: z.string().optional(),
      uid: z.number().optional(),
      gid: z.number().optional(),
    })
    .nullable(),
  webserver: z.object({ uid: z.number(), gid: z.number() }).optional(),
  mount: z
    .object({
      point: z.string(),
      type: z.string(),
      options: z.array(z.string()).optional(),
      read_only: z.boolean(),
      permissions_from_mount: z.boolean(),
      network: z.boolean(),
    })
    .nullish(),
  // Unrecognised remedies are dropped rather than failing the whole parse: a
  // newer backend must not be able to blank out the diagnosis entirely.
  remedies: z.array(z.string()),
});

export type MediaDiagnostics = z.infer<typeof MediaDiagnostics>;
