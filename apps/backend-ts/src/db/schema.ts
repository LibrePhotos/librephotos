import { customType, pgTable, integer, varchar, timestamp, unique, index, foreignKey, text,  check, boolean, bigserial, bigint, doublePrecision, uuid, date, type AnyPgColumn, uniqueIndex, smallint } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

// Bun's driver already JSON-encodes objects/arrays/strings bound to jsonb;
// drizzle's own jsonb() would stringify first and store a JSON *string*.
// Scalars (numbers, booleans) can't be bound this way: write those with
// sql`${JSON.stringify(v)}::text::jsonb`.
const jsonb = customType<{ data: any; driverData: any }>({ dataType: () => "jsonb", toDriver: (v) => v, fromDriver: (v) => v });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });



export const djangoMigrations = pgTable("django_migrations", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "django_migrations_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	app: varchar({ length: 255 }).notNull(),
	name: varchar({ length: 255 }).notNull(),
	applied: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
});

export const djangoContentType = pgTable("django_content_type", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "django_content_type_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	appLabel: varchar("app_label", { length: 100 }).notNull(),
	model: varchar({ length: 100 }).notNull(),
}, (table) => [
	unique("django_content_type_app_label_model_76bd3d3b_uniq").on(table.appLabel, table.model),
]);

export const authPermission = pgTable("auth_permission", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "auth_permission_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	name: varchar({ length: 255 }).notNull(),
	contentTypeId: integer("content_type_id").notNull(),
	codename: varchar({ length: 100 }).notNull(),
}, (table) => [
	index("auth_permission_content_type_id_2f476e4b").using("btree", table.contentTypeId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.contentTypeId],
			foreignColumns: [djangoContentType.id],
			name: "auth_permission_content_type_id_2f476e4b_fk_django_co"
		}),
	unique("auth_permission_content_type_id_codename_01ab375a_uniq").on(table.contentTypeId, table.codename),
]);

export const authGroup = pgTable("auth_group", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "auth_group_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	name: varchar({ length: 150 }).notNull(),
}, (table) => [
	index("auth_group_name_a6ea08ec_like").using("btree", table.name.asc().nullsLast().op("varchar_pattern_ops")),
	unique("auth_group_name_key").on(table.name),
]);

export const authGroupPermissions = pgTable("auth_group_permissions", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "auth_group_permissions_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	groupId: integer("group_id").notNull(),
	permissionId: integer("permission_id").notNull(),
}, (table) => [
	index("auth_group_permissions_group_id_b120cbf9").using("btree", table.groupId.asc().nullsLast().op("int4_ops")),
	index("auth_group_permissions_permission_id_84c5c92e").using("btree", table.permissionId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [authGroup.id],
			name: "auth_group_permissions_group_id_b120cbf9_fk_auth_group_id"
		}),
	foreignKey({
			columns: [table.permissionId],
			foreignColumns: [authPermission.id],
			name: "auth_group_permissio_permission_id_84c5c92e_fk_auth_perm"
		}),
	unique("auth_group_permissions_group_id_permission_id_0cd325b0_uniq").on(table.groupId, table.permissionId),
]);

export const siteSettings = pgTable("site_settings", {
	key: text().primaryKey().notNull(),
	value: jsonb().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const refreshToken = pgTable("refresh_token", {
	jti: varchar({ length: 64 }).primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	issuedAt: timestamp("issued_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("refresh_token_expires_at_idx").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")),
	index("refresh_token_user_id_idx").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [apiUser.id],
			name: "refresh_token_user_id_fkey"
		}).onDelete("cascade"),
]);

export const apiFile = pgTable("api_file", {
	hash: varchar({ length: 64 }).primaryKey().notNull(),
	path: text().notNull(),
	type: integer().notNull(),
	missing: boolean().notNull(),
}, (table) => [
	index("api_file_hash_4c68c93a_like").using("btree", table.hash.asc().nullsLast().op("varchar_pattern_ops")),
	index("api_file_path_5dee9904_like").using("btree", table.path.asc().nullsLast().op("text_pattern_ops")),
	unique("api_file_path_5dee9904_uniq").on(table.path),
	check("api_file_type_check", sql`type >= 0`),
]);

