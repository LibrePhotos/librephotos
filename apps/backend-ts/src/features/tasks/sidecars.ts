// Typed HTTP clients for the Python ML sidecars (port of lp_sidecars: the
// call policy of Django's api/sidecars.py + api/http_timeouts.py, and the
// request/reply shapes per endpoint). File paths in, JSON out.
//
// Call policy: 5 s to connect, a per-sidecar read budget, three attempts in
// all for what a busy or restarting sidecar transiently does (refused or
// dropped connection, 503), 0 s then 1 s apart. A timed-out read is never
// retried: the sidecar is most likely still working on the first request.
import { config } from "../../lib/config";

export type SidecarName = "SIMILARITY" | "THUMBNAIL" | "FACE" | "CLIP" | "CAPTION" | "TAGS" | "OCR" | "FACE_CLUSTER";

interface SidecarSpec {
  /** Service directory name under apps/backend/service (error texts). */
  service: string;
  port: number;
  /** Read budget in seconds (api/http_timeouts.py). */
  timeout: number;
}

const SPECS: Record<SidecarName, SidecarSpec> = {
  SIMILARITY: { service: "image_similarity", port: 8002, timeout: 60 },
  THUMBNAIL: { service: "thumbnail", port: 8003, timeout: 120 },
  FACE: { service: "face_recognition", port: 8005, timeout: 60 },
  CLIP: { service: "clip_embeddings", port: 8006, timeout: 120 },
  CAPTION: { service: "image_captioning", port: 8007, timeout: 180 },
  TAGS: { service: "tags", port: 8011, timeout: 60 },
  OCR: { service: "ocr", port: 8012, timeout: 180 },
  // HDBSCAN / MLP fits over a whole library: Django ran them in-process
  // without any timeout.
  FACE_CLUSTER: { service: "face_cluster", port: 8013, timeout: 1800 },
};

const CONNECT_TIMEOUT_S = 5;
const RETRY_DELAYS_MS = [0, 1000];
const PREVIEW_CHARS = 500;

export function sidecarBase(name: SidecarName): string {
  return config.sidecar(name, SPECS[name].port).trim().replace(/\/+$/, "");
}

export type SidecarErrorKind = "unreachable" | "timeout" | "status" | "body";

export class SidecarError extends Error {
  constructor(
    public kind: SidecarErrorKind,
    public sidecar: string,
    public url: string,
    message: string,
    public status?: number,
    /** The sidecar's own reason for a status error. */
    public detail?: string,
  ) {
    super(message);
  }
  /** `sidecars.error_detail`: the sidecar's reason, else the error text. */
  reason(): string {
    return this.kind === "status" ? (this.detail ?? this.message) : this.message;
  }
}

/** `sidecars.error_detail`: the "error" field of a JSON reply, else the body as text (HTML reduced), at most 500 chars. */
export function errorDetail(body: string, contentType: string | null): string {
  try {
    const v = JSON.parse(body);
    if (v && typeof v === "object" && !Array.isArray(v) && "error" in v) {
      const err = v.error;
      if (typeof err === "string" && err) return err;
      if (err !== null && err !== false && typeof err !== "string") return JSON.stringify(err);
    }
  } catch {
    // not JSON
  }
  let text = body.trim();
  if (!text) return "<empty body>";
  if ((contentType ?? "").includes("html") || text.startsWith("<")) {
    text = text
      .replace(/<[^>]*>/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .join(" ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&#x27;/g, "'")
      .replace(/&amp;/g, "&");
    if (!text) return "<empty body>";
  }
  const chars = [...text];
  if (chars.length > PREVIEW_CHARS) return `${chars.slice(0, PREVIEW_CHARS).join("")}... [truncated ${chars.length - PREVIEW_CHARS} chars]`;
  return text;
}

interface Reply {
  status: number;
  body: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One logical call: retries per the policy above, a SidecarError for non-2xx (unless in `accept`). */
export async function call(
  name: SidecarName,
  method: string,
  path: string,
  body?: unknown,
  opts: { readTimeoutS?: number; retry?: boolean; accept?: number[] } = {},
): Promise<Reply> {
  const spec = SPECS[name];
  const url = sidecarBase(name) + path;
  const read = opts.readTimeoutS ?? spec.timeout;
  const attempts = opts.retry === false ? 1 : RETRY_DELAYS_MS.length + 1;
  const payload = body === undefined ? undefined : JSON.stringify(body);
  let lastUnreachable = "";
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0 && RETRY_DELAYS_MS[attempt - 1]) await sleep(RETRY_DELAYS_MS[attempt - 1]);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: payload === undefined ? undefined : { "Content-Type": "application/json" },
        body: payload,
        signal: AbortSignal.timeout((CONNECT_TIMEOUT_S + read) * 1000),
      });
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        throw new SidecarError("timeout", spec.service, url, `${spec.service} sidecar timed out after ${read} s at ${url}`);
      }
      lastUnreachable = err.code ? `${err.code}: ${err.message}` : err.message;
      continue;
    }
    if (res.status === 503 && attempt + 1 < attempts) {
      await res.arrayBuffer().catch(() => undefined);
      continue;
    }
    let text: string;
    try {
      text = await res.text();
    } catch (e) {
      const err = e as Error;
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        throw new SidecarError("timeout", spec.service, url, `${spec.service} sidecar timed out after ${read} s at ${url}`);
      }
      lastUnreachable = err.message;
      continue;
    }
    if ((res.status >= 200 && res.status < 300) || opts.accept?.includes(res.status)) return { status: res.status, body: text };
    const detail = errorDetail(text, res.headers.get("content-type"));
    throw new SidecarError(
      "status",
      spec.service,
      url,
      `${spec.service} sidecar returned status ${res.status} for ${url}: ${detail}`,
      res.status,
      detail,
    );
  }
  throw new SidecarError("unreachable", spec.service, url, `${spec.service} sidecar unreachable at ${url}: ${lastUnreachable}`);
}

