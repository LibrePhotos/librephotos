import { relations } from "drizzle-orm/relations";
import { djangoContentType, authPermission, authGroup, authGroupPermissions, apiUser, refreshToken, apiUserGroups, apiUserUserPermissions, apiPerson, apiCluster, apiFile, apiFileEmbeddedMedia, apiPhoto, lpPhotoFacesScanned, apiAlbumdate, apiAlbumdateSharedTo, apiAlbumthing, apiAlbumthingSharedTo, apiAlbumauto, apiAlbumautoSharedTo, apiAlbumplace, apiAlbumplaceSharedTo, apiAlbumuser, apiAlbumuserSharedTo, apiAlbumusershare, apiLongrunningjob, apiFace, apiPhotoSharedTo, apiPhotoFiles, apiAlbumuserPhotos, apiAlbumthingPhotos, apiAlbumplacePhotos, apiAlbumdatePhotos, apiAlbumautoPhotos, apiAlbumthingCoverPhotos, apiThumbnail, apiPhotoCaption, apiPhotoSearch, apiPhotostack, apiStackreview, apiMetadataedit, apiMetadatafile, apiPhotometadata, accountEmailaddress, accountEmailconfirmation, djangoAdminLog, apiPhotoStacks, apiDuplicate, apiPhotoDuplicates, apiTag, apiTagPhotos, apiPhotoOcr, apiPhotoshare, apiDeletionlog, chunkedUploadChunkedupload, socialaccountSocialaccount, socialaccountSocialapp, socialaccountSocialappSites, djangoSite, socialaccountSocialtoken, tokenBlacklistOutstandingtoken, tokenBlacklistBlacklistedtoken } from "./schema";

export const authPermissionRelations = relations(authPermission, ({one, many}) => ({
	djangoContentType: one(djangoContentType, {
		fields: [authPermission.contentTypeId],
		references: [djangoContentType.id]
	}),
	authGroupPermissions: many(authGroupPermissions),
	apiUserUserPermissions: many(apiUserUserPermissions),
}));

export const djangoContentTypeRelations = relations(djangoContentType, ({many}) => ({
	authPermissions: many(authPermission),
	djangoAdminLogs: many(djangoAdminLog),
}));

export const authGroupPermissionsRelations = relations(authGroupPermissions, ({one}) => ({
	authGroup: one(authGroup, {
		fields: [authGroupPermissions.groupId],
		references: [authGroup.id]
	}),
	authPermission: one(authPermission, {
		fields: [authGroupPermissions.permissionId],
		references: [authPermission.id]
	}),
}));

export const authGroupRelations = relations(authGroup, ({many}) => ({
	authGroupPermissions: many(authGroupPermissions),
	apiUserGroups: many(apiUserGroups),
}));

export const refreshTokenRelations = relations(refreshToken, ({one}) => ({
	apiUser: one(apiUser, {
		fields: [refreshToken.userId],
		references: [apiUser.id]
	}),
}));

export const apiUserRelations = relations(apiUser, ({many}) => ({
	refreshTokens: many(refreshToken),
	apiUserGroups: many(apiUserGroups),
	apiUserUserPermissions: many(apiUserUserPermissions),
	apiClusters: many(apiCluster),
	apiAlbumdates: many(apiAlbumdate),
	apiAlbumdateSharedTos: many(apiAlbumdateSharedTo),
	apiAlbumthings: many(apiAlbumthing),
	apiAlbumthingSharedTos: many(apiAlbumthingSharedTo),
	apiAlbumautoSharedTos: many(apiAlbumautoSharedTo),
	apiAlbumplaceSharedTos: many(apiAlbumplaceSharedTo),
	apiAlbumautos: many(apiAlbumauto),
	apiAlbumplaces: many(apiAlbumplace),
	apiAlbumuserSharedTos: many(apiAlbumuserSharedTo),
	apiLongrunningjobs: many(apiLongrunningjob),
	apiPhotos: many(apiPhoto),
	apiPhotoSharedTos: many(apiPhotoSharedTo),
	apiPhotostacks: many(apiPhotostack),
	apiPeople: many(apiPerson),
	apiAlbumusers: many(apiAlbumuser),
	apiStackreviews: many(apiStackreview),
	apiMetadataedits: many(apiMetadataedit),
	accountEmailaddresses: many(accountEmailaddress),
	djangoAdminLogs: many(djangoAdminLog),
	apiDuplicates: many(apiDuplicate),
	apiTags: many(apiTag),
	apiDeletionlogs: many(apiDeletionlog),
	chunkedUploadChunkeduploads: many(chunkedUploadChunkedupload),
	socialaccountSocialaccounts: many(socialaccountSocialaccount),
	tokenBlacklistOutstandingtokens: many(tokenBlacklistOutstandingtoken),
}));