export const jobQueue = pgTable("job_queue", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	kind: text().notNull(),
	payload: jsonb().default({}).notNull(),
	status: text().default('queued').notNull(),
	lrjId: varchar("lrj_id", { length: 36 }),
	groupId: text("group_id"),
	runAfter: timestamp("run_after", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	attempts: integer().default(0).notNull(),
	maxAttempts: integer("max_attempts").default(1).notNull(),
	lockedBy: text("locked_by"),
	heartbeatAt: timestamp("heartbeat_at", { withTimezone: true, mode: 'string' }),
	lastError: text("last_error"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }),
	finishedAt: timestamp("finished_at", { withTimezone: true, mode: 'string' }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	dependsOn: bigint("depends_on", { mode: "number" }).array().default([]).notNull(),
}, (table) => [
	index("job_queue_claim_idx").using("btree", table.runAfter.asc().nullsLast().op("int8_ops"), table.id.asc().nullsLast().op("int8_ops")).where(sql`(status = 'queued'::text)`),
	index("job_queue_depends_on_idx").using("gin", table.dependsOn.asc().nullsLast().op("array_ops")).where(sql`(status = 'queued'::text)`),
	index("job_queue_group_id_idx").using("btree", table.groupId.asc().nullsLast().op("text_ops")).where(sql`(group_id IS NOT NULL)`),
	index("job_queue_lrj_id_idx").using("btree", table.lrjId.asc().nullsLast().op("text_ops")).where(sql`(lrj_id IS NOT NULL)`),
	index("job_queue_running_idx").using("btree", table.heartbeatAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = 'running'::text)`),
	check("job_queue_status_check", sql`status = ANY (ARRAY['queued'::text, 'running'::text, 'done'::text, 'failed'::text, 'cancelled'::text])`),
]);

export const scheduleState = pgTable("schedule_state", {
	name: text().primaryKey().notNull(),
	lastRunAt: timestamp("last_run_at", { withTimezone: true, mode: 'string' }),
	nextRunAt: timestamp("next_run_at", { withTimezone: true, mode: 'string' }),
});

export const rateLimitHit = pgTable("rate_limit_hit", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	scope: varchar({ length: 64 }).notNull(),
	ident: varchar({ length: 255 }).notNull(),
	hitAt: timestamp("hit_at", { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("rate_limit_hit_scope_ident_idx").using("btree", table.scope.asc().nullsLast().op("text_ops"), table.ident.asc().nullsLast().op("text_ops"), table.hitAt.asc().nullsLast().op("text_ops")),
]);

export const apiUserGroups = pgTable("api_user_groups", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_user_groups_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	userId: integer("user_id").notNull(),
	groupId: integer("group_id").notNull(),
}, (table) => [
	index("api_user_groups_group_id_3af85785").using("btree", table.groupId.asc().nullsLast().op("int4_ops")),
	index("api_user_groups_user_id_a5ff39fa").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [apiUser.id],
			name: "api_user_groups_user_id_a5ff39fa_fk_api_user_id"
		}),
	foreignKey({
			columns: [table.groupId],
			foreignColumns: [authGroup.id],
			name: "api_user_groups_group_id_3af85785_fk_auth_group_id"
		}),
	unique("api_user_groups_user_id_group_id_9c7ddfb5_uniq").on(table.userId, table.groupId),
]);

export const apiUserUserPermissions = pgTable("api_user_user_permissions", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_user_user_permissions_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	userId: integer("user_id").notNull(),
	permissionId: integer("permission_id").notNull(),
}, (table) => [
	index("api_user_user_permissions_permission_id_305b7fea").using("btree", table.permissionId.asc().nullsLast().op("int4_ops")),
	index("api_user_user_permissions_user_id_f3945d65").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [apiUser.id],
			name: "api_user_user_permissions_user_id_f3945d65_fk_api_user_id"
		}),
	foreignKey({
			columns: [table.permissionId],
			foreignColumns: [authPermission.id],
			name: "api_user_user_permis_permission_id_305b7fea_fk_auth_perm"
		}),
	unique("api_user_user_permissions_user_id_permission_id_a06dd704_uniq").on(table.userId, table.permissionId),
]);

export const apiCluster = pgTable("api_cluster", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_cluster_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	meanFaceEncoding: text("mean_face_encoding").notNull(),
	clusterId: integer("cluster_id"),
	name: text(),
	personId: integer("person_id"),
	ownerId: integer("owner_id"),
}, (table) => [
	index("api_cluster_owner_id_ddf57161").using("btree", table.ownerId.asc().nullsLast().op("int4_ops")),
	index("api_cluster_person_id_de1e4b3c").using("btree", table.personId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.personId],
			foreignColumns: [apiPerson.id],
			name: "api_cluster_person_id_de1e4b3c_fk_api_person_id"
		}),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [apiUser.id],
			name: "api_cluster_owner_id_ddf57161_fk_api_user_id"
		}),
]);

export const apiFileEmbeddedMedia = pgTable("api_file_embedded_media", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_file_embedded_media_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	fromFileId: varchar("from_file_id", { length: 64 }).notNull(),
	toFileId: varchar("to_file_id", { length: 64 }).notNull(),
}, (table) => [
	index("api_file_embedded_media_from_file_id_9cd74d0d").using("btree", table.fromFileId.asc().nullsLast().op("text_ops")),
	index("api_file_embedded_media_from_file_id_9cd74d0d_like").using("btree", table.fromFileId.asc().nullsLast().op("varchar_pattern_ops")),
	index("api_file_embedded_media_to_file_id_69f18a1c").using("btree", table.toFileId.asc().nullsLast().op("text_ops")),
	index("api_file_embedded_media_to_file_id_69f18a1c_like").using("btree", table.toFileId.asc().nullsLast().op("varchar_pattern_ops")),
	foreignKey({
			columns: [table.fromFileId],
			foreignColumns: [apiFile.hash],
			name: "api_file_embedded_media_from_file_id_9cd74d0d_fk_api_file_hash"
		}),
	foreignKey({
			columns: [table.toFileId],
			foreignColumns: [apiFile.hash],
			name: "api_file_embedded_media_to_file_id_69f18a1c_fk_api_file_hash"
		}),
	unique("api_file_embedded_media_from_file_id_to_file_id_dda3a651_uniq").on(table.fromFileId, table.toFileId),
]);

export const apiUser = pgTable("api_user", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_user_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	password: varchar({ length: 128 }).notNull(),
	lastLogin: timestamp("last_login", { withTimezone: true, mode: 'string' }),
	isSuperuser: boolean("is_superuser").notNull(),
	username: varchar({ length: 150 }).notNull(),
	firstName: varchar("first_name", { length: 150 }).notNull(),
	lastName: varchar("last_name", { length: 150 }).notNull(),
	email: varchar({ length: 254 }).notNull(),
	isStaff: boolean("is_staff").notNull(),
	isActive: boolean("is_active").notNull(),
	dateJoined: timestamp("date_joined", { withTimezone: true, mode: 'string' }).notNull(),
	scanDirectory: varchar("scan_directory", { length: 512 }).notNull(),
	avatar: varchar({ length: 100 }),
	nextcloudServerAddress: varchar("nextcloud_server_address", { length: 200 }).notNull(),
	nextcloudUsername: varchar("nextcloud_username", { length: 64 }).notNull(),
	nextcloudAppPassword: bytea("nextcloud_app_password").notNull(),
	nextcloudScanDirectory: varchar("nextcloud_scan_directory", { length: 512 }).notNull(),
	confidence: doublePrecision().notNull(),
	semanticSearchTopk: integer("semantic_search_topk").notNull(),
	favoriteMinRating: integer("favorite_min_rating").notNull(),
	imageScale: doublePrecision("image_scale").notNull(),
	saveMetadataToDisk: text("save_metadata_to_disk").notNull(),
	transcodeVideos: boolean("transcode_videos").notNull(),
	datetimeRules: jsonb("datetime_rules").notNull(),
	defaultTimezone: text("default_timezone").notNull(),
	confidencePerson: doublePrecision("confidence_person").notNull(),
	publicSharing: boolean("public_sharing").notNull(),
	confidenceUnknownFace: doublePrecision("confidence_unknown_face").notNull(),
	faceRecognitionModel: text("face_recognition_model").notNull(),
	minClusterSize: integer("min_cluster_size").notNull(),
	clusterSelectionEpsilon: doublePrecision("cluster_selection_epsilon").notNull(),
	minSamples: integer("min_samples").notNull(),
	llmSettings: jsonb("llm_settings").notNull(),
	textAlignment: text("text_alignment").notNull(),
	headerSize: text("header_size").notNull(),
	skipRawFiles: boolean("skip_raw_files").notNull(),
	slideshowInterval: integer("slideshow_interval").notNull(),
	duplicateClearExisting: boolean("duplicate_clear_existing").notNull(),
	duplicateSensitivity: text("duplicate_sensitivity").notNull(),
	burstDetectionRules: jsonb("burst_detection_rules").notNull(),
	stackRawJpeg: boolean("stack_raw_jpeg").notNull(),
	publicSharingDefaults: jsonb("public_sharing_defaults").notNull(),
	saveFaceTagsToDisk: boolean("save_face_tags_to_disk").notNull(),
	lastModified: timestamp("last_modified", { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("api_user_confidence_4ccde6b4").using("btree", table.confidence.asc().nullsLast().op("float8_ops")),
	index("api_user_favorite_min_rating_3cb1cf14").using("btree", table.favoriteMinRating.asc().nullsLast().op("int4_ops")),
	index("api_user_last_modified_e2efd2d6").using("btree", table.lastModified.asc().nullsLast().op("timestamptz_ops")),
	index("api_user_nextcloud_scan_directory_a85dc569").using("btree", table.nextcloudScanDirectory.asc().nullsLast().op("text_ops")),
	index("api_user_nextcloud_scan_directory_a85dc569_like").using("btree", table.nextcloudScanDirectory.asc().nullsLast().op("varchar_pattern_ops")),
	index("api_user_scan_directory_ad54b748").using("btree", table.scanDirectory.asc().nullsLast().op("text_ops")),
	index("api_user_scan_directory_ad54b748_like").using("btree", table.scanDirectory.asc().nullsLast().op("varchar_pattern_ops")),
	index("api_user_username_cf4e88d2_like").using("btree", table.username.asc().nullsLast().op("varchar_pattern_ops")),
	unique("api_user_username_key").on(table.username),
]);

export const lpPhotoFacesScanned = pgTable("lp_photo_faces_scanned", {
	photoId: uuid("photo_id").primaryKey().notNull(),
	model: varchar({ length: 64 }).notNull(),
	scannedAt: timestamp("scanned_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.photoId],
			foreignColumns: [apiPhoto.id],
			name: "lp_photo_faces_scanned_photo_id_fkey"
		}).onDelete("cascade"),
]);

export const apiAlbumdate = pgTable("api_albumdate", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_albumdate_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	title: varchar({ length: 512 }).notNull(),
	date: date(),
	favorited: boolean().notNull(),
	location: jsonb(),
	ownerId: integer("owner_id").notNull(),
}, (table) => [
	index("api_albumdate_date_b825aef0").using("btree", table.date.asc().nullsLast().op("date_ops")),
	index("api_albumdate_favorited_9f3d4007").using("btree", table.favorited.asc().nullsLast().op("bool_ops")),
	index("api_albumdate_location_dbba885f").using("btree", table.location.asc().nullsLast().op("jsonb_ops")),
	index("api_albumdate_owner_id_2745f84a").using("btree", table.ownerId.asc().nullsLast().op("int4_ops")),
	index("api_albumdate_title_c0a886cc").using("btree", table.title.asc().nullsLast().op("text_ops")),
	index("api_albumdate_title_c0a886cc_like").using("btree", table.title.asc().nullsLast().op("varchar_pattern_ops")),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [apiUser.id],
			name: "api_albumdate_owner_id_2745f84a_fk_api_user_id"
		}),
	unique("api_albumdate_date_owner_id_5ba3d470_uniq").on(table.date, table.ownerId),
]);

export const apiAlbumdateSharedTo = pgTable("api_albumdate_shared_to", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_albumdate_shared_to_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	albumdateId: integer("albumdate_id").notNull(),
	userId: integer("user_id").notNull(),
}, (table) => [
	index("api_albumdate_shared_to_albumdate_id_6d32c8dc").using("btree", table.albumdateId.asc().nullsLast().op("int4_ops")),
	index("api_albumdate_shared_to_user_id_9ccf440e").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.albumdateId],
			foreignColumns: [apiAlbumdate.id],
			name: "api_albumdate_shared_albumdate_id_6d32c8dc_fk_api_album"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [apiUser.id],
			name: "api_albumdate_shared_to_user_id_9ccf440e_fk_api_user_id"
		}),
	unique("api_albumdate_shared_to_albumdate_id_user_id_7eb2d2bf_uniq").on(table.albumdateId, table.userId),
]);

export const apiAlbumthing = pgTable("api_albumthing", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_albumthing_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	title: varchar({ length: 512 }).notNull(),
	thingType: varchar("thing_type", { length: 512 }),
	favorited: boolean().notNull(),
	ownerId: integer("owner_id").notNull(),
	photoCount: integer("photo_count").notNull(),
	lastModified: timestamp("last_modified", { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("api_albumthing_favorited_70dc6840").using("btree", table.favorited.asc().nullsLast().op("bool_ops")),
	index("api_albumthing_last_modified_6aab255b").using("btree", table.lastModified.asc().nullsLast().op("timestamptz_ops")),
	index("api_albumthing_owner_id_b61d1b00").using("btree", table.ownerId.asc().nullsLast().op("int4_ops")),
	index("api_albumthing_thing_type_924227a6").using("btree", table.thingType.asc().nullsLast().op("text_ops")),
	index("api_albumthing_thing_type_924227a6_like").using("btree", table.thingType.asc().nullsLast().op("varchar_pattern_ops")),
	index("api_albumthing_title_e9b82e55").using("btree", table.title.asc().nullsLast().op("text_ops")),
	index("api_albumthing_title_e9b82e55_like").using("btree", table.title.asc().nullsLast().op("varchar_pattern_ops")),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [apiUser.id],
			name: "api_albumthing_owner_id_b61d1b00_fk_api_user_id"
		}),
	unique("unique AlbumThing").on(table.title, table.thingType, table.ownerId),
]);

export const apiAlbumthingSharedTo = pgTable("api_albumthing_shared_to", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_albumthing_shared_to_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	albumthingId: integer("albumthing_id").notNull(),
	userId: integer("user_id").notNull(),
}, (table) => [
	index("api_albumthing_shared_to_albumthing_id_b81ac20a").using("btree", table.albumthingId.asc().nullsLast().op("int4_ops")),
	index("api_albumthing_shared_to_user_id_40c200a0").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.albumthingId],
			foreignColumns: [apiAlbumthing.id],
			name: "api_albumthing_share_albumthing_id_b81ac20a_fk_api_album"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [apiUser.id],
			name: "api_albumthing_shared_to_user_id_40c200a0_fk_api_user_id"
		}),
	unique("api_albumthing_shared_to_albumthing_id_user_id_05b7dbd1_uniq").on(table.albumthingId, table.userId),
]);

export const apiAlbumautoSharedTo = pgTable("api_albumauto_shared_to", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_albumauto_shared_to_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	albumautoId: integer("albumauto_id").notNull(),
	userId: integer("user_id").notNull(),
}, (table) => [
	index("api_albumauto_shared_to_albumauto_id_94c13ddb").using("btree", table.albumautoId.asc().nullsLast().op("int4_ops")),
	index("api_albumauto_shared_to_user_id_cf09f962").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.albumautoId],
			foreignColumns: [apiAlbumauto.id],
			name: "api_albumauto_shared_albumauto_id_94c13ddb_fk_api_album"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [apiUser.id],
			name: "api_albumauto_shared_to_user_id_cf09f962_fk_api_user_id"
		}),
	unique("api_albumauto_shared_to_albumauto_id_user_id_332148f8_uniq").on(table.albumautoId, table.userId),
]);

export const apiAlbumplaceSharedTo = pgTable("api_albumplace_shared_to", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_albumplace_shared_to_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	albumplaceId: integer("albumplace_id").notNull(),
	userId: integer("user_id").notNull(),
}, (table) => [
	index("api_albumplace_shared_to_albumplace_id_1c57a597").using("btree", table.albumplaceId.asc().nullsLast().op("int4_ops")),
	index("api_albumplace_shared_to_user_id_82c38c75").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.albumplaceId],
			foreignColumns: [apiAlbumplace.id],
			name: "api_albumplace_share_albumplace_id_1c57a597_fk_api_album"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [apiUser.id],
			name: "api_albumplace_shared_to_user_id_82c38c75_fk_api_user_id"
		}),
	unique("api_albumplace_shared_to_albumplace_id_user_id_878b44ef_uniq").on(table.albumplaceId, table.userId),
]);

export const apiAlbumauto = pgTable("api_albumauto", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_albumauto_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	title: varchar({ length: 512 }).notNull(),
	timestamp: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	createdOn: timestamp("created_on", { withTimezone: true, mode: 'string' }).notNull(),
	gpsLat: doublePrecision("gps_lat"),
	gpsLon: doublePrecision("gps_lon"),
	favorited: boolean().notNull(),
	ownerId: integer("owner_id").notNull(),
	lastModified: timestamp("last_modified", { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("api_albumauto_created_on_0c5c92b6").using("btree", table.createdOn.asc().nullsLast().op("timestamptz_ops")),
	index("api_albumauto_favorited_68743c7f").using("btree", table.favorited.asc().nullsLast().op("bool_ops")),
	index("api_albumauto_last_modified_97dd0117").using("btree", table.lastModified.asc().nullsLast().op("timestamptz_ops")),
	index("api_albumauto_owner_id_e83d8f88").using("btree", table.ownerId.asc().nullsLast().op("int4_ops")),
	index("api_albumauto_timestamp_584f1589").using("btree", table.timestamp.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [apiUser.id],
			name: "api_albumauto_owner_id_e83d8f88_fk_api_user_id"
		}),
	unique("api_albumauto_timestamp_owner_id_314a1d7f_uniq").on(table.timestamp, table.ownerId),
]);

export const apiAlbumplace = pgTable("api_albumplace", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_albumplace_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	title: varchar({ length: 512 }).notNull(),
	geolocationLevel: integer("geolocation_level"),
	favorited: boolean().notNull(),
	ownerId: integer("owner_id").notNull(),
	lastModified: timestamp("last_modified", { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("api_albumplace_favorited_ddb4a4c3").using("btree", table.favorited.asc().nullsLast().op("bool_ops")),
	index("api_albumplace_geolocation_level_35fbd31f").using("btree", table.geolocationLevel.asc().nullsLast().op("int4_ops")),
	index("api_albumplace_last_modified_09b846bd").using("btree", table.lastModified.asc().nullsLast().op("timestamptz_ops")),
	index("api_albumplace_owner_id_6bd352e3").using("btree", table.ownerId.asc().nullsLast().op("int4_ops")),
	index("api_albumplace_title_6cafeb2d").using("btree", table.title.asc().nullsLast().op("text_ops")),
	index("api_albumplace_title_6cafeb2d_like").using("btree", table.title.asc().nullsLast().op("varchar_pattern_ops")),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [apiUser.id],
			name: "api_albumplace_owner_id_6bd352e3_fk_api_user_id"
		}),
	unique("api_albumplace_title_owner_id_851514f9_uniq").on(table.title, table.ownerId),
]);

export const apiAlbumuserSharedTo = pgTable("api_albumuser_shared_to", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_albumuser_shared_to_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	albumuserId: integer("albumuser_id").notNull(),
	userId: integer("user_id").notNull(),
}, (table) => [
	index("api_albumuser_shared_to_albumuser_id_037fbb43").using("btree", table.albumuserId.asc().nullsLast().op("int4_ops")),
	index("api_albumuser_shared_to_user_id_60ab3643").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.albumuserId],
			foreignColumns: [apiAlbumuser.id],
			name: "api_albumuser_shared_albumuser_id_037fbb43_fk_api_album"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [apiUser.id],
			name: "api_albumuser_shared_to_user_id_60ab3643_fk_api_user_id"
		}),
	unique("api_albumuser_shared_to_albumuser_id_user_id_3c6a4938_uniq").on(table.albumuserId, table.userId),
]);

export const apiAlbumusershare = pgTable("api_albumusershare", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_albumusershare_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	enabled: boolean().notNull(),
	slug: varchar({ length: 64 }),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
	albumId: integer("album_id").notNull(),
	shareLocation: boolean("share_location"),
	shareCameraInfo: boolean("share_camera_info"),
	shareTimestamps: boolean("share_timestamps"),
	shareCaptions: boolean("share_captions"),
	shareFaces: boolean("share_faces"),
}, (table) => [
	index("api_albumusershare_enabled_a7f334cf").using("btree", table.enabled.asc().nullsLast().op("bool_ops")),
	index("api_albumusershare_expires_at_2a6e99b3").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")),
	index("api_albumusershare_slug_4ffa81fc_like").using("btree", table.slug.asc().nullsLast().op("varchar_pattern_ops")),
	foreignKey({
			columns: [table.albumId],
			foreignColumns: [apiAlbumuser.id],
			name: "api_albumusershare_album_id_bb25e1a8_fk_api_albumuser_id"
		}),
	unique("api_albumusershare_slug_key").on(table.slug),
	unique("api_albumusershare_album_id_key").on(table.albumId),
]);

export const apiLongrunningjob = pgTable("api_longrunningjob", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_longrunningjob_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	jobType: integer("job_type").notNull(),
	finished: boolean().notNull(),
	failed: boolean().notNull(),
	jobId: varchar("job_id", { length: 36 }).notNull(),
	queuedAt: timestamp("queued_at", { withTimezone: true, mode: 'string' }).notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }),
	finishedAt: timestamp("finished_at", { withTimezone: true, mode: 'string' }),
	startedById: integer("started_by_id").notNull(),
	progressCurrent: integer("progress_current").notNull(),
	progressTarget: integer("progress_target").notNull(),
	progressStep: varchar("progress_step", { length: 100 }),
	result: jsonb(),
	cancelled: boolean().notNull(),
}, (table) => [
	index("api_longrunningjob_job_id_6b7cfb86_like").using("btree", table.jobId.asc().nullsLast().op("varchar_pattern_ops")),
	index("api_longrunningjob_started_by_id_acef418a").using("btree", table.startedById.asc().nullsLast().op("int4_ops")),
	index("lp_longrunningjob_unfinished_idx").using("btree", table.startedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(NOT finished)`),
	foreignKey({
			columns: [table.startedById],
			foreignColumns: [apiUser.id],
			name: "api_longrunningjob_started_by_id_acef418a_fk_api_user_id"
		}),
	unique("api_longrunningjob_job_id_key").on(table.jobId),
	check("api_longrunningjob_job_type_check", sql`job_type >= 0`),
	check("api_longrunningjob_progress_current_check", sql`progress_current >= 0`),
	check("api_longrunningjob_progress_target_check", sql`progress_target >= 0`),
]);

