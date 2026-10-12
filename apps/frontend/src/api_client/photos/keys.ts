import type { MediaType } from "../../components/photolist/mediaTypeFilter";
import type { Photoset } from "./types";

// React Query keys (AGENTS.md): every key comes from a domain factory, built hierarchically so one
// prefix invalidates a whole family, and every value a queryFn reads is part of its key.

/** The grids a photo can show up in; each is a kind under `photoGridKeys.all`. */
type PhotoGridKind =
  | "dateAlbums"
  | "dateAlbum"
  | "recentlyAdded"
  | "userAlbum"
  | "publicAlbum"
  | "autoAlbum"
  | "placeAlbum"
  | "thingsAlbum"
  | "tagAlbum"
  | "search"
  | "withoutTimestamp"
  | "sharedByMe"
  | "sharedWithMe";

/** What tells two date-album lists apart: the photoset, then the filters. */
export type DateAlbumsListKey = [
  photosetType: Photoset,
  person_id: number | undefined,
  username: string | undefined,
  folder: string | undefined,
  mediaType: MediaType | "all",
  timelineFilter: string,
];

const gridRoot = ["photoGrid"] as const;
const gridKind = <K extends PhotoGridKind>(kind: K) => [...gridRoot, kind] as const;

/**
 * Every query that feeds a photo grid sits under one root, `["photoGrid", <kind>, ...params]`. A
 * change to what a grid shows (a favourite, hidden, trash, date or stack change) refreshes all of
 * them with `invalidateQueries({ queryKey: photoGridKeys.all })`, and a new grid added here is
 * covered by construction.
 */
export const photoGridKeys = {
  all: gridRoot,
  /** Every query of one grid kind, all ids and filters. */
  kind: gridKind,
  /** A timeline-style list of day groups (timeline, favourites, person, folder, ...). */
  dateAlbumList: (listKey: DateAlbumsListKey) => [...gridKind("dateAlbums"), ...listKey] as const,
  /** Every loaded day page of one photoset's lists. */
  dateAlbumDays: (photoset: Photoset) => [...gridKind("dateAlbum"), photoset] as const,
  /**
   * One page of one day. The layout after the photoset is read back by
   * useFetchDateAlbumsQuery (getCachedDateAlbumPages): day id, page, then the list's filters.
   */
  dateAlbumDay: (
    photoset: Photoset,
    albumDateId: string,
    page: number,
    filters: [
      person_id: number | undefined,
      username: string | undefined,
      folder: string | undefined,
      mediaType: MediaType | "all",
      timelineFilter: string,
    ]
  ) => [...photoGridKeys.dateAlbumDays(photoset), albumDateId, page, ...filters] as const,
  recentlyAdded: () => gridKind("recentlyAdded"),
  /** Every view of one user album. */
  userAlbum: (id: string) => [...gridKind("userAlbum"), id] as const,
  userAlbumView: (id: string, isPublic: boolean, username: string, mediaType: MediaType) =>
    [...photoGridKeys.userAlbum(id), isPublic, username, mediaType] as const,
  publicAlbum: (slug: string) => [...gridKind("publicAlbum"), slug] as const,
  autoAlbum: (id: string) => [...gridKind("autoAlbum"), id] as const,
  placeAlbum: (id: string, mediaType: MediaType) => [...gridKind("placeAlbum"), id, mediaType] as const,
  thingsAlbum: (id: string, mediaType: MediaType) => [...gridKind("thingsAlbum"), id, mediaType] as const,
  /** Every view of one tag's album. */
  tagAlbum: (id: string) => [...gridKind("tagAlbum"), id] as const,
  tagAlbumView: (id: string, mediaType: MediaType) => [...photoGridKeys.tagAlbum(id), mediaType] as const,
  search: (term: string, mediaType: MediaType, mode: "semantic" | "grouped") =>
    [...gridKind("search"), term, mediaType, mode] as const,
  withoutTimestamp: (page: number) => [...gridKind("withoutTimestamp"), page] as const,
  sharedByMe: () => gridKind("sharedByMe"),
  sharedWithMe: () => gridKind("sharedWithMe"),
};

const photoRoot = ["photos"] as const;

/** One photo's own data (not the grids it is in). */
export const photoKeys = {
  all: photoRoot,
  /** Every photo's details. */
  details: () => [...photoRoot, "details"] as const,
  detail: (imageHash: string) => [...photoKeys.details(), imageHash] as const,
  albums: (imageHash: string) => [...photoRoot, "albums", imageHash] as const,
  metadata: (imageHash: string | undefined) => [...photoRoot, "metadata", imageHash] as const,
  publicDetail: (slug: string, imageHash: string) => [...photoRoot, "publicDetail", slug, imageHash] as const,
  shares: () => [...photoRoot, "shares"] as const,
  sharedBySlug: (slug: string) => [...photoRoot, "sharedBySlug", slug] as const,
};
