// Face dashboard (port of lp_api::people_faces::faces): FaceIncompleteListViewSet
// (bare array of buckets), FaceListView (DRF page of faces), SetFacePersonLabel
// and DeleteFaces. All of them only ever see the requester's own faces.
import { ApiError } from "~/lib/errors";
import { enqueue } from "~/lib/jobs";
import { jsonBody } from "~/lib/http";
import { drfPage, offset, pageRequest, validFor } from "~/lib/pagination";
import type { QueryMap } from "~/lib/query";
import { siteSettings } from "~/lib/settings";
import type { User } from "~/lib/users";
import { UNKNOWN_PERSON_NAME, absoluteUrl, faceIds, mediaUrl, pyFloatParam, statusMessage, strippedStr } from "./common";
import * as dbq from "./db";
import type { AnalysisMethod, FaceFilter, FaceListRow, Inferred } from "./db";
import * as write from "./write";

const minConfidence = (q: QueryMap) => {
  const v = q.get("min_confidence");
  return v === undefined ? 0 : pyFloatParam(v);
};

function method(q: QueryMap): AnalysisMethod {
  const m = q.get("analysis_method") ?? "clustering";
  if (m === "clustering" || m === "classification") return m;
  // Django leaves its filter unbound for any other value and crashes.
  throw ApiError.internal(`unknown analysis_method ${JSON.stringify(m)}`);
}

/** GET /api/faces/incomplete/?inferred=&analysis_method=&min_confidence= */
export async function incompleteFaces(user: User, q: QueryMap) {
  const inferred = (q.get("inferred") ?? "").toLowerCase() === "true";
  const min = minConfidence(q);
  const mode: Inferred = inferred ? { method: method(q), min } : null;
  const [persons, unknown] = await Promise.all([dbq.incompletePersons(user.id, mode), dbq.unknownFaceCount(user.id, mode)]);
  const out: object[] = persons.map((p) => ({ id: p.id, name: p.name, kind: p.kind, face_count: p.face_count }));
  if (unknown > 0) out.push({ id: 0, name: UNKNOWN_PERSON_NAME, face_count: unknown, kind: UNKNOWN_PERSON_NAME });
  return out;
}

/**
 * GET /api/faces/?person=&page=&inferred=&order_by=[&analysis_method=&min_confidence=]
 * (RegularResultsSetPagination: 100 per page, page_size up to 200).
 */
export async function listFaces(user: User, q: QueryMap, req: Request) {
  // "0" means None; any other value goes to the ORM as is, which parses it
  // like int() and crashes (500) on anything else. An empty value is only
  // falsy where the view tests it (the inferred branches).
  const rawPerson = q.get("person") ?? "0";
  let person: string | null = rawPerson === "0" ? null : rawPerson;
  const min = minConfidence(q);
  // An empty analysis_method is falsy in Django: the labelled-face query.
  const labeled =
    ((q.get("inferred") ?? "").toLowerCase() === "false" && person !== null && person !== "") || q.get("analysis_method") === "";
  if (person === "" && !labeled) person = null;
  let personId: number | null = null;
  if (person !== null) {
    const t = person.trim().replace(/_/g, "");
    if (!/^[+-]?\d+$/.test(t) || !Number.isSafeInteger(Number(t)) || Math.abs(Number(t)) > 2147483647)
      throw ApiError.internal(`person ${JSON.stringify(person)} is not a number`);
    personId = Number(t);
  }
  const filter: FaceFilter = labeled
    ? { kind: "labeled", person: personId }
    : { kind: "inferred", method: method(q), person: personId, min };
  const byDate = (q.get("order_by") ?? "").toLowerCase() === "date";
  const useCluster = filter.kind === "inferred" && filter.method === "clustering";

  let pr = pageRequest(q, "page_size", 100, 200);
  let results: FaceListRow[] = [];
  let count: number;
  if (pr.page === Infinity) {
    count = await dbq.countFaces(user.id, filter);
    pr = validFor(pr, count);
    results = await dbq.listFaces(user.id, filter, byDate, pr.pageSize, offset(pr));
  } else {
    const page = await dbq.listFaces(user.id, filter, byDate, pr.pageSize, offset(pr));
    if (page.length) {
      count = page[0].total;
      results = page;
    } else {
      count = await dbq.countFaces(user.id, filter);
      pr = validFor(pr, count);
    }
  }
  return drfPage(
    req,
    pr,
    count,
    results.map((r) => {
      const url = r.image ? mediaUrl(r.image) : null;
      return {
        id: r.id,
        image: url === null ? null : absoluteUrl(req, url),
        face_url: url,
        photo: r.photo_id,
        photo_image_hash: r.image_hash,
        timestamp: r.exif_timestamp,
        person_label_probability: useCluster ? r.cluster_probability : r.classification_probability,
      };
    }),
  );
}

/** lp_ingest::face_tags::queue: write the new face regions into the files, when the user wants that. */
export async function queueFaceTags(user: User, photoIds: (string | null)[]) {
  if (!user.saveFaceTagsToDisk) return;
  const ids = [...new Set(photoIds.filter((p): p is string => p !== null))].sort();
  if (!ids.length) return;
  try {
    await enqueue("metadata.face_tags", { photo_ids: ids });
  } catch (e) {
    console.error("could not queue the face tag write", e);
  }
}

/**
 * POST /api/labelfaces {face_ids, person_name}: label the requester's faces as
 * person_name (created on demand), or push them back to unknown with
 * "Unknown - Other". S19 side effects in one transaction.
 */
export async function labelFaces(user: User, request: Request) {
  const body = await jsonBody<unknown>(request);
  const personName = strippedStr(body, "person_name");
  if (!personName) return statusMessage(400, "person_name must not be empty");
  let target: string | null = null;
  if (personName !== UNKNOWN_PERSON_NAME) {
    if (await dbq.isClusterLabel(user.id, personName))
      return statusMessage(
        400,
        `"${personName}" is the label of a face cluster, not a person. Name the face instead of confirming the cluster.`,
      );
    target = personName;
  }
  const ids = faceIds(body);
  const { TAGGING_MODEL } = await siteSettings();
  const { person, faces } = await write.labelFaces(user.id, ids, target, TAGGING_MODEL);
  await queueFaceTags(
    user,
    faces.map((f) => f.photo_id),
  );
  const updated = faces.map((f) => {
    const url = f.image ? mediaUrl(f.image) : null;
    return {
      id: f.id,
      image: url,
      face_url: url,
      photo: f.photo_id,
      timestamp: f.exif_timestamp,
      person: person?.id ?? null,
      person_label_probability: f.cluster_probability,
      person_name: person?.name ?? UNKNOWN_PERSON_NAME,
    };
  });
  return { status: true, results: updated, updated, not_updated: [] };
}

/** POST /api/deletefaces {face_ids}: soft-delete the requester's faces. */
export async function deleteFaces(user: User, request: Request) {
  const ids = faceIds(await jsonBody<unknown>(request));
  const rows = await write.deleteFaces(user.id, ids);
  const deleted = rows.map((r) => mediaUrl(r.image ?? ""));
  return { status: true, results: deleted, not_deleted: [], deleted };
}