export const apiPhoto = pgTable("api_photo", {
	imageHash: varchar("image_hash", { length: 64 }).notNull(),
	addedOn: timestamp("added_on", { withTimezone: true, mode: 'string' }).notNull(),
	exifGpsLat: doublePrecision("exif_gps_lat"),
	exifGpsLon: doublePrecision("exif_gps_lon"),
	exifTimestamp: timestamp("exif_timestamp", { withTimezone: true, mode: 'string' }),
	exifJson: jsonb("exif_json"),
	geolocationJson: jsonb("geolocation_json"),
	hidden: boolean().notNull(),
	public: boolean().notNull(),
	ownerId: integer("owner_id").notNull(),
	video: boolean().notNull(),
	clipEmbeddingsMagnitude: doublePrecision("clip_embeddings_magnitude"),
	rating: integer().notNull(),
	videoLength: text("video_length"),
	inTrashcan: boolean("in_trashcan").notNull(),
	timestamp: timestamp({ withTimezone: true, mode: 'string' }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	size: bigint({ mode: "number" }).notNull(),
	mainFileId: varchar("main_file_id", { length: 64 }),
	lastModified: timestamp("last_modified", { withTimezone: true, mode: 'string' }).notNull(),
	removed: boolean().notNull(),
	clipEmbeddings: jsonb("clip_embeddings"),
	perceptualHash: varchar("perceptual_hash", { length: 64 }),
	exifTimestampSubsec: varchar("exif_timestamp_subsec", { length: 10 }),
	imageSequenceNumber: integer("image_sequence_number"),
	id: uuid().defaultRandom().primaryKey().notNull(),
	localOrientation: integer("local_orientation").notNull(),
	isScreenshot: boolean("is_screenshot").notNull(),
	isDocument: boolean("is_document").notNull(),
	categorySource: varchar("category_source", { length: 8 }).notNull(),
	clipEmbeddingsModel: varchar("clip_embeddings_model", { length: 64 }),
}, (table) => [
	index("api_photo_added_on_ababa57d").using("btree", table.addedOn.asc().nullsLast().op("timestamptz_ops")),
	index("api_photo_exif_timestamp_3c113e34").using("btree", table.exifTimestamp.asc().nullsLast().op("timestamptz_ops")),
	index("api_photo_geolocation_json_dc1b353e").using("btree", table.geolocationJson.asc().nullsLast().op("jsonb_ops")),
	index("api_photo_hidden_59a5d521").using("btree", table.hidden.asc().nullsLast().op("bool_ops")),
	index("api_photo_image_hash_6b828f4d").using("btree", table.imageHash.asc().nullsLast().op("text_ops")),
	index("api_photo_image_hash_6b828f4d_like").using("btree", table.imageHash.asc().nullsLast().op("varchar_pattern_ops")),
	index("api_photo_in_trashcan_516d54a0").using("btree", table.inTrashcan.asc().nullsLast().op("bool_ops")),
	index("api_photo_is_document_89ef7db6").using("btree", table.isDocument.asc().nullsLast().op("bool_ops")),
	index("api_photo_is_screenshot_80bd33f2").using("btree", table.isScreenshot.asc().nullsLast().op("bool_ops")),
	index("api_photo_main_file_id_453ba4cc").using("btree", table.mainFileId.asc().nullsLast().op("text_ops")),
	index("api_photo_main_file_id_453ba4cc_like").using("btree", table.mainFileId.asc().nullsLast().op("varchar_pattern_ops")),
	index("api_photo_owner_id_234b5551").using("btree", table.ownerId.asc().nullsLast().op("int4_ops")),
	index("api_photo_perceptual_hash_1076b9f8").using("btree", table.perceptualHash.asc().nullsLast().op("text_ops")),
	index("api_photo_perceptual_hash_1076b9f8_like").using("btree", table.perceptualHash.asc().nullsLast().op("varchar_pattern_ops")),
	index("api_photo_public_d9bcd839").using("btree", table.public.asc().nullsLast().op("bool_ops")),
	index("api_photo_rating_53606e2c").using("btree", table.rating.asc().nullsLast().op("int4_ops")),
	index("api_photo_removed_50380583").using("btree", table.removed.asc().nullsLast().op("bool_ops")),
	index("api_photo_timestamp_92a676d4").using("btree", table.timestamp.asc().nullsLast().op("timestamptz_ops")),
	index("lp_photo_owner_visible_idx").using("btree", table.ownerId.asc().nullsLast().op("int4_ops"), table.id.asc().nullsLast().op("uuid_ops"), table.hidden.asc().nullsLast().op("uuid_ops"), table.inTrashcan.asc().nullsLast().op("uuid_ops")),
	index("photo_sync_keyset_idx").using("btree", table.lastModified.asc().nullsLast().op("timestamptz_ops"), table.id.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.mainFileId],
			foreignColumns: [apiFile.hash],
			name: "api_photo_main_file_id_453ba4cc_fk_api_file_hash"
		}),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [apiUser.id],
			name: "api_photo_owner_id_234b5551_fk_api_user_id"
		}),
]);

