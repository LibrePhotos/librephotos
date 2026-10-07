// `faces.cluster` (face_classify.cluster_all_faces + ClusterManager) and
// `faces.train` (face_classify.train_faces); port of lp_tasks::faces::cluster.
// HDBSCAN and the MLP classifiers run in the face_cluster service (in
// process or the sidecar, src/ml/face_cluster); every read and write is here.
import { arrayLiteral, client } from "../../lib/db";
import { config } from "../../lib/config";
import { JobType, enqueue } from "../../lib/jobs";
import { decodeFaceEncoding, encodeFaceEncoding, unknownCluster } from "./faces";
import { begin, complete, fail, setProgress } from "./run";
import * as fcApi from "../../ml/face_cluster/index";
import * as sidecars from "./sidecars";
import type { Exec } from "./things";

const UNKNOWN_CLUSTER_ID = -1;

/** resolve_min_cluster_size: the user's setting when valid, else doubled for every 10x more faces. */
export function resolveMinClusterSize(userSetting: number, target: number): number {
  if (userSetting !== 0 && userSetting !== 1) return userSetting;
  if (target > 100_000) return 16;
  if (target > 10_000) return 8;
  if (target > 1_000) return 4;
  return 2;
}

/** Cluster.calculate_mean_face_encoding: numpy's axis-0 mean (sequential sum, one division). */
export function meanEncoding(rows: number[][]): number[] {
  if (!rows.length) return [];
  const acc = [...rows[0]];
  for (const r of rows.slice(1)) for (let i = 0; i < acc.length; i++) acc[i] += r[i];
  return acc.map((a) => a / rows.length);
}

/** A failed fit is stored with the sidecar's own text (Django's lrj.fail(error=err)). */
function sidecarFailure(e: unknown): Error {
  if (e instanceof sidecars.SidecarError && e.kind === "status") return new Error(e.detail ?? e.message);
  return e as Error;
}

/**
 * `cluster_all_faces`: drop the user's clusters and cluster persons (and every
 * face-less USER person, as Django does), cluster all encodings anew and queue
 * faces.train. False when clustering is disabled or the job failed.
 */
export async function clusterAllFaces(userId: number, lrjId: string | null): Promise<boolean> {
  if (!config.features.faceCluster) {
    console.info("face clustering is disabled");
    if (lrjId) await complete(lrjId);
    return false;
  }
  const jobId = await begin(lrjId, JobType.ClusterAllFaces, userId);
  await setProgress(jobId, 0, 1);
  try {
    const target = await createAllClusters(userId);
    await setProgress(jobId, target, target);
    await complete(jobId);
    await enqueue("faces.train", { user_id: userId }, { lrj: { jobType: JobType.TrainFaces, userId } });
    return true;
  } catch (e) {
    console.error(`face clustering failed: ${(e as Error).message}`);
    await fail(jobId, (e as Error).message);
    return false;
  }
}

/** The persons delete_clustered_people deletes: the user's cluster persons and every person without an owner or owned by `deleted`. */
async function doomedPersons(tx: Exec, userId: number): Promise<number[]> {
  const rs: { id: number }[] = await tx`SELECT id FROM api_person WHERE (kind IN ('CLUSTER', 'UNKNOWN') AND cluster_owner_id = ${userId})
    OR cluster_owner_id IS NULL OR cluster_owner_id = (SELECT id FROM api_user WHERE username = 'deleted' ORDER BY id LIMIT 1)`;
  return rs.map((r) => r.id);
}

/**
 * Delete persons the way Django's collector + reset_person do; USER persons
 * with an owner leave a mobile-sync tombstone (_person_tombstone).
 */
async function deletePersons(tx: Exec, ids: number[]): Promise<void> {
  if (!ids.length) return;
  const a = arrayLiteral(ids);
  await tx`INSERT INTO api_deletionlog (entity, entity_id, owner_id, deleted_at)
    SELECT 'person', v.eid, v.uid, clock_timestamp() FROM (
      SELECT p.id::text AS eid, p.cluster_owner_id AS uid FROM api_person p
      WHERE p.id = ANY(${a}::int[]) AND p.kind = 'USER' AND p.cluster_owner_id IS NOT NULL) v
    WHERE EXISTS (SELECT 1 FROM api_user u WHERE u.id = v.uid) ORDER BY v.eid, v.uid`;
  await tx`UPDATE api_face SET person_id = NULL WHERE person_id = ANY(${a}::int[])`;
  await tx`UPDATE api_face SET classification_person_id = NULL WHERE classification_person_id = ANY(${a}::int[])`;
  await tx`UPDATE api_face SET cluster_person_id = NULL WHERE cluster_person_id = ANY(${a}::int[])`;
  await tx`UPDATE api_cluster SET person_id = NULL WHERE person_id = ANY(${a}::int[])`;
  await tx`DELETE FROM api_person WHERE id = ANY(${a}::int[])`;
}

