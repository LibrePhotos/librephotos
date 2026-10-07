// Face detection + embeddings (`service/face_recognition`, sidecar :8005)
// in process or through the sidecar, per LP_ML_FACE (see runtime.modeFor).
// Port of lp_ml::face::{FaceApi, InProcess}. Same contract as the sidecar:
// boxes are (top, right, bottom, left) ints, encodings float32 values;
// /face-encodings gives one slot per requested box (the detected face with
// IoU >= 0.3, else null). Errors are SidecarErrors so callers keep one path:
// a missing pack is "unreachable" (a stopped sidecar), a failure a 500.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import * as sidecars from "../../features/tasks/sidecars";
import { SidecarError, type DetectedFace, type FaceBox } from "../../features/tasks/sidecars";
import { dataModels, modeFor, modelSlot } from "../runtime";
import { loadRgb, type Rgb } from "./image";
import { bestFaceMatches, FacePack, normalizeModelName, type Face, type Want } from "./pack";

/** The in-process port passes its goldens: `auto` mode uses it. */
export const IMPLEMENTED = true;

export const faceMode = () => modeFor("face", IMPLEMENTED);

const IN_PROCESS = "in-process";

const unavailable = (msg: string) => new SidecarError("unreachable", "face_recognition", IN_PROCESS, `face_recognition unavailable: ${msg}`);
const failed = (msg: string) => new SidecarError("status", "face_recognition", IN_PROCESS, `face_recognition failed: ${msg}`, 500, msg);

export const packDir = (model: string) => path.join(dataModels(), "face_recognition", "models", model);

/** The selected pack is installed (some .onnx file in its directory). */
export function packPresent(model: string): boolean {
  const dir = packDir(normalizeModelName(model));
  try {
    return existsSync(dir) && readdirSync(dir).some((n) => n.endsWith(".onnx"));
  } catch {
    return false;
  }
}

async function analyzeImage(image: Rgb | (() => Promise<Rgb>), modelName: string, wanted: Want): Promise<Face[]> {
  const model = normalizeModelName(modelName);
  if (!packPresent(model)) throw unavailable(`face model ${model} is not installed`);
  const dir = packDir(model);
  let pixels: Rgb;
  try {
    pixels = typeof image === "function" ? await image() : image;
  } catch (e) {
    throw failed((e as Error).message);
  }
  const slot = modelSlot("face", dir, () => FacePack.load(dir));
  try {
    return await slot.run((pack) => pack.analyze(pixels, wanted));
  } catch (e) {
    throw failed((e as Error).message);
  }
}

const toDetected = (faces: Face[]): DetectedFace[] =>
  faces.map((f) => ({ location: f.location, encoding: f.embedding ? Array.from(f.embedding) : null }));

/** In-process `/face-locations` on a file. */
export async function detectFacesInProcess(source: string, modelName: string): Promise<DetectedFace[]> {
  return toDetected(await analyzeImage(() => loadRgb(source), modelName, "all"));
}

/** In-process `/face-locations` on pixels already in memory. */
export async function detectFacesRgb(image: Rgb, modelName: string): Promise<DetectedFace[]> {
  return toDetected(await analyzeImage(image, modelName, "all"));
}

/** In-process `/face-encodings`. */
export async function faceEncodingsInProcess(source: string, locations: FaceBox[], modelName: string): Promise<(number[] | null)[]> {
  const faces = await analyzeImage(() => loadRgb(source), modelName, locations);
  return bestFaceMatches(
    locations,
    faces.map((f) => f.location),
  ).map((i) => {
    const e = i === null ? null : faces[i].embedding;
    return e ? Array.from(e) : null;
  });
}

/** `face_recognition.detect_faces`, in process or through the sidecar. */
export function detectFaces(source: string, modelName: string): Promise<DetectedFace[]> {
  return faceMode() === "inprocess" ? detectFacesInProcess(source, modelName) : sidecars.detectFaces(source, modelName);
}

/** `face_recognition.get_face_encodings`, in process or through the sidecar. */
export function faceEncodings(source: string, locations: FaceBox[], modelName: string): Promise<(number[] | null)[]> {
  return faceMode() === "inprocess" ? faceEncodingsInProcess(source, locations, modelName) : sidecars.faceEncodings(source, locations, modelName);
}