export const apiUserGroupsRelations = relations(apiUserGroups, ({one}) => ({
	apiUser: one(apiUser, {
		fields: [apiUserGroups.userId],
		references: [apiUser.id]
	}),
	authGroup: one(authGroup, {
		fields: [apiUserGroups.groupId],
		references: [authGroup.id]
	}),
}));

export const apiUserUserPermissionsRelations = relations(apiUserUserPermissions, ({one}) => ({
	apiUser: one(apiUser, {
		fields: [apiUserUserPermissions.userId],
		references: [apiUser.id]
	}),
	authPermission: one(authPermission, {
		fields: [apiUserUserPermissions.permissionId],
		references: [authPermission.id]
	}),
}));

export const apiClusterRelations = relations(apiCluster, ({one, many}) => ({
	apiPerson: one(apiPerson, {
		fields: [apiCluster.personId],
		references: [apiPerson.id]
	}),
	apiUser: one(apiUser, {
		fields: [apiCluster.ownerId],
		references: [apiUser.id]
	}),
	apiFaces: many(apiFace),
}));

export const apiPersonRelations = relations(apiPerson, ({one, many}) => ({
	apiClusters: many(apiCluster),
	apiFaces_classificationPersonId: many(apiFace, {
		relationName: "apiFace_classificationPersonId_apiPerson_id"
	}),
	apiFaces_clusterPersonId: many(apiFace, {
		relationName: "apiFace_clusterPersonId_apiPerson_id"
	}),
	apiFaces_personId: many(apiFace, {
		relationName: "apiFace_personId_apiPerson_id"
	}),
	apiFace: one(apiFace, {
		fields: [apiPerson.coverFaceId],
		references: [apiFace.id],
		relationName: "apiPerson_coverFaceId_apiFace_id"
	}),
	apiUser: one(apiUser, {
		fields: [apiPerson.clusterOwnerId],
		references: [apiUser.id]
	}),
	apiPhoto: one(apiPhoto, {
		fields: [apiPerson.coverPhotoId],
		references: [apiPhoto.id]
	}),
}));

export const apiFileEmbeddedMediaRelations = relations(apiFileEmbeddedMedia, ({one}) => ({
	apiFile_fromFileId: one(apiFile, {
		fields: [apiFileEmbeddedMedia.fromFileId],
		references: [apiFile.hash],
		relationName: "apiFileEmbeddedMedia_fromFileId_apiFile_hash"
	}),
	apiFile_toFileId: one(apiFile, {
		fields: [apiFileEmbeddedMedia.toFileId],
		references: [apiFile.hash],
		relationName: "apiFileEmbeddedMedia_toFileId_apiFile_hash"
	}),
}));

export const apiFileRelations = relations(apiFile, ({many}) => ({
	apiFileEmbeddedMedias_fromFileId: many(apiFileEmbeddedMedia, {
		relationName: "apiFileEmbeddedMedia_fromFileId_apiFile_hash"
	}),
	apiFileEmbeddedMedias_toFileId: many(apiFileEmbeddedMedia, {
		relationName: "apiFileEmbeddedMedia_toFileId_apiFile_hash"
	}),
	apiPhotos: many(apiPhoto),
	apiPhotoFiles: many(apiPhotoFiles),
	apiMetadatafiles: many(apiMetadatafile),
}));