/** delete_clustered_people, delete_clusters, delete_persons_without_faces. */
async function resetClusters(tx: Exec, userId: number): Promise<void> {
  const [d] = await tx`SELECT id FROM api_user WHERE username = 'deleted' ORDER BY id LIMIT 1`;
  await deletePersons(tx, await doomedPersons(tx, userId));
  const clusters: { id: number }[] = await tx`SELECT id FROM api_cluster WHERE owner_id = ${userId} OR owner_id IS NULL OR owner_id = ${d?.id ?? null}`;
  if (clusters.length) {
    const a = arrayLiteral(clusters.map((c) => c.id));
    await tx`UPDATE api_face SET cluster_id = NULL WHERE cluster_id = ANY(${a}::int[])`;
    await tx`DELETE FROM api_cluster WHERE id = ANY(${a}::int[])`;
  }
  const faceless: { id: number }[] = await tx`SELECT pe.id FROM api_person pe WHERE pe.kind = 'USER'
    AND NOT EXISTS (SELECT 1 FROM api_face f WHERE f.person_id = pe.id)`;
  await deletePersons(
    tx,
    faceless.map((f) => f.id),
  );
}

interface FaceRow {
  id: number;
  person_id: number | null;
  encoding: string;
}

const decode = (f: FaceRow) => {
  try {
    return decodeFaceEncoding(f.encoding);
  } catch (e) {
    throw new Error(`face ${f.id}: ${(e as Error).message}`);
  }
};

type Plan =
  | { kind: "unknown"; unlabelled: number[]; labelled: number[] }
  | { kind: "split"; clusterId: number; persons: { person: number; name: string; faces: number[]; mean: string }[] }
  | { kind: "person"; clusterId: number; name: string; faces: number[]; mean: string };

/** The plan of ClusterManager.try_add_cluster for `faces` (sorted by id). */
function planCluster(clusterId: number, faces: FaceRow[], pad: number): Plan {
  const known = faces.filter((f) => f.person_id !== null);
  const unknownFaces = faces.filter((f) => f.person_id === null);
  if (clusterId === UNKNOWN_CLUSTER_ID) return { kind: "unknown", unlabelled: unknownFaces.map((f) => f.id), labelled: known.map((f) => f.id) };
  if (known.length) {
    // _split_by_person: one cluster per labelled person, in order of first appearance.
    const per = new Map<number, { ids: number[]; encs: number[][] }>();
    for (const f of known) {
      const slot = per.get(f.person_id!) ?? { ids: [], encs: [] };
      slot.ids.push(f.id);
      slot.encs.push(decode(f));
      per.set(f.person_id!, slot);
    }
    return {
      kind: "split",
      clusterId,
      persons: [...per].map(([person, s], i) => ({
        person,
        name: `Cluster ${clusterId}-${i + 1}`,
        faces: s.ids,
        mean: encodeFaceEncoding(meanEncoding(s.encs)),
      })),
    };
  }
  return {
    kind: "person",
    clusterId,
    name: `Unknown ${String(clusterId).padStart(pad, "0")}`,
    faces: unknownFaces.map((f) => f.id),
    mean: encodeFaceEncoding(meanEncoding(unknownFaces.map(decode))),
  };
}

/**
 * create_all_clusters; returns the number of encodings clustered. The reads,
 * the fit and the plan run outside any write transaction; one short
 * transaction then resets the old clusters and writes the new ones, so a
 * failed fit leaves the old clusters in place.
 */