export const apiFace = pgTable("api_face", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_face_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	image: varchar({ length: 100 }),
	clusterProbability: doublePrecision("cluster_probability").notNull(),
	locationTop: integer("location_top").notNull(),
	locationBottom: integer("location_bottom").notNull(),
	locationLeft: integer("location_left").notNull(),
	locationRight: integer("location_right").notNull(),
	encoding: text().notNull(),
	personId: integer("person_id"),
	clusterId: integer("cluster_id"),
	classificationProbability: doublePrecision("classification_probability").notNull(),
	deleted: boolean().notNull(),
	classificationPersonId: integer("classification_person_id"),
	clusterPersonId: integer("cluster_person_id"),
	photoId: uuid("photo_id"),
}, (table) => [
	index("api_face_classification_person_id_98d44049").using("btree", table.classificationPersonId.asc().nullsLast().op("int4_ops")),
	index("api_face_classification_probability_688e8040").using("btree", table.classificationProbability.asc().nullsLast().op("float8_ops")),
	index("api_face_cluster_id_7cc7025a").using("btree", table.clusterId.asc().nullsLast().op("int4_ops")),
	index("api_face_cluster_person_id_0a0b4811").using("btree", table.clusterPersonId.asc().nullsLast().op("int4_ops")),
	index("api_face_cluster_probability_89b3b2e2").using("btree", table.clusterProbability.asc().nullsLast().op("float8_ops")),
	index("api_face_person_id_6a0347bd").using("btree", table.personId.asc().nullsLast().op("int4_ops")),
	index("api_face_photo_id_idx").using("btree", table.photoId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.classificationPersonId],
			foreignColumns: [apiPerson.id],
			name: "api_face_classification_person_id_98d44049_fk_api_person_id"
		}),
	foreignKey({
			columns: [table.clusterPersonId],
			foreignColumns: [apiPerson.id],
			name: "api_face_cluster_person_id_0a0b4811_fk_api_person_id"
		}),
	foreignKey({
			columns: [table.personId],
			foreignColumns: [apiPerson.id],
			name: "api_face_person_id_6a0347bd_fk_api_person_id"
		}),
	foreignKey({
			columns: [table.clusterId],
			foreignColumns: [apiCluster.id],
			name: "api_face_cluster_id_7cc7025a_fk_api_cluster_id"
		}),
	foreignKey({
			columns: [table.photoId],
			foreignColumns: [apiPhoto.id],
			name: "api_face_photo_id_fk_api_photo"
		}).onDelete("cascade"),
]);

export const apiPhotoSharedTo = pgTable("api_photo_shared_to", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_photo_shared_to_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	userId: integer("user_id").notNull(),
	photoId: uuid("photo_id"),
}, (table) => [
	index("api_photo_shared_to_photo_id_idx").using("btree", table.photoId.asc().nullsLast().op("uuid_ops")),
	index("api_photo_shared_to_user_id_0407baf2").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [apiUser.id],
			name: "api_photo_shared_to_user_id_0407baf2_fk_api_user_id"
		}),
	foreignKey({
			columns: [table.photoId],
			foreignColumns: [apiPhoto.id],
			name: "api_photo_shared_to_photo_id_fk"
		}).onDelete("cascade"),
]);

export const apiPhotoFiles = pgTable("api_photo_files", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_photo_files_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	fileId: varchar("file_id", { length: 64 }).notNull(),
	photoId: uuid("photo_id"),
}, (table) => [
	index("api_photo_files_file_id_b6d5e335").using("btree", table.fileId.asc().nullsLast().op("text_ops")),
	index("api_photo_files_file_id_b6d5e335_like").using("btree", table.fileId.asc().nullsLast().op("varchar_pattern_ops")),
	index("api_photo_files_photo_id_idx").using("btree", table.photoId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.fileId],
			foreignColumns: [apiFile.hash],
			name: "api_photo_files_file_id_b6d5e335_fk_api_file_hash"
		}),
	foreignKey({
			columns: [table.photoId],
			foreignColumns: [apiPhoto.id],
			name: "api_photo_files_photo_id_fk"
		}).onDelete("cascade"),
]);

export const apiAlbumuserPhotos = pgTable("api_albumuser_photos", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_albumuser_photos_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	albumuserId: integer("albumuser_id").notNull(),
	photoId: uuid("photo_id"),
}, (table) => [
	index("api_albumuser_photos_albumuser_id_80614a80").using("btree", table.albumuserId.asc().nullsLast().op("int4_ops")),
	uniqueIndex("api_albumuser_photos_albumuser_id_photo_id_uniq").using("btree", table.albumuserId.asc().nullsLast().op("int4_ops"), table.photoId.asc().nullsLast().op("uuid_ops")),
	index("api_albumuser_photos_photo_id_idx").using("btree", table.photoId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.albumuserId],
			foreignColumns: [apiAlbumuser.id],
			name: "api_albumuser_photos_albumuser_id_80614a80_fk_api_albumuser_id"
		}),
	foreignKey({
			columns: [table.photoId],
			foreignColumns: [apiPhoto.id],
			name: "api_albumuser_photos_photo_id_fk"
		}).onDelete("cascade"),
]);

export const apiAlbumthingPhotos = pgTable("api_albumthing_photos", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_albumthing_photos_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	albumthingId: integer("albumthing_id").notNull(),
	photoId: uuid("photo_id"),
}, (table) => [
	index("api_albumthing_photos_albumthing_id_00fcb0f3").using("btree", table.albumthingId.asc().nullsLast().op("int4_ops")),
	uniqueIndex("api_albumthing_photos_albumthing_id_photo_id_uniq").using("btree", table.albumthingId.asc().nullsLast().op("int4_ops"), table.photoId.asc().nullsLast().op("uuid_ops")),
	index("api_albumthing_photos_photo_id_idx").using("btree", table.photoId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.albumthingId],
			foreignColumns: [apiAlbumthing.id],
			name: "api_albumthing_photo_albumthing_id_00fcb0f3_fk_api_album"
		}),
	foreignKey({
			columns: [table.photoId],
			foreignColumns: [apiPhoto.id],
			name: "api_albumthing_photos_photo_id_fk"
		}).onDelete("cascade"),
]);

export const apiAlbumplacePhotos = pgTable("api_albumplace_photos", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_albumplace_photos_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	albumplaceId: integer("albumplace_id").notNull(),
	photoId: uuid("photo_id"),
}, (table) => [
	index("api_albumplace_photos_albumplace_id_e0d81074").using("btree", table.albumplaceId.asc().nullsLast().op("int4_ops")),
	uniqueIndex("api_albumplace_photos_albumplace_id_photo_id_uniq").using("btree", table.albumplaceId.asc().nullsLast().op("int4_ops"), table.photoId.asc().nullsLast().op("uuid_ops")),
	index("api_albumplace_photos_photo_id_idx").using("btree", table.photoId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.albumplaceId],
			foreignColumns: [apiAlbumplace.id],
			name: "api_albumplace_photo_albumplace_id_e0d81074_fk_api_album"
		}),
	foreignKey({
			columns: [table.photoId],
			foreignColumns: [apiPhoto.id],
			name: "api_albumplace_photos_photo_id_fk"
		}).onDelete("cascade"),
]);

export const apiAlbumdatePhotos = pgTable("api_albumdate_photos", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_albumdate_photos_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	albumdateId: integer("albumdate_id").notNull(),
	photoId: uuid("photo_id"),
}, (table) => [
	index("api_albumdate_photos_albumdate_id_cd458c5d").using("btree", table.albumdateId.asc().nullsLast().op("int4_ops")),
	uniqueIndex("api_albumdate_photos_albumdate_id_photo_id_uniq").using("btree", table.albumdateId.asc().nullsLast().op("int4_ops"), table.photoId.asc().nullsLast().op("uuid_ops")),
	index("api_albumdate_photos_photo_id_idx").using("btree", table.photoId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.albumdateId],
			foreignColumns: [apiAlbumdate.id],
			name: "api_albumdate_photos_albumdate_id_cd458c5d_fk_api_albumdate_id"
		}),
	foreignKey({
			columns: [table.photoId],
			foreignColumns: [apiPhoto.id],
			name: "api_albumdate_photos_photo_id_fk"
		}).onDelete("cascade"),
]);

