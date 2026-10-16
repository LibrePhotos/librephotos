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
  PhotosNotInAlbumResponse: {
    schema: S.PhotosNotInAlbumResponse,
    components: ["PaginatedPhotoSummaryList"],
  },
  MyPublicPhotosResponse: {
    schema: S.MyPublicPhotosResponse,
    components: ["PaginatedPhotoSummaryList"],
  },
  SharedFromMePhoto: { schema: S.SharedFromMePhoto, components: ["SharedFromMePhotoThrough"] },
  PhotoMetadata: { schema: S.PhotoMetadata, components: ["PhotoMetadata"] },
  MetadataEdit: { schema: S.MetadataEdit, components: ["MetadataEdit"] },
  RawMetadata: { schema: S.RawMetadata, components: ["RawMetadata"] },
  RawMetadataFile: { schema: S.RawMetadataFile, components: ["RawMetadataFile"] },
  RawMetadataGroup: { schema: S.RawMetadataGroup, components: ["RawMetadataGroup"] },
  SetPhotosDateTimeResponse: { schema: S.SetPhotosDateTimeResponse, components: ["SetPhotosDateTimeResponse"] },
  DatedPhoto: { schema: S.DatedPhoto, components: ["DatedPhoto"] },
  DateSummary: { schema: S.DateSummary, components: ["DateSummaryResponse"] },
  // date groups (timeline, albums)
  DatePhotosGroup: { schema: S.DatePhotosGroup, components: ["GroupedPhotos"] },
  IncompleteDatePhotosGroup: {
    schema: S.IncompleteDatePhotosGroup,
    components: ["IncompleteAlbumDate", "AlbumDate"],
  },
  // albums
  PhotoSuperSimple: { schema: S.PhotoSuperSimple, components: ["PhotoSuperSimple"] },
  UserAlbumInfo: { schema: S.UserAlbumInfo, components: ["AlbumUserList"] },
  AlbumCollection: { schema: S.AlbumCollection, components: ["AlbumCollection"] },
  UserAlbumCollections: { schema: S.UserAlbumCollections, components: ["UserAlbumCollections"] },
  UserAlbum: { schema: S.UserAlbum, components: ["AlbumUser"] },
  EventTitleParts: { schema: S.EventTitleParts, components: ["EventTitleParts"] },
  AutoAlbumInfo: { schema: S.AutoAlbumInfo, components: ["AlbumAutoList"] },
  AutoAlbum: { schema: S.AutoAlbum, components: ["AlbumAuto"] },
  AutoAlbumEdit: { schema: S.AutoAlbumEdit, components: ["AlbumAutoEdit"] },
  PhotoSimple: { schema: S.PhotoSimple, components: ["PhotoSimple"] },
  ThingAlbumInfo: { schema: S.ThingAlbumInfo, components: ["AlbumThingList"] },
  PlaceAlbumInfo: { schema: S.PlaceAlbumInfo, components: ["AlbumPlaceList"] },
  // people, faces, tags
  Person: { schema: S.Person, components: ["Person"] },
  PersonGroup: { schema: S.PersonGroup, components: ["PersonGroup"] },
  PersonGroupsResponse: { schema: S.PersonGroupsResponse, components: ["PersonGroups"] },
  PersonFace: { schema: S.PersonFace, components: ["PersonFaceList"] },
  PersonFaceListResponse: { schema: S.PersonFaceListResponse, components: ["PaginatedPersonFaceListList"] },
  IncompletePersonFace: { schema: S.IncompletePersonFace, components: ["IncompletePersonFaceList"] },
  LabelledFace: { schema: S.LabelledFace, components: ["FaceList"] },
  SetFacesLabelResponse: { schema: S.SetFacesLabelResponse, components: ["SetFacePersonLabelResponse"] },
  AddFaceResponse: { schema: S.AddFaceResponse, components: ["AddFaceResponse"] },
  DeleteFacesResponse: { schema: S.DeleteFacesResponse, components: ["DeleteFacesResponse"] },
  RestoreFacesResponse: { schema: S.RestoreFacesResponse, components: ["RestoreFacesResponse"] },
  FaceLabels: { schema: S.FaceLabels, components: ["FaceLabels"] },
  Tag: { schema: S.Tag, components: ["Tag"] },
  TagAlbum: { schema: S.TagAlbum, components: ["GroupedTagPhotos"] },
  // jobs
  WorkerAvailabilityResponse: { schema: S.WorkerAvailabilityResponse, components: ["QueueAvailability"] },
  Job: { schema: S.Job, components: ["LongRunningJob"] },
  JobDetail: { schema: S.JobDetail, components: ["LongRunningJob"] },
  JobsResponse: { schema: S.JobsResponse, components: ["PaginatedLongRunningJobList"] },
  CancelJobResponse: { schema: S.CancelJobResponse, components: ["CancelJobResponse"] },
  JobStartedResponse: { schema: S.JobStartedResponse, components: ["JobStartedResponse"] },
  JobTriggerResponse: { schema: S.JobTriggerResponse, components: ["JobStartedResponse"] },
  CaptionsJobStartedResponse: { schema: S.CaptionsJobStartedResponse, components: ["CaptionsJobStartedResponse"] },
  WriteMetadataStarted: { schema: S.WriteMetadataStarted, components: ["WriteMetadataStarted"] },
  WriteMetadataPreview: { schema: S.WriteMetadataPreview, components: ["WriteMetadataPreview"] },
  WriteTypeCount: { schema: S.WriteTypeCount, components: ["WriteTypeCount"] },
  UpgradeTask: { schema: S.UpgradeTask, components: ["UpgradeTask"] },
  UpgradeTaskList: { schema: S.UpgradeTaskList, components: ["UpgradeTaskList"] },
  RescanPhotosResponse: { schema: S.RescanPhotosResponse, components: ["RescanPhotosResponse"] },
  ScanFilesResponse: { schema: S.ScanFilesResponse, components: ["ScanFilesResponse"] },
  // photo edits
  RotatePhotoResponse: { schema: S.RotatePhotoResponse, components: ["RotatePhotoResponse"] },
  BulkPhotoMutationResponse: { schema: S.BulkPhotoMutationResponse, components: ["BulkPhotoMutationResponse"] },
  DeletePhotosResponse: { schema: S.DeletePhotosResponse, components: ["DeletePhotosResponse"] },
  StatusResponse: { schema: S.StatusResponse, components: ["StatusResponse"] },
  // users and auth
  IsFirstTimeSetupResponse: { schema: S.IsFirstTimeSetupResponse, components: ["FirstTimeSetup"] },
  PasswordResetResponse: { schema: S.PasswordResetResponse, components: ["PasswordResetResponse"] },
  SsoConfig: { schema: S.SsoConfig, components: ["SSOConfig"] },
  SimpleUser: { schema: S.SimpleUser, components: ["SimpleUser"] },
  User: { schema: S.User, components: ["User"] },
  PublicPhotoSample: { schema: S.PublicPhotoSample, components: ["PhotoSuperSimple"] },
  ManageUser: { schema: S.ManageUser, components: ["ManageUser"] },
  RefreshResponse: { schema: S.RefreshResponse, components: ["TokenRefresh"] },
  SignupUser: { schema: S.SignupUser, components: ["SignupUser"] },
  // site settings
  EmailConfig: { schema: S.EmailConfig, components: ["EmailConfigResponse"] },
  EmailTestResponse: { schema: S.EmailTestResponse, components: ["EmailTestResponse"] },
  SiteSettings: { schema: S.SiteSettings, components: ["SiteSettings"] },
  SiteFeatures: { schema: S.SiteFeatures, components: ["SiteFeatures"] },
  SiteModelDownload: { schema: S.SiteModelDownload, components: ["SiteModelDownload"] },
  SiteAutoScanStatus: { schema: S.SiteAutoScanStatus, components: ["SiteAutoScanStatus"] },
  TrashRetentionPreview: { schema: S.TrashRetentionPreview, components: ["TrashRetentionPreview"] },
  // search
  MetadataValue: { schema: S.MetadataValue, components: ["MetadataValue"] },
  MetadataValuesResponse: { schema: S.MetadataValuesResponse, components: ["MetadataValues"] },
  // geocode
  GeocodeReverseResponse: { schema: S.GeocodeReverseResponse, components: ["GeocodeReverseResponse"] },
  // photo locations (#2279)
  SetPhotosLocationResponse: { schema: S.SetPhotosLocationResponse, components: ["SetPhotosLocationResponse"] },
  PlaceCount: { schema: S.PlaceCount, components: ["PlaceCount"] },
  LocationSummaryResponse: { schema: S.LocationSummaryResponse, components: ["LocationSummaryResponse"] },
  LocatedPhoto: { schema: S.LocatedPhoto, components: ["LocatedPhoto"] },
  // moving photos (#352)
  MoveClash: { schema: S.MoveClash, components: ["MoveClash"] },
  RefusedCount: { schema: S.RefusedCount, components: ["RefusedCount"] },
  MovePreviewResponse: { schema: S.MovePreviewResponse, components: ["MovePreviewResponse"] },
  MovePhotosResponse: { schema: S.MovePhotosResponse, components: ["MovePhotosResponse"] },
  MovePhotosStartedResponse: { schema: S.MovePhotosStartedResponse, components: ["MovePhotosStartedResponse"] },
  LibraryFolder: { schema: S.LibraryFolder, components: ["LibraryFolder"] },
  LibraryFolderListing: { schema: S.LibraryFolderListing, components: ["LibraryFolderListing"] },
  // mutations
  PhotoEditResponse: { schema: S.PhotoEditResponse, components: ["PhotoEdit"] },
  CreateUserAlbumResponse: { schema: S.CreateUserAlbumResponse, components: ["AlbumUserEdit"] },
  UserAlbumEditResponse: { schema: S.UserAlbumEditResponse, components: ["AlbumUserEdit"] },
  UserAlbumRenameResponse: { schema: S.UserAlbumRenameResponse, components: ["AlbumUser"] },
  PersonEditResponse: { schema: S.PersonEditResponse, components: ["Person"] },
  PersonRemovePhotosResponse: { schema: S.PersonRemovePhotosResponse, components: ["PersonRemovePhotosResponse"] },
  PersonMergeResponse: { schema: S.PersonMergeResponse, components: ["PersonMergeResponse"] },
  ClusterFacesResponse: { schema: S.ClusterFacesResponse, components: ["ClusterFacesResponse"] },
  // statistics
  CountStats: { schema: S.CountStats, components: ["CountStats"] },
  WordCloudResponse: { schema: S.WordCloudResponse, components: ["WordCloud"] },
  SocialGraph: { schema: S.SocialGraph, components: ["SocialGraph"] },
  PhotoMonthCount: { schema: S.PhotoMonthCount, components: ["PhotoMonthCount"] },
  LocationTimelineSpan: { schema: S.LocationTimelineSpan, components: ["LocationTimelineSpan"] },
  // server
  ImageTag: { schema: S.ImageTag, components: ["ImageTag"] },
  StorageStats: { schema: S.StorageStats, components: ["StorageStats"] },
  ServerLogs: { schema: S.ServerLogs, components: ["ServerLogs"] },
  ServerStats: { schema: S.ServerStats, components: ["ServerStats"] },
  // stacks
  StackFileVariant: { schema: S.StackFileVariant, components: ["StackFileVariant"] },
  StackPhoto: { schema: S.StackPhoto, components: ["StackPhoto"] },
  StackThumbnail: { schema: S.StackThumbnail, components: ["PhotoGroupThumbnail"] },
  PhotoStackListItem: { schema: S.PhotoStackListItem, components: ["PhotoStackListItem"] },
  PhotoStackListResponse: { schema: S.PhotoStackListResponse, components: ["PhotoStackPage"] },
  PhotoStack: { schema: S.PhotoStack, components: ["PhotoStack"] },
  PhotoStackStats: { schema: S.PhotoStackStats, components: ["PhotoStackStats"] },
  SetStackPrimaryResponse: { schema: S.SetStackPrimaryResponse, components: ["SetStackPrimaryResponse"] },
  CreateManualStackResponse: { schema: S.CreateManualStackResponse, components: ["CreateManualStackResponse"] },
  RemoveFromStackResponse: { schema: S.RemoveFromStackResponse, components: ["RemoveFromStackResponse"] },
  MergeStacksResponse: { schema: S.MergeStacksResponse, components: ["MergeStacksResponse"] },
  UnlinkGroupResponse: { schema: S.UnlinkGroupResponse, components: ["UnlinkGroupResponse"] },
  DetectionQueuedResponse: {
    schema: S.DetectionQueuedResponse,
    components: ["DetectStacksQueued", "DetectDuplicatesQueued"],
  },
  // duplicates
  DuplicatePhoto: { schema: S.DuplicatePhoto, components: ["DuplicatePhoto"] },
  DuplicateThumbnail: { schema: S.DuplicateThumbnail, components: ["PhotoGroupThumbnail"] },
  DuplicateListItem: { schema: S.DuplicateListItem, components: ["DuplicateListItem"] },
  DuplicateListResponse: { schema: S.DuplicateListResponse, components: ["DuplicatePage"] },
  DuplicateDetail: { schema: S.DuplicateDetail, components: ["DuplicateDetail"] },
  DuplicateStats: { schema: S.DuplicateStats, components: ["DuplicateStats"] },
  ResolveDuplicateResponse: { schema: S.ResolveDuplicateResponse, components: ["ResolveDuplicateResponse"] },
  DismissDuplicateResponse: { schema: S.DismissDuplicateResponse, components: ["DismissDuplicateResponse"] },
  RevertDuplicateResponse: { schema: S.RevertDuplicateResponse, components: ["RevertDuplicateResponse"] },
  // delta sync (the mobile app's mirror)
  SyncPhotoItem: { schema: S.SyncPhotoItem, components: ["SyncPhotoItem"] },
  SyncPersonItem: { schema: S.SyncPersonItem, components: ["SyncPersonItem"] },
  SyncUserAlbumItem: { schema: S.SyncUserAlbumItem, components: ["SyncUserAlbumItem"] },
  SyncAutoAlbumItem: { schema: S.SyncAutoAlbumItem, components: ["SyncAutoAlbumItem"] },
  SyncNamedAlbumItem: { schema: S.SyncNamedAlbumItem, components: ["SyncNamedAlbumItem"] },
  SyncPlaceAlbumItem: { schema: S.SyncPlaceAlbumItem, components: ["SyncPlaceAlbumItem"] },
  SyncSharedUserItem: { schema: S.SyncSharedUserItem, components: ["SyncSharedUserItem"] },
  SyncPhotosResponse: { schema: S.SyncPhotosResponse, components: ["SyncPhotosResponse"] },
  SyncPersonsResponse: { schema: S.SyncPersonsResponse, components: ["SyncPersonsResponse"] },
  SyncUserAlbumsResponse: { schema: S.SyncUserAlbumsResponse, components: ["SyncUserAlbumsResponse"] },
  SyncAutoAlbumsResponse: { schema: S.SyncAutoAlbumsResponse, components: ["SyncAutoAlbumsResponse"] },
  SyncThingAlbumsResponse: { schema: S.SyncThingAlbumsResponse, components: ["SyncThingAlbumsResponse"] },
  SyncPlaceAlbumsResponse: { schema: S.SyncPlaceAlbumsResponse, components: ["SyncPlaceAlbumsResponse"] },
  SyncTagAlbumsResponse: { schema: S.SyncTagAlbumsResponse, components: ["SyncTagAlbumsResponse"] },
  SyncSharingResponse: { schema: S.SyncSharingResponse, components: ["SyncSharingResponse"] },
  SyncCounts: { schema: S.SyncCounts, components: ["SyncCounts"] },
  // album and photo links, sharing
  PublicSharingSettings: { schema: S.PublicSharingSettings, components: ["PublicSharingSettings"] },
  FetchPublicAlbumResponse: { schema: S.FetchPublicAlbumResponse, components: ["PublicAlbumResponse"] },
  SetUserAlbumPublicResponse: { schema: S.SetUserAlbumPublicResponse, components: ["SetUserAlbumPublicResponse"] },
  PublicPhotoDetail: { schema: S.PublicPhotoDetail, components: ["PublicPhotoDetail"] },
  PublicPhotoDetailResponse: { schema: S.PublicPhotoDetailResponse, components: ["PublicPhotoDetailResponse"] },
  PhotoShare: { schema: S.PhotoShare, components: ["PhotoShare"] },
  PhotoShareLink: { schema: S.PhotoShareLink, components: ["PhotoShareListItem"] },
  PhotoShareResponse: { schema: S.PhotoShareResponse, components: ["SetPhotoShareResponse"] },
  PhotoShareListResponse: { schema: S.PhotoShareListResponse, components: ["PhotoShareList"] },
  SharedPhoto: { schema: S.SharedPhoto, components: ["SharedPhoto"] },
  SharedPhotoResponse: { schema: S.SharedPhotoResponse, components: ["SharedPhotoResponse"] },
  // folders, search, geocode, memories, metadata
  FolderSubfolder: { schema: S.FolderSubfolder, components: ["FolderEntry"] },
  FolderSubfoldersResponse: { schema: S.FolderSubfoldersResponse, components: ["FolderSubfoldersPage"] },
  SearchExamplesResponse: { schema: S.SearchExamplesResponse, components: ["SearchTermExamples"] },
  GeocodeResult: { schema: S.GeocodeResult, components: ["GeocodeSearchResult"] },
  Memory: { schema: S.Memory, components: ["Memory"] },
  FetchMemoriesResponse: { schema: S.FetchMemoriesResponse, components: ["Memories"] },
  BulkMetadataUpdateResponse: { schema: S.BulkMetadataUpdateResponse, components: ["BulkMetadataUpdateResponse"] },
  // downloads, uploads
  PhotoDownloadStart: { schema: S.PhotoDownloadStart, components: ["ZipDownloadStarted"] },
  PhotoDownloadStatus: { schema: S.PhotoDownloadStatus, components: ["ZipDownloadFinished", "ZipDownloadPending"] },
  UploadExistsResponse: { schema: S.UploadExistsResponse, components: ["UploadExists"] },
  // services, serving diagnostics
  ServicesList: { schema: S.ServicesList, components: ["Services"] },
  ServiceHealth: { schema: S.ServiceHealth, components: ["ServiceHealth"] },
  ServiceActionResponse: { schema: S.ServiceActionResponse, components: ["ServiceAction"] },
  MediaDiagnostics: { schema: S.MediaDiagnostics, components: ["MediaDiagnosis"] },
};

