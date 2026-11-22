CREATE TABLE `supervisor_action` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`thread_id` text,
	`task_id` text,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`strength` text NOT NULL,
	`mode` text NOT NULL,
	`reason` text NOT NULL,
	`payload_json` text NOT NULL,
	`result_json` text,
	`policy_version` text NOT NULL,
	`mandate_version` text,
	`dedupe_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`applied_at` integer,
	`ignored_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supervisor_action_dedupe_idx` ON `supervisor_action` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `supervisor_action_status_idx` ON `supervisor_action` (`workspace_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `task_failure` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`task_id` text NOT NULL,
	`session_id` text,
	`attempt` integer NOT NULL,
	`stage` text NOT NULL,
	`last_error` text NOT NULL,
	`retryable` integer NOT NULL,
	`affected_paths_json` text,
	`summary` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `task_failure_task_idx` ON `task_failure` (`task_id`,`created_at`);