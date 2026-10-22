ALTER TABLE `upload_queue` ADD `server_photo_id` text;--> statement-breakpoint
ALTER TABLE `upload_queue` ADD `server_ready_at` integer;--> statement-breakpoint
UPDATE `upload_queue` SET `server_ready_at` = 0 WHERE `state` IN ('done', 'skipped_exists');