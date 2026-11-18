CREATE TABLE `supervisor_decision` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`trigger_id` text NOT NULL,
	`message_id` text NOT NULL,
	`kind` text NOT NULL,
	`strength` text NOT NULL,
	`mode` text NOT NULL,
	`reason` text NOT NULL,
	`task_id` text,
	`tool_calls_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `supervisor_thread`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message_id`) REFERENCES `supervisor_message`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supervisor_decision_trigger_idx` ON `supervisor_decision` (`thread_id`,`trigger_id`);--> statement-breakpoint
CREATE INDEX `supervisor_decision_thread_idx` ON `supervisor_decision` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `supervisor_message` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`tool_calls_json` text,
	`meta_json` text,
	`trigger_id` text,
	`status` text DEFAULT 'ok' NOT NULL,
	`error_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `supervisor_thread`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supervisor_message_trigger_idx` ON `supervisor_message` (`thread_id`,`trigger_id`);--> statement-breakpoint
CREATE INDEX `supervisor_message_thread_idx` ON `supervisor_message` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `supervisor_thread` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`source` text DEFAULT 'supervisor-chat' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `supervisor_thread_workspace_idx` ON `supervisor_thread` (`workspace_id`,`updated_at`);--> statement-breakpoint
ALTER TABLE `task` ADD `origin_json` text;