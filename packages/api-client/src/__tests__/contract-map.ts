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
  PhotosWithoutLocationResponse: {
    schema: S.PhotosWithoutLocationResponse,
    components: ["PaginatedPhotoSummaryList"],
  },
  SharedFromMePhoto: { schema: S.SharedFromMePhoto, components: ["SharedFromMePhotoThrough"] },
  PhotoMetadata: { schema: S.PhotoMetadata, components: ["PhotoMetadata"] },
  MetadataEdit: { schema: S.MetadataEdit, components: ["MetadataEdit"] },
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
  CancelJobResponse: { schema: S.CancelJobResponse, components: ["CancelJobResponse"] },
  JobStartedResponse: { schema: S.JobStartedResponse, components: ["JobStartedResponse"] },
  // users and auth
  SimpleUser: { schema: S.SimpleUser, components: ["SimpleUser"] },
  User: { schema: S.User, components: ["User"] },
  PublicPhotoSample: { schema: S.PublicPhotoSample, components: ["PhotoSuperSimple"] },
  ManageUser: { schema: S.ManageUser, components: ["ManageUser"] },
  RefreshResponse: { schema: S.RefreshResponse, components: ["TokenRefresh"] },
  SignupUser: { schema: S.SignupUser, components: ["SignupUser"] },
  // site settings
  SiteSettings: { schema: S.SiteSettings, components: ["SiteSettings"] },
  SiteFeatures: { schema: S.SiteFeatures, components: ["SiteFeatures"] },
  SiteModelDownload: { schema: S.SiteModelDownload, components: ["SiteModelDownload"] },
  // mutations
  PhotoEditResponse: { schema: S.PhotoEditResponse, components: ["PhotoEdit"] },
  CreateUserAlbumResponse: { schema: S.CreateUserAlbumResponse, components: ["AlbumUserEdit"] },
  UserAlbumEditResponse: { schema: S.UserAlbumEditResponse, components: ["AlbumUserEdit"] },
  UserAlbumRenameResponse: { schema: S.UserAlbumRenameResponse, components: ["AlbumUser"] },
  PersonEditResponse: { schema: S.PersonEditResponse, components: ["Person"] },
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
  LogoutResponse: "simplejwt's TokenBlacklistView declares no response serializer (it answers {})",
  PasswordResetResponse: "its views declare no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  SsoConfig: "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  IsFirstTimeSetupResponse:
    "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  PublicSharingDefaults: "nested in User.public_sharing_defaults, which the schema leaves untyped (a JSONField)",
  People: "deprecated alias of PhotoPerson, kept for one release while apps/mobile moves",
  PhotoPerson:
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
    "a {date, results} envelope (component RecentlyAddedPhotos) around rows compared on their own (PigPhoto); comparing it would repeat PigPhoto's baselined differences",
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
  FetchPublicAlbumResponse:
    "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485); the album is compared as UserAlbum",
  PublicAlbumSlugOwner: "the same answer as FetchPublicAlbumResponse, read only for its id",
  SetUserAlbumPublicResponse:
    "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485); the album is compared as UserAlbumInfo",
  FolderSubfolder: "nested in FolderSubfoldersResponse (see there)",
  FolderSubfoldersResponse:
    "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  SearchExamplesResponse:
    "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  SearchPhotos:
    "a {results} envelope (component SearchResults) around rows compared on their own (DatePhotosGroup); comparing it would repeat DatePhotosGroup's baselined differences",
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
  PhotoDownloadStart: "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  PhotoDownloadStatus: "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  StackFileVariant:
    "api/views/stacks.py builds its answers by hand and declares no response serializer (openapi-baseline.txt, issue #485)",
  StackPhoto:
    "api/views/stacks.py builds its answers by hand and declares no response serializer (openapi-baseline.txt, issue #485)",
  StackThumbnail:
    "api/views/stacks.py builds its answers by hand and declares no response serializer (openapi-baseline.txt, issue #485)",
  PhotoStackListItem:
    "api/views/stacks.py builds its answers by hand and declares no response serializer (openapi-baseline.txt, issue #485)",
  PhotoStackListResponse:
    "api/views/stacks.py builds its answers by hand and declares no response serializer (openapi-baseline.txt, issue #485)",
  PhotoStack:
    "api/views/stacks.py builds its answers by hand and declares no response serializer (openapi-baseline.txt, issue #485)",
  PhotoStackStats:
    "api/views/stacks.py builds its answers by hand and declares no response serializer (openapi-baseline.txt, issue #485)",
  SetStackPrimaryResponse:
    "api/views/stacks.py builds its answers by hand and declares no response serializer (openapi-baseline.txt, issue #485)",
  CreateManualStackResponse:
    "api/views/stacks.py builds its answers by hand and declares no response serializer (openapi-baseline.txt, issue #485)",
  RemoveFromStackResponse:
    "api/views/stacks.py builds its answers by hand and declares no response serializer (openapi-baseline.txt, issue #485)",
  MergeStacksResponse:
    "api/views/stacks.py builds its answers by hand and declares no response serializer (openapi-baseline.txt, issue #485)",
  UnlinkGroupResponse:
    "api/views/stacks.py and api/views/duplicates.py build their answers by hand and declare no response serializer (openapi-baseline.txt, issue #485)",
  DetectionQueuedResponse:
    "api/views/stacks.py and api/views/duplicates.py build their answers by hand and declare no response serializer (openapi-baseline.txt, issue #485)",
  DuplicatePhoto:
    "api/views/duplicates.py builds its answers by hand and declares no response serializer (openapi-baseline.txt, issue #485)",
  DuplicateThumbnail:
    "api/views/duplicates.py builds its answers by hand and declares no response serializer (openapi-baseline.txt, issue #485)",
  DuplicateListItem:
    "api/views/duplicates.py builds its answers by hand and declares no response serializer (openapi-baseline.txt, issue #485)",
  DuplicateListResponse:
    "api/views/duplicates.py builds its answers by hand and declares no response serializer (openapi-baseline.txt, issue #485)",
  DuplicateDetail:
    "api/views/duplicates.py builds its answers by hand and declares no response serializer (openapi-baseline.txt, issue #485)",
  DuplicateStats:
    "api/views/duplicates.py builds its answers by hand and declares no response serializer (openapi-baseline.txt, issue #485)",
  ResolveDuplicateResponse:
    "api/views/duplicates.py builds its answers by hand and declares no response serializer (openapi-baseline.txt, issue #485)",
  DismissDuplicateResponse:
    "api/views/duplicates.py builds its answers by hand and declares no response serializer (openapi-baseline.txt, issue #485)",
  RevertDuplicateResponse:
    "api/views/duplicates.py builds its answers by hand and declares no response serializer (openapi-baseline.txt, issue #485)",
  WorkerAvailabilityResponse:
    "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  EmailConfig: "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  EmailTestResponse: "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
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
  DeletePhotosResponse: "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  RotatePhotoResponse: "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  MetadataFile:
    "nested in PhotoMetadata.sidecar_files, typed as bare dicts in the schema; the model is gone and the server always sends [] (PhotoMetadataSerializer.get_sidecar_files)",
  BulkMetadataUpdateResponse:
    "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  PublicSharingSettings:
    "a plain dict (get_effective_sharing_settings) in answers whose views declare no response serializer",
  PublicPhotoDetail:
    "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485), and no component describes PublicPhotoDetailSerializer",
  PublicPhotoDetailResponse:
    "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  PhotoShare: "its views declare no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  PhotoShareResponse: "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  PhotoShareListResponse:
    "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  SharedPhoto:
    "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485); a PublicPhotoDetailSerializer row with the hash-derived fields swapped for slug URLs",
  SharedPhotoResponse: "the {results} envelope of SharedPhoto (see there)",
  CountStats: "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  WordCloudResponse: "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  SocialGraph: "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  ClusterFacesResponse: "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  AddFaceResponse: "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  ImageTag: "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  StorageStats: "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  ServerLogs: "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  ServerStats: "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  ServicesList:
    "ServiceViewSet (api/views/services.py) declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  ServiceHealth:
    "ServiceViewSet (api/views/services.py) declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  ServiceActionResponse:
    "ServiceViewSet (api/views/services.py) declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  UploadCompleteResponse:
    "the chunked upload views (chunked_upload/views.py) are plain Django views the schema does not describe",
  UploadExistsResponse: "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  GeocodeResult: "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  MediaDiagnostics: "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
  Memory: "nested in FetchMemoriesResponse (see there)",
  FetchMemoriesResponse: "its view declares no response serializer (see apps/backend/openapi-baseline.txt, issue #485)",
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
