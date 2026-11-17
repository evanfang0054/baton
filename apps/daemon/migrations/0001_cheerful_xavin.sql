CREATE TABLE `ws_event` (
	`ordinal` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ws_event_id_unique` ON `ws_event` (`id`);--> statement-breakpoint
CREATE INDEX `ws_event_ts_idx` ON `ws_event` (`ts`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_review` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`verdict` text,
	`verify_exit_code` integer,
	`verify_output` text,
	`diff_stat_json` text,
	`decided_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_review`("id", "task_id", "verdict", "verify_exit_code", "verify_output", "diff_stat_json", "decided_at") SELECT "id", "task_id", "verdict", "verify_exit_code", "verify_output", "diff_stat_json", "decided_at" FROM `review`;--> statement-breakpoint
DROP TABLE `review`;--> statement-breakpoint
ALTER TABLE `__new_review` RENAME TO `review`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `approval` ADD `request_id` text;--> statement-breakpoint
CREATE INDEX `approval_session_request_idx` ON `approval` (`session_id`,`request_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_event` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`ts` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_event`("id", "session_id", "ordinal", "seq", "type", "payload_json", "ts") SELECT "id", "session_id", ROW_NUMBER() OVER (ORDER BY "ts", "id"), "seq", "type", "payload_json", "ts" FROM `event`;--> statement-breakpoint
DROP TABLE `event`;--> statement-breakpoint
ALTER TABLE `__new_event` RENAME TO `event`;--> statement-breakpoint
CREATE UNIQUE INDEX `event_session_seq_idx` ON `event` (`session_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `event_ordinal_idx` ON `event` (`ordinal`);--> statement-breakpoint
PRAGMA foreign_keys=ON;