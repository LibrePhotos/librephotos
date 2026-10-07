// The face_cluster sidecar's /cluster, /train and /pca (Django's
// face_classify minus the ORM) on the ports of HDBSCAN, MLPClassifier and
// PCA. Port of lp_ml::face_cluster::inprocess. Pure computation: run it off
// the event loop (worker.ts). Errors are FitErrors with the Python text.
import * as hdbscan from "./hdbscan";
import { Mlp, toMatrix, type Matrix } from "./mlp";
import { pcaScores } from "./pca";

export class FitError extends Error {}

export interface ClusterFace {
  id: number;
  /** Face.encoding as stored (hex of float64 LE). */
  encoding: string;
}

export interface ClusterRequest {
  faces: ClusterFace[];
  min_cluster_size: number;
  min_samples: number;
  cluster_selection_epsilon: number;
}

export interface TrainRequest {
  known: { person_id: number; encoding: string }[];
  clusters: { person_id: number; encoding: string }[];
  unknown: ClusterFace[];
}

export interface FacePrediction {
  id: number;
  cluster_person_id: number;
  cluster_probability: number;
  classification_person_id: number | null;
  classification_probability: number;
}

/** train_faces predicts the unknown faces in pages of 100. */
const PREDICT_PAGE = 100;

/** `np.frombuffer(bytes.fromhex(encoding))`: float64 little-endian. */
export function decode(encoding: string): Float64Array {
  const compact = encoding.replace(/\s+/g, "");
  const bad = compact.search(/[^0-9a-fA-F]/);
  if (bad >= 0 || compact.length % 2) {
    throw new FitError(`non-hexadecimal number found in fromhex() arg at position ${bad >= 0 ? bad : compact.length}`);
  }
  const bytes = Buffer.from(compact, "hex");
  if (bytes.length % 8) throw new FitError("buffer size must be a multiple of element size");
  const out = new Float64Array(bytes.length / 8);
  for (let i = 0; i < out.length; i++) out[i] = bytes.readDoubleLE(i * 8);
  return out;
}

const inhomogeneous = (n: number) =>
  new FitError(
    `setting an array element with a sequence. The requested array has an inhomogeneous shape after 1 dimensions. The detected shape was (${n},) + inhomogeneous part.`,
  );

const NAN_HELP =
  "does not accept missing values encoded as NaN natively. For supervised learning, you might want to consider sklearn.ensemble.HistGradientBoostingClassifier and Regressor which accept missing values encoded as NaNs natively. Alternatively, it is possible to preprocess the data, for instance by using an imputer transformer in a pipeline or drop samples with missing values. See https://scikit-learn.org/stable/modules/impute.html You can find a list of all estimators that handle NaN values at the following page: https://scikit-learn.org/stable/modules/impute.html#estimators-that-handle-nan-values";

/** sklearn's `check_array(ensure_all_finite=True)`: the first non-finite value (row-major) names the error. */
function checkFinite(rows: Float64Array[], estimator: string) {
  for (const r of rows)
    for (const v of r) {
      if (Number.isFinite(v)) continue;
      if (Number.isNaN(v)) throw new FitError(`Input X contains NaN.\n${estimator} ${NAN_HELP}`);
      throw new FitError("Input X contains infinity or a value too large for dtype('float64').");
    }
}

/** `face_classify.filter_data`: keep the entries as long as the first. */
function filterData<T>(rows: Float64Array[], ids: T[]): [Float64Array[], T[]] {
  const expected = rows.length ? rows[0].length : 0;
  const kept: Float64Array[] = [];
  const keptIds: T[] = [];
  rows.forEach((r, i) => {
    if (r.length === expected) {
      kept.push(r);
      keptIds.push(ids[i]);
    } else console.info(`face_cluster: discarding encoding ${i} of length ${r.length} (expected ${expected})`);
  });
  return [kept, keptIds];
}

/** `most_probable_class`: the LAST class whose probability equals the highest (of all columns), else 0. */
function mostProbableClass(classes: number[], p: Float64Array, offset: number, cols: number): [number, number] {
  let highest = -Infinity;
  for (let i = 0; i < cols; i++) if (p[offset + i] > highest) highest = p[offset + i];
  let cls = 0;
  classes.forEach((c, i) => {
    if (i < cols && p[offset + i] === highest) cls = c;
  });
  return [cls, highest];
}

export function cluster(req: ClusterRequest): { ids: number[]; labels: number[] } {
  const ids = req.faces.map((f) => f.id);
  if (!ids.length) return { ids, labels: [] };
  const rows = req.faces.map((f) => decode(f.encoding));
  const d = rows[0].length;
  if (rows.some((r) => r.length !== d)) throw inhomogeneous(rows.length);
  const flat = new Float64Array(rows.length * d);
  rows.forEach((r, i) => flat.set(r, i * d));
  try {
    return { ids, labels: hdbscan.labels(flat, d, req) };
  } catch (e) {
    throw new FitError((e as Error).message);
  }
}

