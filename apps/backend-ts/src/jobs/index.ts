// The job kinds this server runs. Handler modules load on the first job of
// one of their kinds (registerLazyJobs): sharp, ExifTool and ONNX Runtime stay
// out of an idle server. Keep each list in sync with its module's
// registerJob calls. Maintenance registers schedules, so it loads eagerly.
import { registerLazyJobs } from "../lib/jobs";
import "../features/jobs/maintenance";

registerLazyJobs(["albums.auto_generate", "albums.auto_titles"], () => import("../features/albums_tags/jobs"));
registerLazyJobs(["zip.build"], () => import("../features/jobs/zip"));
registerLazyJobs(["stacks.detect", "dupes.detect"], () => import("../features/stats_admin_stacks_dupes/jobs"));
registerLazyJobs(
  ["scan.user", "scan.file_group", "thumbnails.rerender", "metadata.write", "metadata.face_tags", "delete.missing_photos", "repair.file_variants", "upload.process"],
  () => import("../features/ingest/jobs"),
);
registerLazyJobs(
  ["faces.scan", "faces.cluster", "faces.train", "tags.generate", "geo.locate", "clip.embed", "similarity.build", "ocr.generate", "media.classify", "captions.generate", "models.download", "nextcloud.scan"],
  () => import("../features/tasks/jobs"),
);
