/**
 * Which OpenAPI component (apps/backend/openapi.json) each zod response schema
 * describes. openapi.contract.test.ts compares every pair field by field.
 *
 * Every exported zod object in ../schemas is either mapped here or listed in
 * UNMAPPED with the reason, and the test fails on one that is neither. A new
 * response schema gets an entry; when its view has no serializer, declare one
 * (or `@extend_schema(responses=...)`) in the backend first, regenerate
 * openapi.json (`python scripts/openapi_schema.py`), then map it.
 */
import * as S from "../schemas";
import type { ContractEntry } from "./openapi-contract";

export const CONTRACT_MAP: Readonly<Record<string, ContractEntry>> = {
  // photos
  Photo: { schema: S.Photo, components: ["Photo"] },
  PhotoMetadataSummary: { schema: S.PhotoMetadataSummary, components: ["PhotoMetadataSummary"] },
  PigPhoto: { schema: S.PigPhoto, components: ["PhotoSummary"] },
  PhotoHash: { schema: S.PhotoHash, components: ["PhotoHashList"] },
  PhotosWithoutTimestampResponse: {
    schema: S.PhotosWithoutTimestampResponse,
    components: ["PaginatedPhotoSummaryList"],
  },
  SharedFromMePhoto: { schema: S.SharedFromMePhoto, components: ["SharedFromMePhotoThrough"] },
  // date groups (timeline, albums)
  DatePhotosGroup: { schema: S.DatePhotosGroup, components: ["GroupedPhotos"] },
  IncompleteDatePhotosGroup: {
    schema: S.IncompleteDatePhotosGroup,
    components: ["IncompleteAlbumDate", "AlbumDate"],
  },
  // albums
  PhotoSuperSimple: { schema: S.PhotoSuperSimple, components: ["PhotoSuperSimple"] },
  UserAlbumInfo: { schema: S.UserAlbumInfo, components: ["AlbumUserList"] },
  UserAlbum: { schema: S.UserAlbum, components: ["AlbumUser"] },
  AutoAlbumInfo: { schema: S.AutoAlbumInfo, components: ["AlbumAutoList"] },
  AutoAlbum: { schema: S.AutoAlbum, components: ["AlbumAuto"] },
  PhotoSimple: { schema: S.PhotoSimple, components: ["PhotoSimple"] },
  ThingAlbumInfo: { schema: S.ThingAlbumInfo, components: ["AlbumThingList"] },
  PlaceAlbumInfo: { schema: S.PlaceAlbumInfo, components: ["AlbumPlaceList"] },
  // people, faces, tags
  Person: { schema: S.Person, components: ["Person"] },
  PersonFace: { schema: S.PersonFace, components: ["PersonFaceList"] },
  PersonFaceListResponse: { schema: S.PersonFaceListResponse, components: ["PaginatedPersonFaceListList"] },
  IncompletePersonFace: { schema: S.IncompletePersonFace, components: ["IncompletePersonFaceList"] },
  Tag: { schema: S.Tag, components: ["Tag"] },
  TagAlbum: { schema: S.TagAlbum, components: ["GroupedTagPhotos"] },
  // jobs
  Job: { schema: S.Job, components: ["LongRunningJob"] },
  JobDetail: { schema: S.JobDetail, components: ["LongRunningJob"] },
  JobsResponse: { schema: S.JobsResponse, components: ["PaginatedLongRunningJobList"] },
  // users and auth
  SimpleUser: { schema: S.SimpleUser, components: ["SimpleUser"] },
  User: { schema: S.User, components: ["User"] },
  PublicPhotoSample: { schema: S.PublicPhotoSample, components: ["PhotoSuperSimple"] },
  ManageUser: { schema: S.ManageUser, components: ["ManageUser"] },
  RefreshResponse: { schema: S.RefreshResponse, components: ["TokenRefresh"] },
  // mutations
  PhotoEditResponse: { schema: S.PhotoEditResponse, components: ["PhotoEdit"] },
  CreateUserAlbumResponse: { schema: S.CreateUserAlbumResponse, components: ["AlbumUserEdit"] },
};