/** The sidecar's `_train` (Django's train_faces minus the ORM). */
/** Fits one classifier; the worker hands the known-faces fit to a second thread. */
export type Fit = (x: Matrix, y: number[]) => Promise<Mlp>;

const fitHere: Fit = async (x, y) => Mlp.fit(x, y);

export async function train(req: TrainRequest, fitElsewhere: Fit = fitHere): Promise<FacePrediction[]> {
  let known = req.known.map((f) => decode(f.encoding));
  let knownIds = req.known.map((f) => f.person_id);
  const clusters = req.clusters.map((f) => decode(f.encoding));
  const clusterIds = req.clusters.map((f) => f.person_id);
  const unknownAll = req.unknown.map((f) => decode(f.encoding));
  const unknownIdsAll = req.unknown.map((f) => f.id);

  if (known.some((r) => r.length !== known[0].length)) throw inhomogeneous(known.length);
  // The fits validate their input before the unknown faces are read.
  checkFinite(known, "MLPClassifier");
  const knownX = toMatrix(known);
  const nKnown = known.length;

  known = known.concat(clusters);
  knownIds = knownIds.concat(clusterIds);
  const [all, allIds] = filterData(known, knownIds);
  if (!all.length) {
    throw new FitError(
      "Expected 2D array, got 1D array instead:\narray=[].\nReshape your data either using array.reshape(-1, 1) if your data has a single feature or array.reshape(1, -1) if it contains a single sample.",
    );
  }
  checkFinite(all, "MLPClassifier");
  const allX = toMatrix(all);

  const [unknown, unknownIds] = filterData(unknownAll, unknownIdsAll);
  // Nothing to predict: the fits would only be thrown away.
  if (!unknown.length) return [];

  let classifier: Mlp | null;
  let clusterClassifier: Mlp;
  // Both fits at once (rayon::join in Rust); the known-faces one reports first.
  const [knownFit, allFit] = await Promise.allSettled([nKnown > 0 ? fitElsewhere(knownX, knownIds.slice(0, nKnown)) : null, fitHere(allX, allIds)]);
  if (knownFit.status === "rejected") throw new FitError((knownFit.reason as Error).message);
  if (allFit.status === "rejected") throw new FitError((allFit.reason as Error).message);
  classifier = knownFit.value;
  clusterClassifier = allFit.value;

  const predictions: FacePrediction[] = [];
  for (let start = 0; start < unknown.length; start += PREDICT_PAGE) {
    const page = unknown.slice(start, start + PREDICT_PAGE);
    const pageIds = unknownIds.slice(start, start + PREDICT_PAGE);
    checkFinite(page, "MLPClassifier");
    const x: Matrix = toMatrix(page);
    if (x.cols !== allX.cols) throw new FitError(`X has ${x.cols} features, but MLPClassifier is expecting ${allX.cols} features as input.`);
    const clusterP = clusterClassifier.predictProbaMatrix(x);
    const classP = classifier?.predictProbaMatrix(x) ?? null;
    pageIds.forEach((id, r) => {
      const [clusterPerson, clusterProbability] = mostProbableClass(clusterClassifier.classes, clusterP.data, r * clusterP.cols, clusterP.cols);
      const [classPerson, classProbability] =
        classifier && classP ? mostProbableClass(classifier.classes, classP.data, r * classP.cols, classP.cols) : [0, 0];
      predictions.push({
        id,
        cluster_person_id: clusterPerson,
        cluster_probability: clusterProbability,
        // `int(p) if p else None`: person 0 counts as none.
        classification_person_id: classPerson !== 0 ? classPerson : null,
        classification_probability: classProbability,
      });
    });
  }
  return predictions;
}

export function pca(encodings: string[]): [number, number, number][] {
  if (!encodings.length) return [];
  const rows = encodings.map(decode);
  if (rows.some((r) => r.length !== rows[0].length)) throw inhomogeneous(rows.length);
  checkFinite(rows, "PCA");
  const m = Math.min(rows.length, rows[0].length);
  if (m < 3) throw new FitError(`n_components=3 must be between 0 and min(n_samples, n_features)=${m} with svd_solver='full'`);
  return pcaScores(rows, 3).map((r) => [r[0], r[1], r[2]]);
}

export type Op =
  | { op: "cluster"; req: ClusterRequest }
  | { op: "train"; req: TrainRequest }
  | { op: "pca"; req: string[] }
  | { op: "fit"; req: { x: Matrix; y: number[] } };

export async function runOp(m: Op, fitElsewhere?: Fit): Promise<unknown> {
  if (m.op === "cluster") return cluster(m.req);
  if (m.op === "train") return train(m.req, fitElsewhere);
  if (m.op === "fit") return Mlp.fit(m.req.x, m.req.y).toParams();
  return pca(m.req);
}
