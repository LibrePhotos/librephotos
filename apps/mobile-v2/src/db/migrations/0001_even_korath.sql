CREATE TABLE `app_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` integer
);
--> statement-breakpoint
ALTER TABLE `sync_log` ADD `op` text;--> statement-breakpoint
ALTER TABLE `sync_log` ADD `applied` integer;--> statement-breakpoint
ALTER TABLE `sync_log` ADD `deleted` integer;--> statement-breakpoint
ALTER TABLE `sync_log` ADD `duration_ms` integer;--> statement-breakpoint
ALTER TABLE `sync_log` ADD `cursor` text;--> statement-breakpoint
CREATE INDEX `idx_sync_log_ts` ON `sync_log` (`ts`);