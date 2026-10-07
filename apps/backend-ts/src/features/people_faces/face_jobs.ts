// Face jobs and the face scatter plot (port of lp_api::people_faces::jobs):
// TrainFaceView, ScanFacesView (a GET that starts a job) and ClusterFaceView.
// The job handlers (faces.scan, faces.cluster, faces.train) live with the ML
// tasks; these endpoints only enqueue them with the LongRunningJob the UI polls.
import { config } from "~/lib/config";
import { json } from "~/lib/http";
import { enqueue, JobType } from "~/lib/jobs";
import type { User } from "~/lib/users";
import { mediaUrl, statusMessage } from "./common";
import * as dbq from "./db";
import { pcaScores } from "./pca";

// Rust also queues models.download first when a model is missing
// (lp_tasks::models::queue_if_missing); that check belongs to the ML tasks port.

/**
 * POST /api/trainfaces: queue faces.cluster, which back-fills encodings,
 * clusters, then queues faces.train; like Django the returned job id is the
 * clustering job's.
 */
export async function trainFaces(user: User) {
  if (!config.features.faceCluster) return statusMessage(403, "Face clustering is disabled");
  try {
    const q = await enqueue("faces.cluster", { user_id: user.id }, { lrj: { jobType: JobType.ClusterAllFaces, userId: user.id } });
    return { status: true, job_id: q.lrjId };
  } catch (e) {
    console.error("failed to queue face training", e);
    return { status: false };
  }
}

/** GET|POST /api/scanfaces: queue faces.scan. */
export async function scanFaces(user: User) {
  if (!config.features.faceDetection) return statusMessage(403, "Face detection is disabled");
  try {
    const q = await enqueue("faces.scan", { user_id: user.id, full_scan: true }, { lrj: { jobType: JobType.ScanFaces, userId: user.id } });
    return { status: true, job_id: q.lrjId };
  } catch (e) {
    console.error("could not start the face scan", e);
    return statusMessage(500, "Could not start the face scan.");
  }
}

/** seaborn's "deep" palette, cycled (api.color_palettes.hex_palette). */
const DEEP_PALETTE = ["#4c72b0", "#dd8452", "#55a868", "#c44e52", "#8172b3", "#937860", "#da8bc3", "#8c8c8c", "#ccb974", "#64b5cd"];

/** FaceEncoding: hex of little-endian f64s; null when it does not decode. */
function decodeEncoding(text: string): number[] | null {
  const t = text.trim();
  if (t.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(t)) return null;
  const bytes = Buffer.from(t, "hex");
  if (bytes.length % 8 !== 0) return null;
  const out = new Array<number>(bytes.length / 8);
  for (let i = 0; i < out.length; i++) out[i] = bytes.readDoubleLE(i * 8);
  return out;
}

/**
 * GET|POST /api/clusterfaces (face_classify.cluster_faces): every encoded face
 * of the requester projected on 3 principal components. Faces whose encoding
 * does not decode or has another length than the first are left out (Django
 * fails the whole request on them).
 */
export async function clusterFaces(user: User) {
  const [faces, persons] = await Promise.all([dbq.vizFaces(user.id), dbq.vizPersons(user.id)]);
  const rows: number[][] = [];
  const kept: dbq.VizFace[] = [];
  for (const f of faces) {
    const enc = decodeEncoding(f.encoding);
    if (enc === null) continue;
    if (rows.length && rows[0].length !== enc.length) continue;
    rows.push(enc);
    kept.push(f);
  }
  if (!kept.length) return { status: true, data: [] };
  const scores = pcaScores(rows, 3);
  const colors = new Map<number, string>();
  const names = new Map<number, string>();
  persons.forEach((p, i) => {
    colors.set(p.id, DEEP_PALETTE[i % DEEP_PALETTE.length]);
    names.set(p.id, p.name);
  });
  const data = kept.map((f, i) => {
    const person = f.person_id !== null && names.has(f.person_id) ? f.person_id : null;
    const personId = person ?? -1;
    const vis = scores[i];
    return {
      person_id: personId,
      person_name: person !== null ? names.get(person)! : "unknown",
      person_label_is_inferred: person === null,
      color: colors.get(personId) ?? "#000000",
      face_url: f.image !== null ? mediaUrl(f.image) : "",
      value: { x: vis[0], y: vis[1], size: vis[2] },
    };
  });
  return json({ status: true, data });
}
