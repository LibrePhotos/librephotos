CREATE TABLE `job_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`payload` text,
	`state` text DEFAULT 'pending' NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`last_error` text
);
--> statement-breakpoint
CREATE INDEX `idx_job_queue_ready` ON `job_queue` (`state`,`priority`,`next_attempt_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_job_queue_kind` ON `job_queue` (`kind`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_job_queue_dedupe` ON `job_queue` (`dedupe_key`) WHERE state IN ('pending', 'running');