export const apiAlbumautoPhotos = pgTable("api_albumauto_photos", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_albumauto_photos_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	albumautoId: integer("albumauto_id").notNull(),
	photoId: uuid("photo_id"),
}, (table) => [
	index("api_albumauto_photos_albumauto_id_86a09378").using("btree", table.albumautoId.asc().nullsLast().op("int4_ops")),
	uniqueIndex("api_albumauto_photos_albumauto_id_photo_id_uniq").using("btree", table.albumautoId.asc().nullsLast().op("int4_ops"), table.photoId.asc().nullsLast().op("uuid_ops")),
	index("api_albumauto_photos_photo_id_idx").using("btree", table.photoId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.albumautoId],
			foreignColumns: [apiAlbumauto.id],
			name: "api_albumauto_photos_albumauto_id_86a09378_fk_api_albumauto_id"
		}),
	foreignKey({
			columns: [table.photoId],
			foreignColumns: [apiPhoto.id],
			name: "api_albumauto_photos_photo_id_fk"
		}).onDelete("cascade"),
]);

export const apiAlbumthingCoverPhotos = pgTable("api_albumthing_cover_photos", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_albumthing_cover_photos_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	albumthingId: integer("albumthing_id").notNull(),
	photoId: uuid("photo_id"),
}, (table) => [
	index("api_albumthing_cover_photos_albumthing_id_aa548eb5").using("btree", table.albumthingId.asc().nullsLast().op("int4_ops")),
	uniqueIndex("api_albumthing_cover_photos_albumthing_id_photo_id_uniq").using("btree", table.albumthingId.asc().nullsLast().op("int4_ops"), table.photoId.asc().nullsLast().op("uuid_ops")),
	index("api_albumthing_cover_photos_photo_id_idx").using("btree", table.photoId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.albumthingId],
			foreignColumns: [apiAlbumthing.id],
			name: "api_albumthing_cover_albumthing_id_aa548eb5_fk_api_album"
		}),
	foreignKey({
			columns: [table.photoId],
			foreignColumns: [apiPhoto.id],
			name: "api_albumthing_cover_photos_photo_id_fk"
		}).onDelete("cascade"),
]);

export const apiThumbnail = pgTable("api_thumbnail", {
	thumbnailBig: varchar("thumbnail_big", { length: 100 }).notNull(),
	squareThumbnail: varchar("square_thumbnail", { length: 100 }).notNull(),
	squareThumbnailSmall: varchar("square_thumbnail_small", { length: 100 }).notNull(),
	aspectRatio: doublePrecision("aspect_ratio"),
	dominantColor: text("dominant_color"),
	photoId: uuid("photo_id").primaryKey().notNull(),
}, (table) => [
	index("lp_thumbnail_ready_idx").using("btree", table.photoId.asc().nullsLast().op("uuid_ops")).where(sql`(aspect_ratio IS NOT NULL)`),
	foreignKey({
			columns: [table.photoId],
			foreignColumns: [apiPhoto.id],
			name: "api_thumbnail_photo_id_fk"
		}).onDelete("cascade"),
]);

export const apiPhotoCaption = pgTable("api_photo_caption", {
	captionsJson: jsonb("captions_json"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).notNull(),
	photoId: uuid("photo_id").primaryKey().notNull(),
}, (table) => [
	index("api_photo_caption_captions_json_70c46fb8").using("btree", table.captionsJson.asc().nullsLast().op("jsonb_ops")),
	foreignKey({
			columns: [table.photoId],
			foreignColumns: [apiPhoto.id],
			name: "api_photo_caption_photo_id_fk"
		}).onDelete("cascade"),
]);

export const apiPhotoSearch = pgTable("api_photo_search", {
	searchCaptions: text("search_captions"),
	searchLocation: text("search_location"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).notNull(),
	photoId: uuid("photo_id").primaryKey().notNull(),
}, (table) => [
	index("api_photo_search_search_captions_929fb6aa").using("btree", table.searchCaptions.asc().nullsLast().op("text_ops")),
	index("api_photo_search_search_captions_929fb6aa_like").using("btree", table.searchCaptions.asc().nullsLast().op("text_pattern_ops")),
	index("api_photo_search_search_location_b864ad60").using("btree", table.searchLocation.asc().nullsLast().op("text_ops")),
	index("api_photo_search_search_location_b864ad60_like").using("btree", table.searchLocation.asc().nullsLast().op("text_pattern_ops")),
	foreignKey({
			columns: [table.photoId],
			foreignColumns: [apiPhoto.id],
			name: "api_photo_search_photo_id_fk"
		}).onDelete("cascade"),
]);

export const apiPhotostack = pgTable("api_photostack", {
	id: uuid().primaryKey().notNull(),
	stackType: varchar("stack_type", { length: 20 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).notNull(),
	sequenceStart: timestamp("sequence_start", { withTimezone: true, mode: 'string' }),
	sequenceEnd: timestamp("sequence_end", { withTimezone: true, mode: 'string' }),
	ownerId: integer("owner_id").notNull(),
	primaryPhotoId: uuid("primary_photo_id"),
}, (table) => [
	index("api_photost_owner_i_40a369_idx").using("btree", table.ownerId.asc().nullsLast().op("int4_ops"), table.stackType.asc().nullsLast().op("text_ops")),
	index("api_photostack_owner_id_56d8148c").using("btree", table.ownerId.asc().nullsLast().op("int4_ops")),
	index("api_photostack_primary_photo_id_idx").using("btree", table.primaryPhotoId.asc().nullsLast().op("uuid_ops")),
	index("api_photostack_stack_type_979b3dfd").using("btree", table.stackType.asc().nullsLast().op("text_ops")),
	index("api_photostack_stack_type_979b3dfd_like").using("btree", table.stackType.asc().nullsLast().op("varchar_pattern_ops")),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [apiUser.id],
			name: "api_photostack_owner_id_56d8148c_fk_api_user_id"
		}),
	foreignKey({
			columns: [table.primaryPhotoId],
			foreignColumns: [apiPhoto.id],
			name: "api_photostack_primary_photo_id_fk"
		}).onDelete("set null"),
]);

export const apiPerson = pgTable("api_person", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_person_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	name: varchar({ length: 128 }).notNull(),
	kind: varchar({ length: 10 }).notNull(),
	clusterOwnerId: integer("cluster_owner_id"),
	faceCount: integer("face_count").notNull(),
	coverFaceId: integer("cover_face_id"),
	coverPhotoId: uuid("cover_photo_id"),
	lastModified: timestamp("last_modified", { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("api_person_cluster_owner_id_90df41de").using("btree", table.clusterOwnerId.asc().nullsLast().op("int4_ops")),
	index("api_person_cover_face_id_bdd48874").using("btree", table.coverFaceId.asc().nullsLast().op("int4_ops")),
	index("api_person_cover_photo_id_idx").using("btree", table.coverPhotoId.asc().nullsLast().op("uuid_ops")),
	index("api_person_last_modified_c4a91103").using("btree", table.lastModified.asc().nullsLast().op("timestamptz_ops")),
	index("api_person_name_8e1ce669").using("btree", table.name.asc().nullsLast().op("text_ops")),
	index("api_person_name_8e1ce669_like").using("btree", table.name.asc().nullsLast().op("varchar_pattern_ops")),
	// FK cover_face_id -> api_face.id omitted: the cycle with api_face breaks type inference.
	foreignKey({
			columns: [table.clusterOwnerId],
			foreignColumns: [apiUser.id],
			name: "api_person_cluster_owner_id_90df41de_fk_api_user_id"
		}),
	foreignKey({
			columns: [table.coverPhotoId],
			foreignColumns: [apiPhoto.id],
			name: "api_person_cover_photo_id_fk"
		}).onDelete("set null"),
]);

export const apiAlbumuser = pgTable("api_albumuser", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_albumuser_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	title: varchar({ length: 512 }).notNull(),
	createdOn: timestamp("created_on", { withTimezone: true, mode: 'string' }).notNull(),
	favorited: boolean().notNull(),
	ownerId: integer("owner_id").notNull(),
	coverPhotoId: uuid("cover_photo_id"),
	lastModified: timestamp("last_modified", { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("api_albumuser_cover_photo_id_idx").using("btree", table.coverPhotoId.asc().nullsLast().op("uuid_ops")),
	index("api_albumuser_created_on_0807bc0f").using("btree", table.createdOn.asc().nullsLast().op("timestamptz_ops")),
	index("api_albumuser_favorited_15de9e16").using("btree", table.favorited.asc().nullsLast().op("bool_ops")),
	index("api_albumuser_last_modified_fa65eb43").using("btree", table.lastModified.asc().nullsLast().op("timestamptz_ops")),
	index("api_albumuser_owner_id_df3b5510").using("btree", table.ownerId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [apiUser.id],
			name: "api_albumuser_owner_id_df3b5510_fk_api_user_id"
		}),
	foreignKey({
			columns: [table.coverPhotoId],
			foreignColumns: [apiPhoto.id],
			name: "api_albumuser_cover_photo_id_fk"
		}).onDelete("set null"),
	unique("api_albumuser_title_owner_id_ef2e4db4_uniq").on(table.title, table.ownerId),
]);

export const apiStackreview = pgTable("api_stackreview", {
	decision: varchar({ length: 20 }).notNull(),
	trashedCount: integer("trashed_count").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).notNull(),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: 'string' }),
	note: text(),
	keptPhotoId: uuid("kept_photo_id"),
	reviewerId: integer("reviewer_id").notNull(),
	stackId: uuid("stack_id").notNull(),
	uuid: uuid().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity({ name: "api_stackreview_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
}, (table) => [
	index("api_stackre_reviewe_48380f_idx").using("btree", table.reviewerId.asc().nullsLast().op("text_ops"), table.decision.asc().nullsLast().op("int4_ops")),
	index("api_stackreview_decision_58df030b").using("btree", table.decision.asc().nullsLast().op("text_ops")),
	index("api_stackreview_decision_58df030b_like").using("btree", table.decision.asc().nullsLast().op("varchar_pattern_ops")),
	index("api_stackreview_kept_photo_id_06685c2e").using("btree", table.keptPhotoId.asc().nullsLast().op("uuid_ops")),
	index("api_stackreview_reviewer_id_9a64c2f8").using("btree", table.reviewerId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.keptPhotoId],
			foreignColumns: [apiPhoto.id],
			name: "api_stackreview_kept_photo_id_06685c2e_fk_api_photo_id"
		}),
	foreignKey({
			columns: [table.reviewerId],
			foreignColumns: [apiUser.id],
			name: "api_stackreview_reviewer_id_9a64c2f8_fk_api_user_id"
		}),
	foreignKey({
			columns: [table.stackId],
			foreignColumns: [apiPhotostack.id],
			name: "api_stackreview_stack_id_13409917_fk_api_photostack_id"
		}),
	unique("api_stackreview_stack_id_key").on(table.stackId),
	unique("api_stackreview_uuid_4b563f53_uniq").on(table.uuid),
]);