export const lpPhotoFacesScannedRelations = relations(lpPhotoFacesScanned, ({one}) => ({
	apiPhoto: one(apiPhoto, {
		fields: [lpPhotoFacesScanned.photoId],
		references: [apiPhoto.id]
	}),
}));

export const apiPhotoRelations = relations(apiPhoto, ({one, many}) => ({
	lpPhotoFacesScanneds: many(lpPhotoFacesScanned),
	apiFile: one(apiFile, {
		fields: [apiPhoto.mainFileId],
		references: [apiFile.hash]
	}),
	apiUser: one(apiUser, {
		fields: [apiPhoto.ownerId],
		references: [apiUser.id]
	}),
	apiFaces: many(apiFace),
	apiPhotoSharedTos: many(apiPhotoSharedTo),
	apiPhotoFiles: many(apiPhotoFiles),
	apiAlbumuserPhotos: many(apiAlbumuserPhotos),
	apiAlbumthingPhotos: many(apiAlbumthingPhotos),
	apiAlbumplacePhotos: many(apiAlbumplacePhotos),
	apiAlbumdatePhotos: many(apiAlbumdatePhotos),
	apiAlbumautoPhotos: many(apiAlbumautoPhotos),
	apiAlbumthingCoverPhotos: many(apiAlbumthingCoverPhotos),
	apiThumbnails: many(apiThumbnail),
	apiPhotoCaptions: many(apiPhotoCaption),
	apiPhotoSearches: many(apiPhotoSearch),
	apiPhotostacks: many(apiPhotostack),
	apiPeople: many(apiPerson),
	apiAlbumusers: many(apiAlbumuser),
	apiStackreviews: many(apiStackreview),
	apiMetadataedits: many(apiMetadataedit),
	apiMetadatafiles: many(apiMetadatafile),
	apiPhotometadata: many(apiPhotometadata),
	apiPhotoStacks: many(apiPhotoStacks),
	apiDuplicates: many(apiDuplicate),
	apiPhotoDuplicates: many(apiPhotoDuplicates),
	apiTagPhotos: many(apiTagPhotos),
	apiPhotoOcrs: many(apiPhotoOcr),
	apiPhotoshares: many(apiPhotoshare),
}));

export const apiAlbumdateRelations = relations(apiAlbumdate, ({one, many}) => ({
	apiUser: one(apiUser, {
		fields: [apiAlbumdate.ownerId],
		references: [apiUser.id]
	}),
	apiAlbumdateSharedTos: many(apiAlbumdateSharedTo),
	apiAlbumdatePhotos: many(apiAlbumdatePhotos),
}));

export const apiAlbumdateSharedToRelations = relations(apiAlbumdateSharedTo, ({one}) => ({
	apiAlbumdate: one(apiAlbumdate, {
		fields: [apiAlbumdateSharedTo.albumdateId],
		references: [apiAlbumdate.id]
	}),
	apiUser: one(apiUser, {
		fields: [apiAlbumdateSharedTo.userId],
		references: [apiUser.id]
	}),
}));

export const apiAlbumthingRelations = relations(apiAlbumthing, ({one, many}) => ({
	apiUser: one(apiUser, {
		fields: [apiAlbumthing.ownerId],
		references: [apiUser.id]
	}),
	apiAlbumthingSharedTos: many(apiAlbumthingSharedTo),
	apiAlbumthingPhotos: many(apiAlbumthingPhotos),
	apiAlbumthingCoverPhotos: many(apiAlbumthingCoverPhotos),
}));

export const apiAlbumthingSharedToRelations = relations(apiAlbumthingSharedTo, ({one}) => ({
	apiAlbumthing: one(apiAlbumthing, {
		fields: [apiAlbumthingSharedTo.albumthingId],
		references: [apiAlbumthing.id]
	}),
	apiUser: one(apiUser, {
		fields: [apiAlbumthingSharedTo.userId],
		references: [apiUser.id]
	}),
}));