/** Exported zod objects that are not compared, and why. */
export const UNMAPPED: Readonly<Record<string, string>> = {
  PhotoStackSummary:
    "nested in PhotoSummary.stacks, which the schema leaves untyped (PhotoSummarySerializer.get_stacks returns a bare list or dict)",
  LoginPost: "a request body",
  LoginResponse: "simplejwt's TokenObtainPairView declares no response serializer",
  RefreshPost: "a request body",
  TokenClaims: "the JWT payload, not a response body",
  AuthError: "the error envelope from api/views/exception_handler.py, not a component",
  IsFirstTimeSetupResponse:
    "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  PublicSharingDefaults: "nested in User.public_sharing_defaults, which the schema leaves untyped (a JSONField)",
  People:
    "nested in Photo.people, which the schema leaves untyped (PhotoSerializer.get_people returns a bare list or dict)",
  PhotoOcrBlock:
    "nested in Photo.ocr, which the schema leaves untyped (PhotoSerializer.get_ocr returns a bare list or dict)",
  PhotoOcrData:
    "nested in Photo.ocr, which the schema leaves untyped (PhotoSerializer.get_ocr returns a bare list or dict)",
  FileVariant:
    "nested in Photo.file_variants, which the schema leaves untyped (PhotoSerializer.get_file_variants returns a bare list or dict)",
  StackPhotoDetail:
    "nested in Photo.stacks, which the schema leaves untyped (PhotoSerializer.get_stacks returns a bare list or dict)",
  PhotoStackDetail:
    "nested in Photo.stacks, which the schema leaves untyped (PhotoSerializer.get_stacks returns a bare list or dict)",
  RecentlyAddedPhotosResponse:
    "a {results} envelope around rows compared on their own (PigPhoto); the view's wrapper is not a component, plus `date`",
  BulkPhotoQuery: "a request body",
  FetchDateAlbumsListResponse:
    "a {results} envelope around rows compared on their own (IncompleteDatePhotosGroup); the view's wrapper is not a component",
  FetchDateAlbumResponse:
    "a {results} envelope around rows compared on their own (IncompleteDatePhotosGroup); the view's wrapper is not a component",
  FetchUserAlbumsListResponse:
    "a {results} envelope around rows compared on their own (UserAlbumInfo); the view's wrapper is not a component",
  PublicSharingOptions:
    "nested in AlbumUser.public_sharing_options, which the schema leaves untyped (AlbumUserSerializer.get_public_sharing_options returns a bare list or dict)",
  FetchUserAlbumsSharedResponse:
    "a {results} envelope around rows compared on their own (UserAlbumInfo); the view's wrapper is not a component",
  FetchAutoAlbumsListResponse:
    "a {results} envelope around rows compared on their own (AutoAlbumInfo); the view's wrapper is not a component",
  AlbumInfo: "the base of ThingAlbumInfo and PlaceAlbumInfo, which are compared",
  FetchThingAlbumsListResponse:
    "a {results} envelope around rows compared on their own (ThingAlbumInfo); the view's wrapper is not a component",
  ThingAlbum:
    "AlbumThingViewSet.retrieve answers GroupedThingPhotosSerializer, which the schema does not declare (it names AlbumThing)",
  FetchThingAlbumResponse: "the {results} envelope of ThingAlbum (see there)",
  FetchPlaceAlbumsListResponse:
    "a {results} envelope around rows compared on their own (PlaceAlbumInfo); the view's wrapper is not a component",
  PlaceAlbum:
    "AlbumPlaceViewSet.retrieve answers a grouped-photos serializer the schema does not declare (it names AlbumPlace)",
  FetchPlaceAlbumResponse: "the {results} envelope of PlaceAlbum (see there)",
  FetchPeopleAlbumsResponse:
    "a {results} envelope around rows compared on their own (Person); the view's wrapper is not a component",
  PersonAlbum: "no endpoint in this package returns it, and no component describes a person album",
  SearchExamplesResponse:
    "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  SearchPhotos:
    "a {results} envelope around rows compared on their own (DatePhotosGroup); the view's wrapper is not a component",
  SemanticSearchPhotos:
    "a {results} envelope around rows compared on their own (PigPhoto); the view's wrapper is not a component",
  SearchPhotosResult: "built by endpoints.searchPhotos from a response, not a response itself",
  SharedToMePhotosResponse:
    "a {results} envelope around rows compared on their own (PigPhoto); the view's wrapper is not a component",
  SharedPhotosResponse:
    "a {results} envelope around rows compared on their own (SharedFromMePhoto); the view's wrapper is not a component",
  SharedAlbumsResponse:
    "a {results} envelope around rows compared on their own (UserAlbumInfo); the view's wrapper is not a component",
  SetFacesLabelResponse: "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  DeleteFacesResponse: "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  JobTriggerResponse: "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  WorkerAvailabilityResponse:
    "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  SiteSettings: "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  ListUser:
    "one shape for two serializers: UserViewSet lists User rows for admins and PublicUser rows for everyone else",
  UploadOptions: "a request body",
  UploadResponse: "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  TagListResponse:
    "a {results} envelope around rows compared on their own (Tag); the view's wrapper is not a component; its rows add cover_photos",
  TagAlbumResponse:
    "a {results} envelope around rows compared on their own (TagAlbum); the view's wrapper is not a component",
  BulkPhotoMutationResponse:
    "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  StatusResponse: "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  SyncPhotoItem: "the sync views (api/views/sync.py) declare no response serializer (openapi-baseline.txt, issue #485)",
  SyncPersonItem:
    "the sync views (api/views/sync.py) declare no response serializer (openapi-baseline.txt, issue #485)",
  SyncUserAlbumItem:
    "the sync views (api/views/sync.py) declare no response serializer (openapi-baseline.txt, issue #485)",
  SyncAutoAlbumItem:
    "the sync views (api/views/sync.py) declare no response serializer (openapi-baseline.txt, issue #485)",
  SyncNamedAlbumItem:
    "the sync views (api/views/sync.py) declare no response serializer (openapi-baseline.txt, issue #485)",
  SyncPlaceAlbumItem:
    "the sync views (api/views/sync.py) declare no response serializer (openapi-baseline.txt, issue #485)",
  SyncSharedUserItem:
    "the sync views (api/views/sync.py) declare no response serializer (openapi-baseline.txt, issue #485)",
  SyncPhotosResponse:
    "the sync views (api/views/sync.py) declare no response serializer (openapi-baseline.txt, issue #485)",
  SyncPersonsResponse:
    "the sync views (api/views/sync.py) declare no response serializer (openapi-baseline.txt, issue #485)",
  SyncUserAlbumsResponse:
    "the sync views (api/views/sync.py) declare no response serializer (openapi-baseline.txt, issue #485)",
  SyncAutoAlbumsResponse:
    "the sync views (api/views/sync.py) declare no response serializer (openapi-baseline.txt, issue #485)",
  SyncThingAlbumsResponse:
    "the sync views (api/views/sync.py) declare no response serializer (openapi-baseline.txt, issue #485)",
  SyncPlaceAlbumsResponse:
    "the sync views (api/views/sync.py) declare no response serializer (openapi-baseline.txt, issue #485)",
  SyncTagAlbumsResponse:
    "the sync views (api/views/sync.py) declare no response serializer (openapi-baseline.txt, issue #485)",
  SyncSharingResponse:
    "the sync views (api/views/sync.py) declare no response serializer (openapi-baseline.txt, issue #485)",
  SyncCounts: "the sync views (api/views/sync.py) declare no response serializer (openapi-baseline.txt, issue #485)",
};
