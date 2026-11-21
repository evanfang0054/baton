CREATE TABLE `acceptance_contract` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`created_by` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`truncated` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`frozen_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `acceptance_contract_task_version_idx` ON `acceptance_contract` (`task_id`,`version`);--> statement-breakpoint
CREATE INDEX `acceptance_contract_task_status_idx` ON `acceptance_contract` (`task_id`,`status`);--> statement-breakpoint
CREATE TABLE `acceptance_item` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`text` text NOT NULL,
	`status` text NOT NULL,
	`evidence` text,
	`source` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `acceptance_contract`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `acceptance_item_contract_ordinal_idx` ON `acceptance_item` (`contract_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `acceptance_item_contract_idx` ON `acceptance_item` (`contract_id`);--> statement-breakpoint
CREATE TABLE `acceptance_run` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`contract_id` text NOT NULL,
	`review_id` text NOT NULL,
	`verifier_task_id` text,
	`status` text NOT NULL,
	`verdict` text,
	`summary` text,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contract_id`) REFERENCES `acceptance_contract`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_id`) REFERENCES `review`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `acceptance_run_review_idx` ON `acceptance_run` (`review_id`);--> statement-breakpoint
CREATE INDEX `acceptance_run_task_created_idx` ON `acceptance_run` (`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `acceptance_run_contract_idx` ON `acceptance_run` (`contract_id`);--> statement-breakpoint
ALTER TABLE `task` ADD `budget_usd` real;