export const apiAlbumautoSharedToRelations = relations(apiAlbumautoSharedTo, ({one}) => ({
	apiAlbumauto: one(apiAlbumauto, {
		fields: [apiAlbumautoSharedTo.albumautoId],
		references: [apiAlbumauto.id]
	}),
	apiUser: one(apiUser, {
		fields: [apiAlbumautoSharedTo.userId],
		references: [apiUser.id]
	}),
}));

export const apiAlbumautoRelations = relations(apiAlbumauto, ({one, many}) => ({
	apiAlbumautoSharedTos: many(apiAlbumautoSharedTo),
	apiUser: one(apiUser, {
		fields: [apiAlbumauto.ownerId],
		references: [apiUser.id]
	}),
	apiAlbumautoPhotos: many(apiAlbumautoPhotos),
}));

export const apiAlbumplaceSharedToRelations = relations(apiAlbumplaceSharedTo, ({one}) => ({
	apiAlbumplace: one(apiAlbumplace, {
		fields: [apiAlbumplaceSharedTo.albumplaceId],
		references: [apiAlbumplace.id]
	}),
	apiUser: one(apiUser, {
		fields: [apiAlbumplaceSharedTo.userId],
		references: [apiUser.id]
	}),
}));

export const apiAlbumplaceRelations = relations(apiAlbumplace, ({one, many}) => ({
	apiAlbumplaceSharedTos: many(apiAlbumplaceSharedTo),
	apiUser: one(apiUser, {
		fields: [apiAlbumplace.ownerId],
		references: [apiUser.id]
	}),
	apiAlbumplacePhotos: many(apiAlbumplacePhotos),
}));

export const apiAlbumuserSharedToRelations = relations(apiAlbumuserSharedTo, ({one}) => ({
	apiAlbumuser: one(apiAlbumuser, {
		fields: [apiAlbumuserSharedTo.albumuserId],
		references: [apiAlbumuser.id]
	}),
	apiUser: one(apiUser, {
		fields: [apiAlbumuserSharedTo.userId],
		references: [apiUser.id]
	}),
}));

export const apiAlbumuserRelations = relations(apiAlbumuser, ({one, many}) => ({
	apiAlbumuserSharedTos: many(apiAlbumuserSharedTo),
	apiAlbumusershares: many(apiAlbumusershare),
	apiAlbumuserPhotos: many(apiAlbumuserPhotos),
	apiUser: one(apiUser, {
		fields: [apiAlbumuser.ownerId],
		references: [apiUser.id]
	}),
	apiPhoto: one(apiPhoto, {
		fields: [apiAlbumuser.coverPhotoId],
		references: [apiPhoto.id]
	}),
}));

export const apiAlbumusershareRelations = relations(apiAlbumusershare, ({one}) => ({
	apiAlbumuser: one(apiAlbumuser, {
		fields: [apiAlbumusershare.albumId],
		references: [apiAlbumuser.id]
	}),
}));

export const apiLongrunningjobRelations = relations(apiLongrunningjob, ({one}) => ({
	apiUser: one(apiUser, {
		fields: [apiLongrunningjob.startedById],
		references: [apiUser.id]
	}),
}));

export const apiFaceRelations = relations(apiFace, ({one, many}) => ({
	apiPerson_classificationPersonId: one(apiPerson, {
		fields: [apiFace.classificationPersonId],
		references: [apiPerson.id],
		relationName: "apiFace_classificationPersonId_apiPerson_id"
	}),
	apiPerson_clusterPersonId: one(apiPerson, {
		fields: [apiFace.clusterPersonId],
		references: [apiPerson.id],
		relationName: "apiFace_clusterPersonId_apiPerson_id"
	}),
	apiPerson_personId: one(apiPerson, {
		fields: [apiFace.personId],
		references: [apiPerson.id],
		relationName: "apiFace_personId_apiPerson_id"
	}),
	apiCluster: one(apiCluster, {
		fields: [apiFace.clusterId],
		references: [apiCluster.id]
	}),
	apiPhoto: one(apiPhoto, {
		fields: [apiFace.photoId],
		references: [apiPhoto.id]
	}),
	apiPeople: many(apiPerson, {
		relationName: "apiPerson_coverFaceId_apiFace_id"
	}),
}));