export const apiMetadataedit = pgTable("api_metadataedit", {
	id: uuid().primaryKey().notNull(),
	fieldName: varchar("field_name", { length: 100 }).notNull(),
	oldValue: jsonb("old_value"),
	newValue: jsonb("new_value"),
	syncedToFile: boolean("synced_to_file").notNull(),
	syncedAt: timestamp("synced_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).notNull(),
	photoId: uuid("photo_id").notNull(),
	userId: integer("user_id").notNull(),
}, (table) => [
	index("api_metadat_photo_i_21e478_idx").using("btree", table.photoId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("api_metadataedit_photo_id_38524cb3").using("btree", table.photoId.asc().nullsLast().op("uuid_ops")),
	index("api_metadataedit_user_id_83a820d9").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.photoId],
			foreignColumns: [apiPhoto.id],
			name: "api_metadataedit_photo_id_38524cb3_fk_api_photo_id"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [apiUser.id],
			name: "api_metadataedit_user_id_83a820d9_fk_api_user_id"
		}),
]);

export const apiMetadatafile = pgTable("api_metadatafile", {
	id: uuid().primaryKey().notNull(),
	fileType: varchar("file_type", { length: 10 }).notNull(),
	source: varchar({ length: 20 }).notNull(),
	priority: integer().notNull(),
	creatorSoftware: varchar("creator_software", { length: 100 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).notNull(),
	fileId: varchar("file_id", { length: 64 }).notNull(),
	photoId: uuid("photo_id").notNull(),
}, (table) => [
	index("api_metadatafile_file_id_7d12cb10_like").using("btree", table.fileId.asc().nullsLast().op("varchar_pattern_ops")),
	index("api_metadatafile_photo_id_76028904").using("btree", table.photoId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.fileId],
			foreignColumns: [apiFile.hash],
			name: "api_metadatafile_file_id_7d12cb10_fk_api_file_hash"
		}),
	foreignKey({
			columns: [table.photoId],
			foreignColumns: [apiPhoto.id],
			name: "api_metadatafile_photo_id_76028904_fk_api_photo_id"
		}),
	unique("api_metadatafile_file_id_key").on(table.fileId),
]);

export const apiPhotometadata = pgTable("api_photometadata", {
	id: uuid().primaryKey().notNull(),
	aperture: doublePrecision(),
	shutterSpeed: varchar("shutter_speed", { length: 20 }),
	shutterSpeedSeconds: doublePrecision("shutter_speed_seconds"),
	iso: integer(),
	focalLength: doublePrecision("focal_length"),
	focalLength35Mm: integer("focal_length_35mm"),
	exposureCompensation: doublePrecision("exposure_compensation"),
	flashFired: boolean("flash_fired"),
	meteringMode: varchar("metering_mode", { length: 50 }),
	whiteBalance: varchar("white_balance", { length: 50 }),
	cameraMake: varchar("camera_make", { length: 100 }),
	cameraModel: varchar("camera_model", { length: 100 }),
	lensMake: varchar("lens_make", { length: 100 }),
	lensModel: varchar("lens_model", { length: 100 }),
	serialNumber: varchar("serial_number", { length: 100 }),
	width: integer(),
	height: integer(),
	orientation: integer(),
	colorSpace: varchar("color_space", { length: 50 }),
	bitDepth: integer("bit_depth"),
	dateTaken: timestamp("date_taken", { withTimezone: true, mode: 'string' }),
	dateTakenSubsec: varchar("date_taken_subsec", { length: 10 }),
	dateModified: timestamp("date_modified", { withTimezone: true, mode: 'string' }),
	timezoneOffset: varchar("timezone_offset", { length: 10 }),
	gpsLatitude: doublePrecision("gps_latitude"),
	gpsLongitude: doublePrecision("gps_longitude"),
	gpsAltitude: doublePrecision("gps_altitude"),
	locationCountry: varchar("location_country", { length: 100 }),
	locationState: varchar("location_state", { length: 100 }),
	locationCity: varchar("location_city", { length: 100 }),
	locationAddress: text("location_address"),
	title: varchar({ length: 500 }),
	caption: text(),
	keywords: jsonb(),
	rating: integer(),
	copyright: text(),
	creator: varchar({ length: 200 }),
	source: varchar({ length: 20 }).notNull(),
	rawExif: jsonb("raw_exif"),
	rawXmp: jsonb("raw_xmp"),
	rawIptc: jsonb("raw_iptc"),
	version: integer().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).notNull(),
	photoId: uuid("photo_id").notNull(),
}, (table) => [
	index("api_photome_camera__361eac_idx").using("btree", table.cameraMake.asc().nullsLast().op("text_ops"), table.cameraModel.asc().nullsLast().op("text_ops")),
	index("api_photome_date_ta_35e59b_idx").using("btree", table.dateTaken.asc().nullsLast().op("timestamptz_ops")),
	index("api_photome_locatio_1ca8bb_idx").using("btree", table.locationCountry.asc().nullsLast().op("text_ops"), table.locationCity.asc().nullsLast().op("text_ops")),
	index("api_photometadata_aperture_dc8a65b2").using("btree", table.aperture.asc().nullsLast().op("float8_ops")),
	index("api_photometadata_camera_make_c682ef26").using("btree", table.cameraMake.asc().nullsLast().op("text_ops")),
	index("api_photometadata_camera_make_c682ef26_like").using("btree", table.cameraMake.asc().nullsLast().op("varchar_pattern_ops")),
	index("api_photometadata_camera_model_f21bb3a4").using("btree", table.cameraModel.asc().nullsLast().op("text_ops")),
	index("api_photometadata_camera_model_f21bb3a4_like").using("btree", table.cameraModel.asc().nullsLast().op("varchar_pattern_ops")),
	index("api_photometadata_date_taken_01f75f9f").using("btree", table.dateTaken.asc().nullsLast().op("timestamptz_ops")),
	index("api_photometadata_gps_latitude_208b23c0").using("btree", table.gpsLatitude.asc().nullsLast().op("float8_ops")),
	index("api_photometadata_gps_longitude_58c79d9d").using("btree", table.gpsLongitude.asc().nullsLast().op("float8_ops")),
	index("api_photometadata_iso_aa268c5e").using("btree", table.iso.asc().nullsLast().op("int4_ops")),
	index("api_photometadata_lens_model_42c78a22").using("btree", table.lensModel.asc().nullsLast().op("text_ops")),
	index("api_photometadata_lens_model_42c78a22_like").using("btree", table.lensModel.asc().nullsLast().op("varchar_pattern_ops")),
	index("api_photometadata_location_city_ef02387c").using("btree", table.locationCity.asc().nullsLast().op("text_ops")),
	index("api_photometadata_location_city_ef02387c_like").using("btree", table.locationCity.asc().nullsLast().op("varchar_pattern_ops")),
	index("api_photometadata_location_country_e2b954aa").using("btree", table.locationCountry.asc().nullsLast().op("text_ops")),
	index("api_photometadata_location_country_e2b954aa_like").using("btree", table.locationCountry.asc().nullsLast().op("varchar_pattern_ops")),
	index("api_photometadata_rating_4bc76fc1").using("btree", table.rating.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.photoId],
			foreignColumns: [apiPhoto.id],
			name: "api_photometadata_photo_id_ea31a586_fk_api_photo_id"
		}),
	unique("api_photometadata_photo_id_key").on(table.photoId),
]);

export const accountEmailaddress = pgTable("account_emailaddress", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "account_emailaddress_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	email: varchar({ length: 254 }).notNull(),
	verified: boolean().notNull(),
	primary: boolean().notNull(),
	userId: integer("user_id").notNull(),
}, (table) => [
	index("account_emailaddress_email_03be32b2").using("btree", table.email.asc().nullsLast().op("text_ops")),
	index("account_emailaddress_email_03be32b2_like").using("btree", table.email.asc().nullsLast().op("varchar_pattern_ops")),
	index("account_emailaddress_user_id_2c513194").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	uniqueIndex("unique_primary_email").using("btree", table.userId.asc().nullsLast().op("int4_ops"), table.primary.asc().nullsLast().op("bool_ops")).where(sql`"primary"`),
	uniqueIndex("unique_verified_email").using("btree", table.email.asc().nullsLast().op("text_ops")).where(sql`verified`),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [apiUser.id],
			name: "account_emailaddress_user_id_2c513194_fk_api_user_id"
		}),
	unique("account_emailaddress_user_id_email_987c8728_uniq").on(table.email, table.userId),
]);

