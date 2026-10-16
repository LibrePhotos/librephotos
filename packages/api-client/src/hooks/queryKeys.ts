import type { SearchFilters, SelectAllPhotos } from "../endpoints";
import type {
  DuplicateType,
  FaceAnalysisMethod,
  FaceOrderBy,
  JobListParams,
  MetadataValueField,
  Photoset,
  ReviewStatus,
} from "../schemas";

// React Query keys for the web and mobile apps: one factory per domain, built hierarchically so one
// prefix invalidates a whole family (`albumKeys.all`, `photoGridKeys.all`), and every value a queryFn
// reads is part of its key. Keys are not persisted, so a value may change; a rename moves every
// caller with it.
//
// Two hooks share a key only when they cache the same value. Where a web hook reshapes an answer
// (groups it, sorts it, adds placeholders), the package hook that caches the answer as it comes uses
// the `...Raw` entry next to it: a child of the same family, so the family's prefix refreshes both.

/** A photo view's media toggle: everything, or only photos, videos, screenshots or documents. */
export type MediaType = "all" | "photos" | "videos" | "screenshots" | "documents";

/** The timeline filter part of a date-album list key when no timeline filter applies. */
export const NO_TIMELINE_FILTER = "none";

/** What tells two date-album lists apart: the photoset, then the filters. */
export type DateAlbumsListKey = [
  photosetType: Photoset,
  person_id: number | undefined,
  username: string | undefined,
  folder: string | undefined,
  mediaType: MediaType | "all",
  timelineFilter: string,
];

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
  | "withoutLocation"
  | "notInAlbum"
  | "myPublicPhotos"
  | "sharedByMe"
  | "sharedWithMe";

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
  /** A timeline-style list of day groups (timeline, favourites, person, folder, ...), with the web's placeholders. */
  dateAlbumList: (listKey: DateAlbumsListKey) => [...gridKind("dateAlbums"), ...listKey] as const,
  /** Every list of one photoset's day groups, all filters (a person's page under every media filter). */
  dateAlbumLists: (photoset: Photoset) => [...gridKind("dateAlbums"), photoset] as const,
  /** One photoset's day groups as the server sends them, without placeholders. */
  dateAlbumListRaw: (photoset: Photoset) => [...gridKind("dateAlbums"), photoset, "raw"] as const,
  /** Every loaded day page of one photoset's lists. */
  dateAlbumDays: (photoset: Photoset) => [...gridKind("dateAlbum"), photoset] as const,
  /**
   * One page of one day of the list `listKey`. The web's useFetchDateAlbumsQuery reads the layout
   * after the photoset back (getCachedDateAlbumPages): day id, page, then the list's filters.
   */
  dateAlbumDay: ([photoset, ...filters]: DateAlbumsListKey, albumDateId: number, page: number) =>
    [...photoGridKeys.dateAlbumDays(photoset), albumDateId, page, ...filters] as const,
  /** Every view of the Recently added list. */
  recentlyAdded: () => gridKind("recentlyAdded"),
  recentlyAddedView: (mediaType: MediaType) => [...photoGridKeys.recentlyAdded(), mediaType] as const,
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
  /** A search narrowed by the structured filters: under the same search, so it refreshes with it. */
  filteredSearch: (term: string, mediaType: MediaType, mode: "semantic" | "grouped", filters: SearchFilters) =>
    [...photoGridKeys.search(term, mediaType, mode), filters] as const,
  withoutTimestamp: (page: number, mediaType: MediaType) => [...gridKind("withoutTimestamp"), page, mediaType] as const,
  withoutLocation: (page: number, mediaType: MediaType) => [...gridKind("withoutLocation"), page, mediaType] as const,
  /** One page of the photos in none of my albums. */
  notInAlbum: (page: number, mediaType: MediaType) => [...gridKind("notInAlbum"), page, mediaType] as const,
  /** The first `pageSize` of my own public photos and their count (the Sharing overview). */
  myPublicPhotos: (pageSize: number) => [...gridKind("myPublicPhotos"), pageSize] as const,
  /** The photos I shared, grouped by recipient (web). */
  sharedByMe: () => gridKind("sharedByMe"),
  /** The photos I shared, one row per share as the server sends them. */
  sharedByMeRaw: () => [...photoGridKeys.sharedByMe(), "raw"] as const,
  /** The photos shared with me, grouped by owner (web). */
  sharedWithMe: () => gridKind("sharedWithMe"),
  /** The photos shared with me as the server sends them. */
  sharedWithMeRaw: () => [...photoGridKeys.sharedWithMe(), "raw"] as const,
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
  /** Every tag of a photo's files, read by ExifTool on request (the All metadata view). */
  rawMetadata: (photoId: string) => [...photoRoot, "rawMetadata", photoId] as const,
  publicDetail: (slug: string, imageHash: string) => [...photoRoot, "publicDetail", slug, imageHash] as const,
  shares: () => [...photoRoot, "shares"] as const,
  sharedBySlug: (slug: string) => [...photoRoot, "sharedBySlug", slug] as const,
  /** The dates of a selection, by hash or selected-all (the date dialog's preview). */
  dateSummary: (imageHashes: readonly string[], selectAll: SelectAllPhotos | undefined) =>
    [...photoRoot, "dateSummary", imageHashes, selectAll] as const,
  /** Where a selection stands before its location is set, keyed by the selection. */
  locationSummary: (selection: Record<string, unknown>) => [...photoRoot, "locationSummary", selection] as const,
  /** The geotagged photos taken in a window, to copy a location from. */
  locatedNearby: (from: string, to: string) => [...photoRoot, "locatedNearby", from, to] as const,
  /** What moving a selection to a folder would do (#352), keyed by the selection and the folder. */
  movePreview: (selection: Record<string, unknown>, targetFolder: string) =>
    [...photoRoot, "movePreview", selection, targetFolder] as const,
};