export const apiPhotoSharedToRelations = relations(apiPhotoSharedTo, ({one}) => ({
	apiUser: one(apiUser, {
		fields: [apiPhotoSharedTo.userId],
		references: [apiUser.id]
	}),
	apiPhoto: one(apiPhoto, {
		fields: [apiPhotoSharedTo.photoId],
		references: [apiPhoto.id]
	}),
}));

export const apiPhotoFilesRelations = relations(apiPhotoFiles, ({one}) => ({
	apiFile: one(apiFile, {
		fields: [apiPhotoFiles.fileId],
		references: [apiFile.hash]
	}),
	apiPhoto: one(apiPhoto, {
		fields: [apiPhotoFiles.photoId],
		references: [apiPhoto.id]
	}),
}));

export const apiAlbumuserPhotosRelations = relations(apiAlbumuserPhotos, ({one}) => ({
	apiAlbumuser: one(apiAlbumuser, {
		fields: [apiAlbumuserPhotos.albumuserId],
		references: [apiAlbumuser.id]
	}),
	apiPhoto: one(apiPhoto, {
		fields: [apiAlbumuserPhotos.photoId],
		references: [apiPhoto.id]
	}),
}));

export const apiAlbumthingPhotosRelations = relations(apiAlbumthingPhotos, ({one}) => ({
	apiAlbumthing: one(apiAlbumthing, {
		fields: [apiAlbumthingPhotos.albumthingId],
		references: [apiAlbumthing.id]
	}),
	apiPhoto: one(apiPhoto, {
		fields: [apiAlbumthingPhotos.photoId],
		references: [apiPhoto.id]
	}),
}));

export const apiAlbumplacePhotosRelations = relations(apiAlbumplacePhotos, ({one}) => ({
	apiAlbumplace: one(apiAlbumplace, {
		fields: [apiAlbumplacePhotos.albumplaceId],
		references: [apiAlbumplace.id]
	}),
	apiPhoto: one(apiPhoto, {
		fields: [apiAlbumplacePhotos.photoId],
		references: [apiPhoto.id]
	}),
}));

export const apiAlbumdatePhotosRelations = relations(apiAlbumdatePhotos, ({one}) => ({
	apiAlbumdate: one(apiAlbumdate, {
		fields: [apiAlbumdatePhotos.albumdateId],
		references: [apiAlbumdate.id]
	}),
	apiPhoto: one(apiPhoto, {
		fields: [apiAlbumdatePhotos.photoId],
		references: [apiPhoto.id]
	}),
}));

export const apiAlbumautoPhotosRelations = relations(apiAlbumautoPhotos, ({one}) => ({
	apiAlbumauto: one(apiAlbumauto, {
		fields: [apiAlbumautoPhotos.albumautoId],
		references: [apiAlbumauto.id]
	}),
	apiPhoto: one(apiPhoto, {
		fields: [apiAlbumautoPhotos.photoId],
		references: [apiPhoto.id]
	}),
}));

export const apiAlbumthingCoverPhotosRelations = relations(apiAlbumthingCoverPhotos, ({one}) => ({
	apiAlbumthing: one(apiAlbumthing, {
		fields: [apiAlbumthingCoverPhotos.albumthingId],
		references: [apiAlbumthing.id]
	}),
	apiPhoto: one(apiPhoto, {
		fields: [apiAlbumthingCoverPhotos.photoId],
		references: [apiPhoto.id]
	}),
}));

export const apiThumbnailRelations = relations(apiThumbnail, ({one}) => ({
	apiPhoto: one(apiPhoto, {
		fields: [apiThumbnail.photoId],
		references: [apiPhoto.id]
	}),
}));

export const apiPhotoCaptionRelations = relations(apiPhotoCaption, ({one}) => ({
	apiPhoto: one(apiPhoto, {
		fields: [apiPhotoCaption.photoId],
		references: [apiPhoto.id]
	}),
}));

export const apiPhotoSearchRelations = relations(apiPhotoSearch, ({one}) => ({
	apiPhoto: one(apiPhoto, {
		fields: [apiPhotoSearch.photoId],
		references: [apiPhoto.id]
	}),
}));