export const accountEmailconfirmation = pgTable("account_emailconfirmation", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "account_emailconfirmation_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	created: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	sent: timestamp({ withTimezone: true, mode: 'string' }),
	key: varchar({ length: 64 }).notNull(),
	emailAddressId: integer("email_address_id").notNull(),
}, (table) => [
	index("account_emailconfirmation_email_address_id_5b7f8c58").using("btree", table.emailAddressId.asc().nullsLast().op("int4_ops")),
	index("account_emailconfirmation_key_f43612bd_like").using("btree", table.key.asc().nullsLast().op("varchar_pattern_ops")),
	foreignKey({
			columns: [table.emailAddressId],
			foreignColumns: [accountEmailaddress.id],
			name: "account_emailconfirm_email_address_id_5b7f8c58_fk_account_e"
		}),
	unique("account_emailconfirmation_key_key").on(table.key),
]);

export const djangoAdminLog = pgTable("django_admin_log", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "django_admin_log_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	actionTime: timestamp("action_time", { withTimezone: true, mode: 'string' }).notNull(),
	objectId: text("object_id"),
	objectRepr: varchar("object_repr", { length: 200 }).notNull(),
	actionFlag: smallint("action_flag").notNull(),
	changeMessage: text("change_message").notNull(),
	contentTypeId: integer("content_type_id"),
	userId: integer("user_id").notNull(),
}, (table) => [
	index("django_admin_log_content_type_id_c4bce8eb").using("btree", table.contentTypeId.asc().nullsLast().op("int4_ops")),
	index("django_admin_log_user_id_c564eba6").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.contentTypeId],
			foreignColumns: [djangoContentType.id],
			name: "django_admin_log_content_type_id_c4bce8eb_fk_django_co"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [apiUser.id],
			name: "django_admin_log_user_id_c564eba6_fk_api_user_id"
		}),
	check("django_admin_log_action_flag_check", sql`action_flag >= 0`),
]);

export const apiPhotoStacks = pgTable("api_photo_stacks", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_photo_stacks_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	photoId: uuid("photo_id").notNull(),
	photostackId: uuid("photostack_id").notNull(),
}, (table) => [
	index("api_photo_stacks_photo_id_db985d09").using("btree", table.photoId.asc().nullsLast().op("uuid_ops")),
	index("api_photo_stacks_photostack_id_dd4eef21").using("btree", table.photostackId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.photoId],
			foreignColumns: [apiPhoto.id],
			name: "api_photo_stacks_photo_id_db985d09_fk_api_photo_id"
		}),
	foreignKey({
			columns: [table.photostackId],
			foreignColumns: [apiPhotostack.id],
			name: "api_photo_stacks_photostack_id_dd4eef21_fk_api_photostack_id"
		}),
	unique("api_photo_stacks_photo_id_photostack_id_237b9c5b_uniq").on(table.photoId, table.photostackId),
]);

export const apiDuplicate = pgTable("api_duplicate", {
	id: uuid().primaryKey().notNull(),
	duplicateType: varchar("duplicate_type", { length: 20 }).notNull(),
	reviewStatus: varchar("review_status", { length: 20 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).notNull(),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: 'string' }),
	similarityScore: doublePrecision("similarity_score"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	potentialSavings: bigint("potential_savings", { mode: "number" }).notNull(),
	trashedCount: integer("trashed_count").notNull(),
	note: text(),
	keptPhotoId: uuid("kept_photo_id"),
	ownerId: integer("owner_id").notNull(),
}, (table) => [
	index("api_duplica_owner_i_039fa3_idx").using("btree", table.ownerId.asc().nullsLast().op("text_ops"), table.reviewStatus.asc().nullsLast().op("int4_ops")),
	index("api_duplica_owner_i_78a3a4_idx").using("btree", table.ownerId.asc().nullsLast().op("text_ops"), table.duplicateType.asc().nullsLast().op("text_ops")),
	index("api_duplicate_duplicate_type_155b26e2").using("btree", table.duplicateType.asc().nullsLast().op("text_ops")),
	index("api_duplicate_duplicate_type_155b26e2_like").using("btree", table.duplicateType.asc().nullsLast().op("varchar_pattern_ops")),
	index("api_duplicate_kept_photo_id_e0c33ed4").using("btree", table.keptPhotoId.asc().nullsLast().op("uuid_ops")),
	index("api_duplicate_owner_id_3d0c7327").using("btree", table.ownerId.asc().nullsLast().op("int4_ops")),
	index("api_duplicate_review_status_85cc6bfd").using("btree", table.reviewStatus.asc().nullsLast().op("text_ops")),
	index("api_duplicate_review_status_85cc6bfd_like").using("btree", table.reviewStatus.asc().nullsLast().op("varchar_pattern_ops")),
	foreignKey({
			columns: [table.keptPhotoId],
			foreignColumns: [apiPhoto.id],
			name: "api_duplicate_kept_photo_id_e0c33ed4_fk_api_photo_id"
		}),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [apiUser.id],
			name: "api_duplicate_owner_id_3d0c7327_fk_api_user_id"
		}),
]);

export const apiPhotoDuplicates = pgTable("api_photo_duplicates", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_photo_duplicates_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	photoId: uuid("photo_id").notNull(),
	duplicateId: uuid("duplicate_id").notNull(),
}, (table) => [
	index("api_photo_duplicates_duplicate_id_f06a9493").using("btree", table.duplicateId.asc().nullsLast().op("uuid_ops")),
	index("api_photo_duplicates_photo_id_e89217df").using("btree", table.photoId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.photoId],
			foreignColumns: [apiPhoto.id],
			name: "api_photo_duplicates_photo_id_e89217df_fk_api_photo_id"
		}),
	foreignKey({
			columns: [table.duplicateId],
			foreignColumns: [apiDuplicate.id],
			name: "api_photo_duplicates_duplicate_id_f06a9493_fk_api_duplicate_id"
		}),
	unique("api_photo_duplicates_photo_id_duplicate_id_9dd9906e_uniq").on(table.photoId, table.duplicateId),
]);

export const apiEmailconfig = pgTable("api_emailconfig", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_emailconfig_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	provider: varchar({ length: 32 }).notNull(),
	fromEmail: varchar("from_email", { length: 255 }).notNull(),
	host: varchar({ length: 255 }).notNull(),
	port: integer().notNull(),
	useTls: boolean("use_tls").notNull(),
	useSsl: boolean("use_ssl").notNull(),
	username: varchar({ length: 255 }).notNull(),
	secret: bytea("secret").notNull(),
}, (table) => [
	check("api_emailconfig_port_check", sql`port >= 0`),
]);

export const apiTagPhotos = pgTable("api_tag_photos", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_tag_photos_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	tagId: integer("tag_id").notNull(),
	photoId: uuid("photo_id").notNull(),
}, (table) => [
	index("api_tag_photos_photo_id_1a9bb7a5").using("btree", table.photoId.asc().nullsLast().op("uuid_ops")),
	index("api_tag_photos_tag_id_bca93ec5").using("btree", table.tagId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.tagId],
			foreignColumns: [apiTag.id],
			name: "api_tag_photos_tag_id_bca93ec5_fk_api_tag_id"
		}),
	foreignKey({
			columns: [table.photoId],
			foreignColumns: [apiPhoto.id],
			name: "api_tag_photos_photo_id_1a9bb7a5_fk_api_photo_id"
		}),
	unique("api_tag_photos_tag_id_photo_id_cf87bcf0_uniq").on(table.tagId, table.photoId),
]);

export const apiPhotoOcr = pgTable("api_photo_ocr", {
	photoId: uuid("photo_id").primaryKey().notNull(),
	text: text(),
	blocks: jsonb().notNull(),
	engine: varchar({ length: 64 }).notNull(),
	meanConfidence: doublePrecision("mean_confidence"),
	textAreaFraction: doublePrecision("text_area_fraction"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).notNull(),
	sourceWidth: integer("source_width"),
	sourceHeight: integer("source_height"),
}, (table) => [
	index("api_photo_ocr_text_fts").using("gin", sql`to_tsvector('simple'::regconfig, COALESCE(text, ''::text))`),
	foreignKey({
			columns: [table.photoId],
			foreignColumns: [apiPhoto.id],
			name: "api_photo_ocr_photo_id_b60702bc_fk_api_photo_id"
		}),
	check("api_photo_ocr_source_width_check", sql`source_width >= 0`),
	check("api_photo_ocr_source_height_check", sql`source_height >= 0`),
]);

export const apiPhotoshare = pgTable("api_photoshare", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_photoshare_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	enabled: boolean().notNull(),
	slug: varchar({ length: 64 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).notNull(),
	photoId: uuid("photo_id").notNull(),
}, (table) => [
	index("api_photoshare_enabled_20ebda70").using("btree", table.enabled.asc().nullsLast().op("bool_ops")),
	index("api_photoshare_slug_7a28b3d7_like").using("btree", table.slug.asc().nullsLast().op("varchar_pattern_ops")),
	foreignKey({
			columns: [table.photoId],
			foreignColumns: [apiPhoto.id],
			name: "api_photoshare_photo_id_3fce8866_fk_api_photo_id"
		}),
	unique("api_photoshare_slug_key").on(table.slug),
	unique("api_photoshare_photo_id_key").on(table.photoId),
]);

export const apiTag = pgTable("api_tag", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_tag_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	name: varchar({ length: 512 }).notNull(),
	photoCount: integer("photo_count").notNull(),
	ownerId: integer("owner_id").notNull(),
	lastModified: timestamp("last_modified", { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("api_tag_last_modified_6d2b89ff").using("btree", table.lastModified.asc().nullsLast().op("timestamptz_ops")),
	index("api_tag_name_e0f7a95d").using("btree", table.name.asc().nullsLast().op("text_ops")),
	index("api_tag_name_e0f7a95d_like").using("btree", table.name.asc().nullsLast().op("varchar_pattern_ops")),
	index("api_tag_owner_id_18caa483").using("btree", table.ownerId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [apiUser.id],
			name: "api_tag_owner_id_18caa483_fk_api_user_id"
		}),
	unique("unique Tag").on(table.name, table.ownerId),
]);