// The album lists and pickers. An album's photos are a grid: photoGridKeys.
const albumRoot = ["albums"] as const;

export const albumKeys = {
  all: albumRoot,
  userAlbums: () => [...albumRoot, "user"] as const,
  /** The user's album collections (#1009), which the My Albums filter row shows. */
  albumCollections: () => [...albumRoot, "collections"] as const,
  autoAlbums: () => [...albumRoot, "auto"] as const,
  thingsAlbums: () => [...albumRoot, "things"] as const,
  placesAlbums: () => [...albumRoot, "places"] as const,
  /** The people list as the web shows it: string ids, no nulls, sorted by name. */
  peopleAlbums: () => [...albumRoot, "people"] as const,
  /** The people list as the server sends it. */
  peopleAlbumsRaw: () => [...albumKeys.peopleAlbums(), "raw"] as const,
  /** One person (the person page's title), under the people list so a rename refreshes both. */
  person: (id: number) => [...albumKeys.peopleAlbums(), "person", id] as const,
  /** The user's groups of people (#1126), under the people list so a person change refreshes the counts. */
  personGroups: () => [...albumKeys.peopleAlbums(), "groups"] as const,
  locationClusters: () => [...albumRoot, "locationClusters"] as const,
  /** The albums I shared, grouped by recipient (web). */
  sharedByMe: () => [...albumRoot, "sharedByMe"] as const,
  /** The albums I shared as the server sends them. */
  sharedByMeRaw: () => [...albumKeys.sharedByMe(), "raw"] as const,
  /** The albums shared with me, grouped by owner (web). */
  sharedWithMe: () => [...albumRoot, "sharedWithMe"] as const,
  /** The albums shared with me as the server sends them. */
  sharedWithMeRaw: () => [...albumKeys.sharedWithMe(), "raw"] as const,
  /** Every folder listing, paged or not. */
  folders: () => [...albumRoot, "folders"] as const,
  /** Every subfolder of one folder, all pages read at once (the folder page). */
  folder: (path: string | undefined) => [...albumKeys.folders(), "page", path] as const,
  /** The same listing as an infinite query, one page at a time. */
  folderPages: (path: string | undefined) => [...albumKeys.folders(), "infinite", path] as const,
  /** Which album, if any, already uses a public link slug. */
  slugOwner: (slug: string) => [...albumRoot, "slugOwner", slug] as const,
};