/** Exported zod objects that are not compared, and why. */
export const UNMAPPED: Readonly<Record<string, string>> = {
  PhotoStackSummary:
    "nested in PhotoSummary.stacks, which the schema leaves untyped (PhotoSummarySerializer.get_stacks returns a bare list or dict)",
  LoginPost: "a request body",
  StartupStatus: "the 503 the startup placeholder answers while the database updates (#2310), not a Django view",
  LoginResponse: "simplejwt's TokenObtainPairView declares no response serializer",
  RefreshPost: "a request body",
  TokenClaims: "the JWT payload, not a response body",
  AuthError: "the error envelope from api/views/exception_handler.py, not a component",
  LogoutResponse: "simplejwt's TokenBlacklistView declares no response serializer (it answers {})",
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
  PublicAlbum: "compared where it is read, as the results of FetchPublicAlbumResponse (PublicAlbumResponse)",
  AlbumCollectionListResponse:
    "a {results} envelope around rows compared on their own (AlbumCollection); the view's wrapper is not a component",
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
  PersonGroupList:
    "a {results} envelope around rows compared on their own (PersonGroup), read whole with fetchAllPages; the page envelope is not compared",
  PersonAlbum: "no endpoint in this package returns it, and no component describes a person album",
  PublicAlbumSlugOwner:
    "the answer FetchPublicAlbumResponse compares (PublicAlbumResponse), read only for its id: comparing it would report every other field as dropped",
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
  ListUser:
    "one shape for two serializers: UserViewSet lists User rows for admins and PublicUser rows for everyone else",
  UploadOptions: "a request body",
  UploadResponse:
    "the chunked upload views (chunked_upload/views.py) are plain Django views the schema does not describe",
  TagListResponse:
    "a {results} envelope around rows compared on their own (Tag); the view's wrapper is not a component; its rows add cover_photos",
  TagAlbumResponse:
    "a {results} envelope around rows compared on their own (TagAlbum); the view's wrapper is not a component",
  MetadataFile:
    "nested in PhotoMetadata.sidecar_files, typed as bare dicts in the schema; the model is gone and the server always sends [] (PhotoMetadataSerializer.get_sidecar_files)",
  UploadCompleteResponse:
    "the chunked upload views (chunked_upload/views.py) are plain Django views the schema does not describe",
};
