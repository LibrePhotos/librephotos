import { readFileSync } from "node:fs";

import { MANIFEST_PATH } from "./env";

/** The shape of manifest.json as written by `manage.py seed_fixture`. */
export type Username = "admin" | "alice" | "bob" | "carol" | "dave";
export type Role = Username | "anonymous";
export const ROLES: readonly Role[] = ["admin", "alice", "bob", "carol", "dave", "anonymous"];

export interface ManifestUser {
  id: number;
  username: Username;
  password: string;
  is_admin: boolean;
  scan_directory: string;
  photo_count: number;
}

export interface ManifestPhoto {
  id: string;
  image_hash: string;
  owner: Username;
  path: string;
  main_file: string | null;
  files: { hash: string; path: string; type: number }[];
  exif_timestamp: string | null;
  video: boolean;
  hidden: boolean;
  in_trashcan: boolean;
  removed: boolean;
  public: boolean;
  rating: number;
  is_screenshot: boolean;
  is_document: boolean;
  perceptual_hash: string | null;
  aspect_ratio: number | null;
  shared_to: Username[];
}

export interface ManifestUserAlbum {
  id: number;
  title: string;
  owner: Username;
  photos: string[];
  cover_photo: string | null;
  shared_to: Username[];
}

export interface Manifest {
  version: number;
  built_at: string;
  seed: number;
  base_data: string;
  media_root: string;
  photos_root: string;
  users: Record<Username, ManifestUser>;
  system_users: Record<string, { id: number; username: string }>;
  /** logical photo key ("alice/e2e_01") -> photo */
  photos: Record<string, ManifestPhoto>;
  /** category name -> logical photo keys */
  categories: Record<string, string[]>;
  albums: {
    user: Record<string, ManifestUserAlbum>;
    auto: { id: number; title: string; owner: Username; photo_count: number }[];
    date: { id: number; date: string | null; owner: Username; photo_count: number }[];
    thing: { id: number; title: string; thing_type: string; owner: Username; photo_count: number }[];
    place: { id: number; title: string; owner: Username; geolocation_level: number; photo_count: number }[];
  };
  shares: {
    public_album: { slug: string; album: string; album_id: number };
    expired_album: { slug: string; album: string; album_id: number };
    photo_share: { slug: string; photo: string };
    album_shared_to_carol: { album: string; album_id: number; foreign_photo: string };
  };
  persons: Record<string, { id: number; name: string; kind: string; owner: Username; face_count: number }>;
  faces: Record<string, number[]>;
  tags: { id: number; name: string; owner: Username; photo_count: number }[];
  stacks: Record<"burst" | "manual", { id: string; primary: string }>;
  duplicates: Record<"visual", { id: string }>;
  jobs: Record<"finished" | "failed" | "running", { id: number; job_id: string; job_type: number; owner: Username }>;
  scan_jobs: Record<Username, string>;
}

let cached: Manifest | null = null;

export function manifest(): Manifest {
  if (!cached) {
    cached = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
  }
  return cached;
}

export function photo(key: string): ManifestPhoto {
  const p = manifest().photos[key];
  if (!p) throw new Error(`manifest has no photo ${key}`);
  return p;
}

export function category(name: string): ManifestPhoto[] {
  const keys = manifest().categories[name];
  if (!keys) throw new Error(`manifest has no category ${name}`);
  return keys.map(photo);
}

export function user(name: Username): ManifestUser {
  return manifest().users[name];
}
