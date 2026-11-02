DROP INDEX `idx_remote_photo_visible`;--> statement-breakpoint
ALTER TABLE `remote_photo` ADD `archived` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `remote_photo` ADD `is_screenshot` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `remote_photo` ADD `is_document` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_remote_photo_archived` ON `remote_photo` (`timestamp`) WHERE archived = 1 AND hidden = 0 AND in_trashcan = 0 AND removed = 0;--> statement-breakpoint
CREATE INDEX `idx_remote_photo_screenshot` ON `remote_photo` (`timestamp`) WHERE is_screenshot = 1 AND hidden = 0 AND in_trashcan = 0 AND removed = 0 AND archived = 0;--> statement-breakpoint
CREATE INDEX `idx_remote_photo_document` ON `remote_photo` (`timestamp`) WHERE is_document = 1 AND hidden = 0 AND in_trashcan = 0 AND removed = 0 AND archived = 0;--> statement-breakpoint
CREATE INDEX `idx_remote_photo_visible` ON `remote_photo` (`timestamp`,`id`) WHERE hidden = 0 AND in_trashcan = 0 AND removed = 0 AND archived = 0 AND timestamp IS NOT NULL;--> statement-breakpoint
-- Hand-written: re-pull every photo from cursor zero so a mirror seeded before
-- these columns existed learns which photos are archived, screenshots or
-- documents (the rows stay until the pull overwrites them).
UPDATE `sync_state` SET `cursor_id` = NULL, `cursor_modified` = NULL, `status` = 'idle', `progress_current` = 0, `progress_total` = 0 WHERE `entity` = 'photo';