export const apiPhotostackRelations = relations(apiPhotostack, ({one, many}) => ({
	apiUser: one(apiUser, {
		fields: [apiPhotostack.ownerId],
		references: [apiUser.id]
	}),
	apiPhoto: one(apiPhoto, {
		fields: [apiPhotostack.primaryPhotoId],
		references: [apiPhoto.id]
	}),
	apiStackreviews: many(apiStackreview),
	apiPhotoStacks: many(apiPhotoStacks),
}));

export const apiStackreviewRelations = relations(apiStackreview, ({one}) => ({
	apiPhoto: one(apiPhoto, {
		fields: [apiStackreview.keptPhotoId],
		references: [apiPhoto.id]
	}),
	apiUser: one(apiUser, {
		fields: [apiStackreview.reviewerId],
		references: [apiUser.id]
	}),
	apiPhotostack: one(apiPhotostack, {
		fields: [apiStackreview.stackId],
		references: [apiPhotostack.id]
	}),
}));

export const apiMetadataeditRelations = relations(apiMetadataedit, ({one}) => ({
	apiPhoto: one(apiPhoto, {
		fields: [apiMetadataedit.photoId],
		references: [apiPhoto.id]
	}),
	apiUser: one(apiUser, {
		fields: [apiMetadataedit.userId],
		references: [apiUser.id]
	}),
}));

export const apiMetadatafileRelations = relations(apiMetadatafile, ({one}) => ({
	apiFile: one(apiFile, {
		fields: [apiMetadatafile.fileId],
		references: [apiFile.hash]
	}),
	apiPhoto: one(apiPhoto, {
		fields: [apiMetadatafile.photoId],
		references: [apiPhoto.id]
	}),
}));

export const apiPhotometadataRelations = relations(apiPhotometadata, ({one}) => ({
	apiPhoto: one(apiPhoto, {
		fields: [apiPhotometadata.photoId],
		references: [apiPhoto.id]
	}),
}));

export const accountEmailaddressRelations = relations(accountEmailaddress, ({one, many}) => ({
	apiUser: one(apiUser, {
		fields: [accountEmailaddress.userId],
		references: [apiUser.id]
	}),
	accountEmailconfirmations: many(accountEmailconfirmation),
}));

export const accountEmailconfirmationRelations = relations(accountEmailconfirmation, ({one}) => ({
	accountEmailaddress: one(accountEmailaddress, {
		fields: [accountEmailconfirmation.emailAddressId],
		references: [accountEmailaddress.id]
	}),
}));

export const djangoAdminLogRelations = relations(djangoAdminLog, ({one}) => ({
	djangoContentType: one(djangoContentType, {
		fields: [djangoAdminLog.contentTypeId],
		references: [djangoContentType.id]
	}),
	apiUser: one(apiUser, {
		fields: [djangoAdminLog.userId],
		references: [apiUser.id]
	}),
}));

export const apiPhotoStacksRelations = relations(apiPhotoStacks, ({one}) => ({
	apiPhoto: one(apiPhoto, {
		fields: [apiPhotoStacks.photoId],
		references: [apiPhoto.id]
	}),
	apiPhotostack: one(apiPhotostack, {
		fields: [apiPhotoStacks.photostackId],
		references: [apiPhotostack.id]
	}),
}));

export const apiDuplicateRelations = relations(apiDuplicate, ({one, many}) => ({
	apiPhoto: one(apiPhoto, {
		fields: [apiDuplicate.keptPhotoId],
		references: [apiPhoto.id]
	}),
	apiUser: one(apiUser, {
		fields: [apiDuplicate.ownerId],
		references: [apiUser.id]
	}),
	apiPhotoDuplicates: many(apiPhotoDuplicates),
}));

export const apiPhotoDuplicatesRelations = relations(apiPhotoDuplicates, ({one}) => ({
	apiPhoto: one(apiPhoto, {
		fields: [apiPhotoDuplicates.photoId],
		references: [apiPhoto.id]
	}),
	apiDuplicate: one(apiDuplicate, {
		fields: [apiPhotoDuplicates.duplicateId],
		references: [apiDuplicate.id]
	}),
}));