function parse<T>(name: SidecarName, path: string, body: string): T {
  try {
    return JSON.parse(body) as T;
  } catch (e) {
    const url = sidecarBase(name) + path;
    throw new SidecarError(
      "body",
      SPECS[name].service,
      url,
      `${SPECS[name].service} sidecar returned an unusable reply for ${url}: ${(e as Error).message}: ${errorDetail(body, null)}`,
    );
  }
}

function bodyError(name: SidecarName, path: string, message: string): SidecarError {
  const url = sidecarBase(name) + path;
  return new SidecarError("body", SPECS[name].service, url, `${SPECS[name].service} sidecar returned an unusable reply for ${url}: ${message}`);
}

export async function postJson<T>(name: SidecarName, path: string, body: unknown): Promise<T> {
  const reply = await call(name, "POST", path, body);
  return parse<T>(name, path, reply.body);
}

// ------------------------------------------------------------- endpoints

/** (top, right, bottom, left) in big-thumbnail pixels, as Face.location_* spell it. */
export type FaceBox = [number, number, number, number];

export interface DetectedFace {
  location: FaceBox;
  /** Sent along by current sidecars; null leaves it to /face-encodings. */
  encoding: number[] | null;
}

function faceBox(loc: unknown): FaceBox | null {
  if (!Array.isArray(loc) || loc.length !== 4 || loc.some((v) => typeof v !== "number" || !Number.isFinite(v))) return null;
  return loc.map((v: number) => Math.trunc(v)) as FaceBox;
}

/** `face_recognition.detect_faces`: every face with its encoding when sent (a count mismatch drops all). */
export async function detectFaces(source: string, modelName: string): Promise<DetectedFace[]> {
  const reply = await postJson<{ face_locations: unknown[]; encodings?: (number[] | null)[] | null }>("FACE", "/face-locations", {
    source,
    model_name: modelName,
  });
  if (!Array.isArray(reply?.face_locations)) throw bodyError("FACE", "/face-locations", "no face_locations in reply");
  const n = reply.face_locations.length;
  const encodings = Array.isArray(reply.encodings) && reply.encodings.length === n ? reply.encodings : new Array(n).fill(null);
  return reply.face_locations.map((loc, i) => {
    const location = faceBox(loc);
    if (!location) throw bodyError("FACE", "/face-locations", `bad face location ${JSON.stringify(loc)}`);
    return { location, encoding: encodings[i] ?? null };
  });
}

/** `face_recognition.get_face_encodings`: one slot per location, null where no face was found. */
export async function faceEncodings(source: string, locations: FaceBox[], modelName: string): Promise<(number[] | null)[]> {
  const reply = await postJson<{ encodings: (number[] | null)[] }>("FACE", "/face-encodings", {
    source,
    face_locations: locations,
    model_name: modelName,
  });
  if (!Array.isArray(reply?.encodings)) throw bodyError("FACE", "/face-encodings", "no encodings in reply");
  return reply.encodings;
}

export interface ClipEmbeddings {
  imgs_emb: (number[] | null)[];
  magnitudes: (number | null)[];
}

/** `semantic_search.create_clip_embeddings`: one slot per path, null where unreadable. */
export async function clipEmbeddings(imgs: string[], model: string): Promise<ClipEmbeddings> {
  const r = await postJson<ClipEmbeddings>("CLIP", "/clip-embeddings", { imgs, model });
  if (!Array.isArray(r?.imgs_emb) || !Array.isArray(r?.magnitudes)) throw bodyError("CLIP", "/clip-embeddings", "missing imgs_emb/magnitudes");
  return r;
}