async function createAllClusters(userId: number): Promise<number> {
  // collect_face_encodings: deleted faces take part in the fit.
  const rows: FaceRow[] = await client`SELECT f.id, f.person_id, f.encoding FROM api_face f JOIN api_photo p ON p.id = f.photo_id
    WHERE p.owner_id = ${userId} AND f.encoding IS NOT NULL AND f.encoding <> '' ORDER BY f.id`;
  const faces: sidecars.ClusterFace[] = [];
  let expected: number | null = null;
  for (const r of rows) {
    const len = r.encoding.trim().length;
    if (expected === null) expected = len;
    else if (expected !== len) {
      console.warn(`skipping face ${r.id}: encoding length differs (model changed?)`);
      continue;
    }
    faces.push({ id: r.id, encoding: r.encoding });
  }
  for (const f of faces) decode({ id: f.id, person_id: null, encoding: f.encoding });
  const target = faces.length;
  if (!target) {
    await client.begin((tx) => resetClusters(tx as unknown as Exec, userId));
    return 0;
  }
  const [s] = await client`SELECT min_cluster_size, min_samples, cluster_selection_epsilon FROM api_user WHERE id = ${userId}`;
  let labels: number[];
  try {
    labels = (
      await fcApi.clusterFaces({
        faces,
        min_cluster_size: resolveMinClusterSize(s.min_cluster_size, target),
        min_samples: s.min_samples > 0 ? s.min_samples : 1,
        cluster_selection_epsilon: s.cluster_selection_epsilon,
      })
    ).labels;
  } catch (e) {
    throw sidecarFailure(e);
  }
  const groups = new Map<number, number[]>();
  faces.forEach((f, i) => {
    const g = groups.get(labels[i]) ?? [];
    g.push(f.id);
    groups.set(labels[i], g);
  });
  const pad = String(groups.size).length;
  // Label order, then (stable) biggest group first.
  const order = [...groups].sort((a, b) => a[0] - b[0]).sort((a, b) => b[1].length - a[1].length);

  // The members as they are after the fit, with the labels the reset is about to drop already dropped.
  const doomed = new Set(await doomedPersons(client, userId));
  const currentRows: FaceRow[] = await client`SELECT f.id, f.person_id, f.encoding FROM api_face f JOIN api_photo p ON p.id = f.photo_id
    WHERE p.owner_id = ${userId} AND f.encoding IS NOT NULL AND NOT f.deleted`;
  const current = new Map<number, FaceRow>();
  for (const f of currentRows) current.set(f.id, { ...f, person_id: f.person_id !== null && doomed.has(f.person_id) ? null : f.person_id });
  let count = 0;
  const plans: Plan[] = order.map(([label, ids]) => {
    const members: FaceRow[] = [];
    for (const id of ids) {
      const f = current.get(id);
      if (f) {
        members.push(f);
        current.delete(id);
      }
    }
    members.sort((a, b) => a.id - b.id);
    const clusterId = label === UNKNOWN_CLUSTER_ID ? UNKNOWN_CLUSTER_ID : ++count;
    return planCluster(clusterId, members, pad);
  });

  await client.begin(async (txn) => {
    const tx = txn as unknown as Exec;
    await resetClusters(tx, userId);
    const unknown = await unknownCluster(tx, userId);
    for (const plan of plans) await applyCluster(tx, userId, unknown, plan);
  });
  return target;
}

async function applyCluster(tx: Exec, userId: number, unknown: number, plan: Plan): Promise<void> {
  if (plan.kind === "unknown") {
    await tx`UPDATE api_face SET cluster_id = ${unknown}, cluster_person_id = NULL WHERE id = ANY(${arrayLiteral(plan.unlabelled)}::int[])`;
    await tx`UPDATE api_face SET cluster_id = ${unknown} WHERE id = ANY(${arrayLiteral(plan.labelled)}::int[])`;
    return;
  }
  if (plan.kind === "split") {
    const ids: number[] = [];
    for (const p of plan.persons) ids.push(await clusterByName(tx, userId, p.name));
    for (let i = 0; i < plan.persons.length; i++) {
      const p = plan.persons[i];
      await tx`UPDATE api_face SET cluster_id = ${ids[i]} WHERE id = ANY(${arrayLiteral(p.faces)}::int[])`;
      await tx`UPDATE api_cluster SET cluster_id = ${plan.clusterId}, person_id = ${p.person}, mean_face_encoding = ${p.mean} WHERE id = ${ids[i]}`;
    }
    return;
  }
  const person = await clusterPerson(tx, userId, plan.name);
  const id = await clusterById(tx, userId, plan.clusterId);
  await tx`UPDATE api_face SET cluster_id = ${id}, cluster_person_id = ${person} WHERE id = ANY(${arrayLiteral(plan.faces)}::int[])`;
  await tx`UPDATE api_cluster SET name = ${`Cluster ${plan.clusterId}`}, person_id = ${person}, mean_face_encoding = ${plan.mean} WHERE id = ${id}`;
}

/** Cluster.get_or_create_cluster_by_name. */
async function clusterByName(tx: Exec, userId: number, name: string): Promise<number> {
  const [r] = await tx`SELECT id FROM api_cluster WHERE owner_id = ${userId} AND name = ${name} ORDER BY id LIMIT 1`;
  if (r) return r.id;
  const [c] = await tx`INSERT INTO api_cluster (mean_face_encoding, cluster_id, name, person_id, owner_id) VALUES ('', NULL, ${name}, NULL, ${userId}) RETURNING id`;
  return c.id;
}