export const apiTagPhotosRelations = relations(apiTagPhotos, ({one}) => ({
	apiTag: one(apiTag, {
		fields: [apiTagPhotos.tagId],
		references: [apiTag.id]
	}),
	apiPhoto: one(apiPhoto, {
		fields: [apiTagPhotos.photoId],
		references: [apiPhoto.id]
	}),
}));

export const apiTagRelations = relations(apiTag, ({one, many}) => ({
	apiTagPhotos: many(apiTagPhotos),
	apiUser: one(apiUser, {
		fields: [apiTag.ownerId],
		references: [apiUser.id]
	}),
}));

export const apiPhotoOcrRelations = relations(apiPhotoOcr, ({one}) => ({
	apiPhoto: one(apiPhoto, {
		fields: [apiPhotoOcr.photoId],
		references: [apiPhoto.id]
	}),
}));

export const apiPhotoshareRelations = relations(apiPhotoshare, ({one}) => ({
	apiPhoto: one(apiPhoto, {
		fields: [apiPhotoshare.photoId],
		references: [apiPhoto.id]
	}),
}));

export const apiDeletionlogRelations = relations(apiDeletionlog, ({one}) => ({
	apiUser: one(apiUser, {
		fields: [apiDeletionlog.ownerId],
		references: [apiUser.id]
	}),
}));

export const chunkedUploadChunkeduploadRelations = relations(chunkedUploadChunkedupload, ({one}) => ({
	apiUser: one(apiUser, {
		fields: [chunkedUploadChunkedupload.userId],
		references: [apiUser.id]
	}),
}));

export const socialaccountSocialaccountRelations = relations(socialaccountSocialaccount, ({one, many}) => ({
	apiUser: one(apiUser, {
		fields: [socialaccountSocialaccount.userId],
		references: [apiUser.id]
	}),
	socialaccountSocialtokens: many(socialaccountSocialtoken),
}));

export const socialaccountSocialappSitesRelations = relations(socialaccountSocialappSites, ({one}) => ({
	socialaccountSocialapp: one(socialaccountSocialapp, {
		fields: [socialaccountSocialappSites.socialappId],
		references: [socialaccountSocialapp.id]
	}),
	djangoSite: one(djangoSite, {
		fields: [socialaccountSocialappSites.siteId],
		references: [djangoSite.id]
	}),
}));

export const socialaccountSocialappRelations = relations(socialaccountSocialapp, ({many}) => ({
	socialaccountSocialappSites: many(socialaccountSocialappSites),
	socialaccountSocialtokens: many(socialaccountSocialtoken),
}));

export const djangoSiteRelations = relations(djangoSite, ({many}) => ({
	socialaccountSocialappSites: many(socialaccountSocialappSites),
}));

export const socialaccountSocialtokenRelations = relations(socialaccountSocialtoken, ({one}) => ({
	socialaccountSocialaccount: one(socialaccountSocialaccount, {
		fields: [socialaccountSocialtoken.accountId],
		references: [socialaccountSocialaccount.id]
	}),
	socialaccountSocialapp: one(socialaccountSocialapp, {
		fields: [socialaccountSocialtoken.appId],
		references: [socialaccountSocialapp.id]
	}),
}));

export const tokenBlacklistOutstandingtokenRelations = relations(tokenBlacklistOutstandingtoken, ({one, many}) => ({
	apiUser: one(apiUser, {
		fields: [tokenBlacklistOutstandingtoken.userId],
		references: [apiUser.id]
	}),
	tokenBlacklistBlacklistedtokens: many(tokenBlacklistBlacklistedtoken),
}));

export const tokenBlacklistBlacklistedtokenRelations = relations(tokenBlacklistBlacklistedtoken, ({one}) => ({
	tokenBlacklistOutstandingtoken: one(tokenBlacklistOutstandingtoken, {
		fields: [tokenBlacklistBlacklistedtoken.tokenId],
		references: [tokenBlacklistOutstandingtoken.id]
	}),
}));