const authRoot = ["auth"] as const;

export const authKeys = {
  all: authRoot,
  /** The web's access token, read from its cookie. */
  accessToken: () => [...authRoot, "accessToken"] as const,
  /** Whether the web has a session (its cookie, or a login in this tab). */
  isAuthenticated: () => [...authRoot, "isAuthenticated"] as const,
  firstTimeSetup: () => [...authRoot, "firstTimeSetup"] as const,
  ssoConfig: () => [...authRoot, "ssoConfig"] as const,
};

const duplicateRoot = ["duplicates"] as const;

export const duplicateKeys = {
  all: duplicateRoot,
  list: (duplicateType?: DuplicateType, status?: ReviewStatus, page?: number, pageSize?: number) =>
    [...duplicateRoot, "list", duplicateType, status, page, pageSize] as const,
  detail: (id: string) => [...duplicateRoot, "detail", id] as const,
  stats: () => [...duplicateRoot, "stats"] as const,
};

/** The face dashboard's request for one page of a person's faces (person 0: the faces of no one). */
export type PersonFaceListRequest = {
  person?: number;
  page: number;
  inferred: boolean;
  orderBy: FaceOrderBy;
  method?: FaceAnalysisMethod;
  minConfidence?: number;
  /** The person's deleted faces (#127). */
  deleted?: boolean;
};

/** The face dashboard's request for every person with their face count. */
export type IncompletePersonFaceListRequest = {
  inferred: boolean;
  method?: FaceAnalysisMethod;
  orderBy: FaceOrderBy;
  minConfidence?: number;
  /** Count each person's deleted faces (#127). */
  deleted?: boolean;
  /** Only the people in this group (#1126). */
  group?: number;
};

const faceRoot = ["faces"] as const;

export const faceKeys = {
  all: faceRoot,
  /** Every person's page of faces. */
  personFaces: () => [...faceRoot, "person"] as const,
  /** One page of a person's faces, the rows only (the web's face dashboard). */
  personFacePage: (request: PersonFaceListRequest) => [...faceKeys.personFaces(), request] as const,
  /** One page of a person's faces as the server sends it (count, next, results). */
  personFacePageRaw: (request: { person: number; inferred: boolean; page: number }) =>
    [...faceKeys.personFaces(), "raw", request] as const,
  /** Every people list (people with face counts, faces not loaded yet). */
  incomplete: () => [...faceRoot, "incomplete"] as const,
  /** The people list with a placeholder per face (the web's face dashboard). */
  incompleteList: (request: IncompletePersonFaceListRequest) => [...faceKeys.incomplete(), request] as const,
  /** The people list as the server sends it. */
  incompleteListRaw: (inferred: boolean) => [...faceKeys.incomplete(), "raw", inferred] as const,
  clusters: () => [...faceRoot, "clusters"] as const,
};

const folderRoot = ["folders"] as const;

export const folderKeys = {
  all: folderRoot,
  dirTree: (path: string) => [...folderRoot, "dirTree", path] as const,
  nextcloudDirs: () => [...folderRoot, "nextcloudDirs"] as const,
  /** One level of the folders a move can go to (#352); null: the library folders themselves. */
  moveTargets: (path: string | null) => [...folderRoot, "moveTargets", path] as const,
};

const geocodeRoot = ["geocode"] as const;

export const geocodeKeys = {
  all: geocodeRoot,
  search: (query: string) => [...geocodeRoot, "search", query] as const,
  reverse: (lat: number, lon: number) => [...geocodeRoot, "reverse", lat, lon] as const,
};

const jobRoot = ["jobs"] as const;

export const jobKeys = {
  /** The job lists and every job's detail. */
  all: jobRoot,
  list: (request: JobListParams) => [...jobRoot, "list", request] as const,
  detail: (id: number) => [...jobRoot, "detail", id] as const,
  /** The Finish the upgrade card's tasks (#2322): under `all`, so a job change refreshes them. */
  upgradeTasks: () => [...jobRoot, "upgradeTasks"] as const,
  /** Whether the worker can take a job (not under `all`: a job change does not always move it). */
  worker: () => ["worker"] as const,
};

