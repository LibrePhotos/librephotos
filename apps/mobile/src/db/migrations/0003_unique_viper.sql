ALTER TABLE `outbox` ADD `inflight_at` integer;--> statement-breakpoint
ALTER TABLE `outbox` ADD `next_attempt_at` integer;--> statement-breakpoint
CREATE INDEX `idx_outbox_state` ON `outbox` (`state`);