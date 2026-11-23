import { endpoints, type Photo, type PigPhoto, type UserAlbumInfo } from "@librephotos/api-client/core";
import { serverCall } from "../server/errors";
import { client, onSessionChange, signedInUser } from "../server/session";

export type ServerHit = { imageHash: string; date: string | null; video: boolean };

function hitOf(photo: PigPhoto): ServerHit {
  return { imageHash: photo.image_hash, date: photo.date ?? null, video: photo.type === "video" };
}

let semanticFor: { userId: number; semantic: Promise<boolean> } | null = null;
onSessionChange(() => {
  if (semanticFor && semanticFor.userId !== signedInUser()) semanticFor = null;
});

function semanticSearch(userId: number): Promise<boolean> {
  if (semanticFor?.userId !== userId) {
    const semantic = serverCall(() => endpoints.fetchUserSelfDetails(client, userId)).then(
      user => (user.semantic_search_topk ?? 0) > 0,
      () => {
        semanticFor = null;
        return false;
      },
    );
    semanticFor = { userId, semantic };
  }
  return semanticFor.semantic;
}

export async function searchServer(query: string): Promise<ServerHit[]> {
  const userId = signedInUser();
  if (userId === null) return [];
  const semantic = await semanticSearch(userId);
  const result = await serverCall(() => endpoints.searchPhotos(client, query, semantic));
  return result.photosFlat.map(hitOf);
}

export type ServerPhoto = {
  caption: string | null;
  people: string[];
  tags: string[];
  favourite: boolean;
  rating: number;
  place: string | null;
  imageHash: string | null;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

function tagsOf(captions: Record<string, unknown>): string[] {
  const out = new Set<string>();
  for (const [key, value] of Object.entries(captions)) {
    if (!isRecord(value)) continue;
    for (const field of key === "places365" ? ["categories", "environment"] : ["tags"]) {
      const list = value[field];
      for (const t of Array.isArray(list) ? list : [list]) {
        const tag = text(t);
        if (tag) out.add(tag);
      }
    }
  }
  return [...out];
}

export function serverPhotoOf(photo: Photo): ServerPhoto {
  const captions = photo.captions_json ?? {};
  return {
    caption: text(captions.user_caption) ?? text(captions.im2txt),
    people: photo.people.flatMap(p => (p.name ? [p.name] : [])),
    tags: tagsOf(captions),
    favourite: photo.rating >= 4,
    rating: photo.rating,
    place: photo.search_location,
    imageHash: photo.image_hash,
  };
}

export async function fetchServerPhoto(photoId: string): Promise<ServerPhoto> {
  return serverPhotoOf(await serverCall(() => endpoints.fetchPhotoDetails(client, photoId)));
}

export function fetchServerPhotoDetails(photoId: string): Promise<Photo> {
  return serverCall(() => endpoints.fetchPhotoDetails(client, photoId));
}

export function fetchPhotoAlbums(imageHash: string): Promise<UserAlbumInfo[]> {
  return serverCall(() => endpoints.fetchPhotoAlbums(client, imageHash));
}

export function fetchAlbumList(): Promise<UserAlbumInfo[]> {
  return serverCall(() => endpoints.fetchUserAlbumsList(client));
}

export async function addToServerAlbum(album: Pick<UserAlbumInfo, "id" | "title">, photoId: string): Promise<void> {
  await serverCall(() => endpoints.addPhotosToUserAlbum(client, album.id, album.title, [photoId]));
}

export async function createServerAlbum(title: string, photoId: string): Promise<void> {
  await serverCall(() => endpoints.createUserAlbum(client, title, [photoId]));
}
