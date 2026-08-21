CREATE TABLE `auto_album` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`timestamp` integer,
	`favorited` integer DEFAULT false NOT NULL,
	`photo_count` integer DEFAULT 0 NOT NULL,
	`cover_hash` text,
	`last_modified` integer
);
--> statement-breakpoint
CREATE TABLE `auto_album_photo` (
	`album_id` integer NOT NULL,
	`photo_id` text NOT NULL,
	`ordering` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`album_id`, `photo_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_auto_album_photo_album` ON `auto_album_photo` (`album_id`,`ordering`);--> statement-breakpoint
CREATE TABLE `local_album` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`asset_count` integer,
	`modified_at` integer,
	`backup_selection` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `local_album_asset` (
	`album_id` text NOT NULL,
	`asset_id` text NOT NULL,
	PRIMARY KEY(`album_id`, `asset_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_local_album_asset_asset` ON `local_album_asset` (`asset_id`);--> statement-breakpoint
CREATE TABLE `local_asset` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`type` text,
	`created_at` integer,
	`modified_at` integer,
	`width` integer,
	`height` integer,
	`duration_ms` integer,
	`uri` text,
	`hash` text,
	`hashed_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_local_asset_hash` ON `local_asset` (`hash`);--> statement-breakpoint
CREATE INDEX `idx_local_asset_modified` ON `local_asset` (`modified_at`);--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer NOT NULL,
	`kind` text NOT NULL,
	`payload` text,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `person` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text,
	`kind` text,
	`face_count` integer,
	`cover_photo_hash` text,
	`last_modified` integer
);
--> statement-breakpoint
CREATE TABLE `place_album` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`photo_count` integer DEFAULT 0 NOT NULL,
	`geolocation_level` integer,
	`cover_hashes` text,
	`last_modified` integer
);
--> statement-breakpoint
CREATE TABLE `remote_photo` (
	`id` text PRIMARY KEY NOT NULL,
	`image_hash` text NOT NULL,
	`owner_id` integer NOT NULL,
	`timestamp` integer,
	`added_on` integer NOT NULL,
	`last_modified` integer NOT NULL,
	`type` text NOT NULL,
	`video_length_ms` integer,
	`rating` integer DEFAULT 0 NOT NULL,
	`is_favorite` integer DEFAULT false NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`in_trashcan` integer DEFAULT false NOT NULL,
	`removed` integer DEFAULT false NOT NULL,
	`is_public` integer DEFAULT false NOT NULL,
	`aspect_ratio` real,
	`latitude` real,
	`longitude` real,
	`search_location` text,
	`dominant_color` text,
	`bucket_day` text NOT NULL,
	`bucket_month` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_remote_photo_bucket_day` ON `remote_photo` (`bucket_day`);--> statement-breakpoint
CREATE INDEX `idx_remote_photo_timestamp` ON `remote_photo` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_remote_photo_image_hash` ON `remote_photo` (`image_hash`);--> statement-breakpoint
CREATE INDEX `idx_remote_photo_last_modified` ON `remote_photo` (`last_modified`);--> statement-breakpoint
CREATE INDEX `idx_remote_photo_favorite` ON `remote_photo` (`timestamp`) WHERE is_favorite = 1 AND hidden = 0 AND in_trashcan = 0 AND removed = 0;--> statement-breakpoint
CREATE INDEX `idx_remote_photo_hidden` ON `remote_photo` (`timestamp`) WHERE hidden = 1 AND removed = 0;--> statement-breakpoint
CREATE INDEX `idx_remote_photo_trash` ON `remote_photo` (`timestamp`) WHERE in_trashcan = 1 AND removed = 0;--> statement-breakpoint
CREATE INDEX `idx_remote_photo_visible` ON `remote_photo` (`timestamp`,`id`) WHERE hidden = 0 AND in_trashcan = 0 AND removed = 0 AND timestamp IS NOT NULL;--> statement-breakpoint
CREATE TABLE `remote_photo_detail` (
	`photo_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shared_from_me` (
	`photo_id` text NOT NULL,
	`shared_to_user_id` integer NOT NULL,
	PRIMARY KEY(`photo_id`, `shared_to_user_id`)
);
--> statement-breakpoint
CREATE TABLE `shared_user` (
	`id` integer PRIMARY KEY NOT NULL,
	`username` text,
	`first_name` text,
	`last_name` text,
	`avatar_url` text
);
--> statement-breakpoint
CREATE TABLE `sync_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`entity` text,
	`level` text DEFAULT 'info' NOT NULL,
	`message` text
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`entity` text PRIMARY KEY NOT NULL,
	`cursor_modified` integer,
	`cursor_id` text,
	`last_full_sync` integer,
	`status` text,
	`progress_current` integer DEFAULT 0 NOT NULL,
	`progress_total` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tag_album` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`photo_count` integer DEFAULT 0 NOT NULL,
	`cover_hashes` text,
	`last_modified` integer
);
--> statement-breakpoint
CREATE TABLE `thing_album` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`photo_count` integer DEFAULT 0 NOT NULL,
	`cover_hashes` text,
	`last_modified` integer
);
--> statement-breakpoint
CREATE TABLE `thumb_cache` (
	`photo_id` text PRIMARY KEY NOT NULL,
	`file_path` text NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`last_used` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_thumb_cache_last_used` ON `thumb_cache` (`last_used`);--> statement-breakpoint
CREATE TABLE `upload_queue` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`enqueued_at` integer
);
--> statement-breakpoint
CREATE TABLE `user_album` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`owner_id` integer,
	`shared` integer DEFAULT false NOT NULL,
	`favorited` integer DEFAULT false NOT NULL,
	`cover_hash` text,
	`photo_count` integer DEFAULT 0 NOT NULL,
	`created_on` integer,
	`last_modified` integer
);
--> statement-breakpoint
CREATE TABLE `user_album_photo` (
	`album_id` integer NOT NULL,
	`photo_id` text NOT NULL,
	`ordering` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`album_id`, `photo_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_user_album_photo_album` ON `user_album_photo` (`album_id`,`ordering`);