const mediaRoot = ["media"] as const;

export const mediaKeys = {
  all: mediaRoot,
  diagnostics: (mediaHash: string | undefined) => [...mediaRoot, "diagnostics", mediaHash] as const,
};

const memoryRoot = ["memories"] as const;

export const memoryKeys = {
  all: memoryRoot,
  list: (size?: number) => [...memoryRoot, { size }] as const,
};

// Search results are a grid: photoGridKeys.search.
const searchRoot = ["search"] as const;

export const searchKeys = {
  all: searchRoot,
  examples: () => [...searchRoot, "examples"] as const,
  /** The suggestions of one search filter (cameras, makers or lenses). */
  metadataValues: (field: MetadataValueField) => [...searchRoot, "metadataValues", field] as const,
};

const serverRoot = ["server"] as const;

export const serverKeys = {
  all: serverRoot,
  imageTag: () => [...serverRoot, "imageTag"] as const,
  logs: (lines: number) => [...serverRoot, "logs", lines] as const,
  stats: () => [...serverRoot, "stats"] as const,
  storageStats: () => [...serverRoot, "storageStats"] as const,
};

const serviceRoot = ["services"] as const;

export const serviceKeys = {
  all: serviceRoot,
  list: () => [...serviceRoot, "list"] as const,
  /** Every health check, whichever services it covers. */
  healths: () => [...serviceRoot, "health"] as const,
  health: (serviceNames: string[]) => [...serviceKeys.healths(), serviceNames] as const,
};

const settingsRoot = ["settings"] as const;

export const settingsKeys = {
  all: settingsRoot,
  site: () => [...settingsRoot, "site"] as const,
  emailConfig: () => [...settingsRoot, "emailConfig"] as const,
  predefinedBurstRules: () => [...settingsRoot, "predefinedBurstRules"] as const,
  predefinedRules: () => [...settingsRoot, "predefinedRules"] as const,
  timezones: () => [...settingsRoot, "timezones"] as const,
  trashRetentionPreview: (days: number) => [...settingsRoot, "trashRetentionPreview", days] as const,
  /** What "Write metadata to files" would write, for the saved write mode and face tag switch. */
  writeMetadataPreview: (mode: string, faceTags: boolean) =>
    [...settingsRoot, "writeMetadataPreview", mode, faceTags] as const,
};

const stackRoot = ["stacks"] as const;

export const stackKeys = {
  all: stackRoot,
  lists: () => [...stackRoot, "list"] as const,
  list: (filters: Record<string, unknown>) => [...stackKeys.lists(), filters] as const,
  details: () => [...stackRoot, "detail"] as const,
  detail: (id: string) => [...stackKeys.details(), id] as const,
  stats: () => [...stackRoot, "stats"] as const,
};

const statsRoot = ["stats"] as const;

export const statsKeys = {
  all: statsRoot,
  counts: () => [...statsRoot, "counts"] as const,
  photoMonthCounts: () => [...statsRoot, "photoMonthCounts"] as const,
  locationTree: () => [...statsRoot, "locationTree"] as const,
  socialGraph: () => [...statsRoot, "socialGraph"] as const,
  wordCloud: () => [...statsRoot, "wordCloud"] as const,
  locationTimeline: () => [...statsRoot, "locationTimeline"] as const,
};

// A tag's photos are a grid: photoGridKeys.tagAlbum.
const tagRoot = ["tags"] as const;

export const tagKeys = {
  /** The tag list and every photo's tags. */
  all: tagRoot,
  list: () => [...tagRoot, "list"] as const,
  photo: (photoId: string) => [...tagRoot, "photo", photoId] as const,
};

const userRoot = ["user"] as const;

export const userKeys = {
  all: userRoot,
  list: () => [...userRoot, "list"] as const,
  /** The signed-in user's details, whoever that is. */
  selfDetails: () => [...userRoot, "self"] as const,
  /** A user's details. The id is a string in the key, whether the caller has it as a number or not. */
  selfDetail: (userId: string | number) => [...userKeys.selfDetails(), String(userId)] as const,
};