/** Cluster.get_or_create_cluster_by_id. */
async function clusterById(tx: Exec, userId: number, clusterId: number): Promise<number> {
  const [r] = await tx`SELECT id FROM api_cluster WHERE owner_id = ${userId} AND cluster_id = ${clusterId} ORDER BY id LIMIT 1`;
  if (r) return r.id;
  const [c] = await tx`INSERT INTO api_cluster (mean_face_encoding, cluster_id, name, person_id, owner_id) VALUES ('', ${clusterId}, NULL, NULL, ${userId}) RETURNING id`;
  return c.id;
}

/** get_or_create_person(name, owner, KIND_CLUSTER) + cluster_owner + save(). */
async function clusterPerson(tx: Exec, userId: number, name: string): Promise<number> {
  const [r] = await tx`UPDATE api_person SET last_modified = now() WHERE id = (
      SELECT id FROM api_person WHERE name = ${name} AND cluster_owner_id = ${userId} AND kind = 'CLUSTER' ORDER BY id LIMIT 1) RETURNING id`;
  if (r) return r.id;
  const [c] = await tx`INSERT INTO api_person (name, kind, cluster_owner_id, face_count, cover_face_id, cover_photo_id, last_modified)
    VALUES (${name}, 'CLUSTER', ${userId}, 0, NULL, NULL, now()) RETURNING id`;
  return c.id;
}

// ------------------------------------------------------------ training

/** train_faces: predict for every unlabelled face the most likely person and the most likely cluster person. */
export async function trainFaces(userId: number, lrjId: string | null): Promise<boolean> {
  const jobId = await begin(lrjId, JobType.TrainFaces, userId);
  await setProgress(jobId, 1, 2);
  try {
    await train(userId, jobId);
    return true;
  } catch (e) {
    console.error(`face training failed: ${(e as Error).message}`);
    await fail(jobId, (e as Error).message);
    return false;
  }
}

async function train(userId: number, jobId: string): Promise<void> {
  const faces: { id: number; person_id: number | null; encoding: string; cluster_id: number | null }[] =
    await client`SELECT f.id, f.person_id, f.encoding, f.cluster_id FROM api_face f JOIN api_photo p ON p.id = f.photo_id
      WHERE p.owner_id = ${userId} AND f.encoding IS NOT NULL AND f.encoding <> '' AND NOT f.deleted ORDER BY f.id`;
  const clusters: { person_id: number; mean_face_encoding: string }[] = await client`SELECT c.person_id, c.mean_face_encoding
    FROM api_cluster c JOIN api_person pe ON pe.id = c.person_id WHERE c.owner_id = ${userId} AND pe.kind = 'CLUSTER' ORDER BY c.id`;
  const known: { person_id: number; encoding: string }[] = [];
  const unknown: sidecars.ClusterFace[] = [];
  const clusterOf = new Map<number, number | null>();
  for (const f of faces) {
    if (f.person_id !== null) known.push({ person_id: f.person_id, encoding: f.encoding });
    else {
      clusterOf.set(f.id, f.cluster_id);
      unknown.push({ id: f.id, encoding: f.encoding });
    }
  }
  let predictions: sidecars.FacePrediction[];
  try {
    predictions = (
      await fcApi.trainFaces({
        known,
        clusters: clusters.map((c) => ({ person_id: c.person_id, encoding: c.mean_face_encoding })),
        unknown,
      })
    ).predictions;
  } catch (e) {
    throw sidecarFailure(e);
  }
  if (!predictions.length) {
    await setProgress(jobId, 2, 2);
    await complete(jobId);
    return;
  }
  await client.begin(async (txn) => {
    const tx = txn as unknown as Exec;
    const unknownId = await unknownCluster(tx, userId);
    const rowsOut = predictions.map((p) => {
      const inUnknown = (clusterOf.get(p.id) ?? null) === unknownId;
      return {
        id: p.id,
        apply: !inUnknown,
        cluster_person: p.cluster_person_id,
        cluster_probability: inUnknown ? 0 : p.cluster_probability,
        classification_person: p.classification_person_id,
        classification_probability: p.classification_person_id !== null ? p.classification_probability : 0,
      };
    });
    await tx`UPDATE api_face AS f SET
        cluster_person_id = CASE WHEN u.apply THEN u.cluster_person ELSE f.cluster_person_id END,
        cluster_probability = u.cluster_probability,
        classification_person_id = COALESCE(u.classification_person, f.classification_person_id),
        classification_probability = u.classification_probability
      FROM jsonb_to_recordset(${JSON.stringify(rowsOut)}::text::jsonb)
        AS u(id int, apply bool, cluster_person int, cluster_probability float8, classification_person int, classification_probability float8)
      WHERE f.id = u.id`;
  });
  await setProgress(jobId, predictions.length, predictions.length);
  await complete(jobId);
}