export const apiDeletionlog = pgTable("api_deletionlog", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "api_deletionlog_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	entity: varchar({ length: 32 }).notNull(),
	entityId: varchar("entity_id", { length: 64 }).notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }).notNull(),
	ownerId: integer("owner_id").notNull(),
}, (table) => [
	index("api_deletionlog_deleted_at_0d4cb74b").using("btree", table.deletedAt.asc().nullsLast().op("timestamptz_ops")),
	index("api_deletionlog_entity_0bdb6728").using("btree", table.entity.asc().nullsLast().op("text_ops")),
	index("api_deletionlog_entity_0bdb6728_like").using("btree", table.entity.asc().nullsLast().op("varchar_pattern_ops")),
	index("api_deletionlog_owner_id_fe3fb028").using("btree", table.ownerId.asc().nullsLast().op("int4_ops")),
	index("deletionlog_scope_idx").using("btree", table.ownerId.asc().nullsLast().op("text_ops"), table.entity.asc().nullsLast().op("text_ops"), table.deletedAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [apiUser.id],
			name: "api_deletionlog_owner_id_fe3fb028_fk_api_user_id"
		}),
]);

export const chunkedUploadChunkedupload = pgTable("chunked_upload_chunkedupload", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "chunked_upload_chunkedupload_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	uploadId: varchar("upload_id", { length: 32 }).notNull(),
	file: varchar({ length: 255 }).notNull(),
	filename: varchar({ length: 255 }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	offset: bigint({ mode: "number" }).notNull(),
	createdOn: timestamp("created_on", { withTimezone: true, mode: 'string' }).notNull(),
	status: smallint().notNull(),
	completedOn: timestamp("completed_on", { withTimezone: true, mode: 'string' }),
	userId: integer("user_id"),
}, (table) => [
	index("chunked_upload_chunkedupload_upload_id_23703435_like").using("btree", table.uploadId.asc().nullsLast().op("varchar_pattern_ops")),
	index("chunked_upload_chunkedupload_user_id_70ff6dbf").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [apiUser.id],
			name: "chunked_upload_chunkedupload_user_id_70ff6dbf_fk_api_user_id"
		}),
	unique("chunked_upload_chunkedupload_upload_id_key").on(table.uploadId),
	check("chunked_upload_chunkedupload_status_check", sql`status >= 0`),
]);

export const constanceConstance = pgTable("constance_constance", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "constance_constance_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	key: varchar({ length: 255 }).notNull(),
	value: text(),
}, (table) => [
	index("constance_constance_key_c43474b0_like").using("btree", table.key.asc().nullsLast().op("varchar_pattern_ops")),
	unique("constance_constance_key_key").on(table.key),
]);

export const djangoQSchedule = pgTable("django_q_schedule", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "django_q_schedule_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	func: varchar({ length: 256 }).notNull(),
	hook: varchar({ length: 256 }),
	args: text(),
	kwargs: text(),
	scheduleType: varchar("schedule_type", { length: 2 }).notNull(),
	repeats: integer().notNull(),
	nextRun: timestamp("next_run", { withTimezone: true, mode: 'string' }),
	task: varchar({ length: 100 }),
	name: varchar({ length: 100 }),
	minutes: smallint(),
	cron: varchar({ length: 100 }),
	cluster: varchar({ length: 100 }),
	intendedDateKwarg: varchar("intended_date_kwarg", { length: 100 }),
}, (table) => [
	check("django_q_schedule_minutes_check", sql`minutes >= 0`),
]);

export const djangoQTask = pgTable("django_q_task", {
	name: varchar({ length: 100 }).notNull(),
	func: varchar({ length: 256 }).notNull(),
	hook: varchar({ length: 256 }),
	args: text(),
	kwargs: text(),
	result: text(),
	started: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	stopped: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	success: boolean().notNull(),
	id: varchar({ length: 32 }).primaryKey().notNull(),
	group: varchar({ length: 100 }),
	attemptCount: integer("attempt_count").notNull(),
	cluster: varchar({ length: 100 }),
}, (table) => [
	index("django_q_task_id_32882367_like").using("btree", table.id.asc().nullsLast().op("varchar_pattern_ops")),
	index("success_index").using("btree", table.group.asc().nullsLast().op("text_ops"), table.name.asc().nullsLast().op("text_ops"), table.func.asc().nullsLast().op("text_ops")).where(sql`success`),
]);

export const djangoQOrmq = pgTable("django_q_ormq", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "django_q_ormq_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	key: varchar({ length: 100 }).notNull(),
	payload: text().notNull(),
	lock: timestamp({ withTimezone: true, mode: 'string' }),
});

export const djangoSession = pgTable("django_session", {
	sessionKey: varchar("session_key", { length: 40 }).primaryKey().notNull(),
	sessionData: text("session_data").notNull(),
	expireDate: timestamp("expire_date", { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("django_session_expire_date_a5c62663").using("btree", table.expireDate.asc().nullsLast().op("timestamptz_ops")),
	index("django_session_session_key_c0390e0f_like").using("btree", table.sessionKey.asc().nullsLast().op("varchar_pattern_ops")),
]);

export const socialaccountSocialaccount = pgTable("socialaccount_socialaccount", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "socialaccount_socialaccount_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	provider: varchar({ length: 200 }).notNull(),
	uid: varchar({ length: 191 }).notNull(),
	lastLogin: timestamp("last_login", { withTimezone: true, mode: 'string' }).notNull(),
	dateJoined: timestamp("date_joined", { withTimezone: true, mode: 'string' }).notNull(),
	extraData: jsonb("extra_data").notNull(),
	userId: integer("user_id").notNull(),
}, (table) => [
	index("socialaccount_socialaccount_user_id_8146e70c").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [apiUser.id],
			name: "socialaccount_socialaccount_user_id_8146e70c_fk_api_user_id"
		}),
	unique("socialaccount_socialaccount_provider_uid_fc810c6e_uniq").on(table.provider, table.uid),
]);

export const socialaccountSocialappSites = pgTable("socialaccount_socialapp_sites", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "socialaccount_socialapp_sites_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	socialappId: integer("socialapp_id").notNull(),
	siteId: integer("site_id").notNull(),
}, (table) => [
	index("socialaccount_socialapp_sites_site_id_2579dee5").using("btree", table.siteId.asc().nullsLast().op("int4_ops")),
	index("socialaccount_socialapp_sites_socialapp_id_97fb6e7d").using("btree", table.socialappId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.socialappId],
			foreignColumns: [socialaccountSocialapp.id],
			name: "socialaccount_social_socialapp_id_97fb6e7d_fk_socialacc"
		}),
	foreignKey({
			columns: [table.siteId],
			foreignColumns: [djangoSite.id],
			name: "socialaccount_social_site_id_2579dee5_fk_django_si"
		}),
	unique("socialaccount_socialapp__socialapp_id_site_id_71a9a768_uniq").on(table.socialappId, table.siteId),
]);

export const djangoSite = pgTable("django_site", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "django_site_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	domain: varchar({ length: 100 }).notNull(),
	name: varchar({ length: 50 }).notNull(),
}, (table) => [
	index("django_site_domain_a2e37b91_like").using("btree", table.domain.asc().nullsLast().op("varchar_pattern_ops")),
	unique("django_site_domain_a2e37b91_uniq").on(table.domain),
]);

export const socialaccountSocialtoken = pgTable("socialaccount_socialtoken", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "socialaccount_socialtoken_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	token: text().notNull(),
	tokenSecret: text("token_secret").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
	accountId: integer("account_id").notNull(),
	appId: integer("app_id"),
}, (table) => [
	index("socialaccount_socialtoken_account_id_951f210e").using("btree", table.accountId.asc().nullsLast().op("int4_ops")),
	index("socialaccount_socialtoken_app_id_636a42d7").using("btree", table.appId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [socialaccountSocialaccount.id],
			name: "socialaccount_social_account_id_951f210e_fk_socialacc"
		}),
	foreignKey({
			columns: [table.appId],
			foreignColumns: [socialaccountSocialapp.id],
			name: "socialaccount_social_app_id_636a42d7_fk_socialacc"
		}),
	unique("socialaccount_socialtoken_app_id_account_id_fca4e0ac_uniq").on(table.accountId, table.appId),
]);

export const socialaccountSocialapp = pgTable("socialaccount_socialapp", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "socialaccount_socialapp_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	provider: varchar({ length: 30 }).notNull(),
	name: varchar({ length: 40 }).notNull(),
	clientId: varchar("client_id", { length: 191 }).notNull(),
	secret: varchar({ length: 191 }).notNull(),
	key: varchar({ length: 191 }).notNull(),
	providerId: varchar("provider_id", { length: 200 }).notNull(),
	settings: jsonb().notNull(),
});

export const tokenBlacklistOutstandingtoken = pgTable("token_blacklist_outstandingtoken", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity({ name: "token_blacklist_outstandingtoken_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	token: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	userId: integer("user_id"),
	jti: varchar({ length: 255 }).notNull(),
}, (table) => [
	index("token_blacklist_outstandingtoken_jti_hex_d9bdf6f7_like").using("btree", table.jti.asc().nullsLast().op("varchar_pattern_ops")),
	index("token_blacklist_outstandingtoken_user_id_83bc629a").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [apiUser.id],
			name: "token_blacklist_outs_user_id_83bc629a_fk_api_user_"
		}),
	unique("token_blacklist_outstandingtoken_jti_hex_d9bdf6f7_uniq").on(table.jti),
]);

export const tokenBlacklistBlacklistedtoken = pgTable("token_blacklist_blacklistedtoken", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity({ name: "token_blacklist_blacklistedtoken_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	blacklistedAt: timestamp("blacklisted_at", { withTimezone: true, mode: 'string' }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	tokenId: bigint("token_id", { mode: "number" }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.tokenId],
			foreignColumns: [tokenBlacklistOutstandingtoken.id],
			name: "token_blacklist_blacklistedtoken_token_id_3cc7fe56_fk"
		}),
	unique("token_blacklist_blacklistedtoken_token_id_key").on(table.tokenId),
]);
