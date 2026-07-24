ALTER TABLE `upload_queue` ADD `next_attempt_at` integer;--> statement-breakpoint
CREATE INDEX `idx_upload_queue_state` ON `upload_queue` (`state`);