/** `semantic_search.calculate_query_embeddings`. */
export async function queryEmbeddings(query: string, model: string): Promise<{ emb: number[]; magnitude: number }> {
  const r = await postJson<{ emb: number[]; magnitude: number }>("CLIP", "/query-embeddings", { query, model });
  if (!Array.isArray(r?.emb)) throw bodyError("CLIP", "/query-embeddings", "missing emb");
  return r;
}

/** `image_captioning.generate_caption`: the caption, or an error carrying the sidecar's reason. */
export async function generateCaption(imagePath: string, prompt?: string): Promise<string> {
  const body: Record<string, unknown> = { image_path: imagePath };
  if (prompt !== undefined) body.prompt = prompt;
  const reply = await postJson<Record<string, unknown>>("CAPTION", "/generate-caption", body);
  const c = reply?.caption;
  if (typeof c === "string") return c;
  if (c !== undefined) return JSON.stringify(c);
  throw bodyError("CAPTION", "/generate-caption", typeof reply?.error === "string" ? reply.error : "no caption in reply");
}

/** The tags sidecar's whole JSON reply ({"tags": {...}}). */
export function generateTags(imagePath: string, confidence: number, taggingModel: string): Promise<Record<string, unknown>> {
  return postJson("TAGS", "/generate-tags", { image_path: imagePath, confidence, tagging_model: taggingModel });
}

export interface OcrResult {
  text?: string | null;
  blocks?: unknown;
  image_width?: number | null;
  image_height?: number | null;
  mean_confidence?: number | null;
  text_area_fraction?: number | null;
}

export function ocr(imagePath: string, minConfidence: number): Promise<OcrResult> {
  return postJson("OCR", "/ocr", { image_path: imagePath, min_confidence: minConfidence });
}

/** One page of an index rebuild (`image_similarity._post_build_page`). */
export function similarityBuild(page: {
  user_id: number;
  image_hashes: string[];
  image_embeddings: number[][];
  begin: boolean;
  commit: boolean;
}): Promise<{ status?: unknown; index_size?: number | null; error?: string | null }> {
  return postJson("SIMILARITY", "/build/", page);
}

/** `image_similarity.search_similar_*`; `n` omitted lets the sidecar default (100). */
export function similaritySearch(userId: number, embedding: number[], threshold: number, n?: number): Promise<{ status?: boolean; result?: unknown[] }> {
  const body: Record<string, unknown> = { user_id: userId, image_embedding: embedding };
  if (n !== undefined) body.n = n;
  body.threshold = threshold;
  return postJson("SIMILARITY", "/search/", body);
}

export interface ClusterFace {
  id: number;
  /** Face.encoding as stored (hex of float64 LE). */
  encoding: string;
}

export async function clusterFaces(req: {
  faces: ClusterFace[];
  min_cluster_size: number;
  min_samples: number;
  cluster_selection_epsilon: number;
}): Promise<{ ids: number[]; labels: number[] }> {
  const r = await postJson<{ ids: number[]; labels: number[] }>("FACE_CLUSTER", "/cluster", req);
  if (!Array.isArray(r?.labels) || r.labels.length !== req.faces.length) {
    throw bodyError("FACE_CLUSTER", "/cluster", `${Array.isArray(r?.labels) ? r.labels.length : 0} labels for ${req.faces.length} faces`);
  }
  return r;
}

export interface FacePrediction {
  id: number;
  cluster_person_id: number;
  cluster_probability: number;
  classification_person_id: number | null;
  classification_probability: number;
}

export async function trainFaces(req: {
  known: { person_id: number; encoding: string }[];
  clusters: { person_id: number; encoding: string }[];
  unknown: ClusterFace[];
}): Promise<{ predictions: FacePrediction[] }> {
  const r = await postJson<{ predictions: FacePrediction[] }>("FACE_CLUSTER", "/train", req);
  if (!Array.isArray(r?.predictions)) throw bodyError("FACE_CLUSTER", "/train", "no predictions in reply");
  return r;
}

/** 3-D PCA coordinates of the encodings (hex), in order (/api/clusterfaces). */
export async function facePca(encodings: string[]): Promise<[number, number, number][]> {
  const r = await postJson<{ coordinates: [number, number, number][] }>("FACE_CLUSTER", "/pca", { encodings });
  return r.coordinates;
}

/** `GET /health`, one attempt, 5 s. */
export async function health(name: SidecarName): Promise<Record<string, unknown>> {
  const r = await call(name, "GET", "/health", undefined, { readTimeoutS: 5, retry: false });
  return parse(name, "/health", r.body);
}
