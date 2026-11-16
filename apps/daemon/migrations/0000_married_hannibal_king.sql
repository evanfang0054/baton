CREATE TABLE `approval` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`request_json` text NOT NULL,
	`decision` text,
	`decided_by` text,
	`decided_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`ts` integer NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`detail_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_ts_idx` ON `audit` (`ts`);--> statement-breakpoint
CREATE TABLE `canvas` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`viewport_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `edge` (
	`id` text PRIMARY KEY NOT NULL,
	`canvas_id` text NOT NULL,
	`source_id` text NOT NULL,
	`target_id` text NOT NULL,
	`type` text DEFAULT 'context' NOT NULL,
	FOREIGN KEY (`canvas_id`) REFERENCES `canvas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `node`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_id`) REFERENCES `node`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `event` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`ts` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_session_seq_idx` ON `event` (`session_id`,`seq`);--> statement-breakpoint
CREATE TABLE `node` (
	`id` text PRIMARY KEY NOT NULL,
	`canvas_id` text NOT NULL,
	`type` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`w` real DEFAULT 320 NOT NULL,
	`h` real DEFAULT 200 NOT NULL,
	`group_id` text,
	`data_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`canvas_id`) REFERENCES `canvas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `node_canvas_idx` ON `node` (`canvas_id`);--> statement-breakpoint
CREATE TABLE `notice` (
	`id` text PRIMARY KEY NOT NULL,
	`ts` integer NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`read_at` integer
);
--> statement-breakpoint
CREATE TABLE `review` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`verdict` text NOT NULL,
	`verify_exit_code` integer,
	`verify_output` text,
	`diff_stat_json` text,
	`decided_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`adapter` text NOT NULL,
	`engine_session_id` text,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `task` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`node_id` text,
	`title` text NOT NULL,
	`prompt` text NOT NULL,
	`status` text NOT NULL,
	`engine` text NOT NULL,
	`workspace_mode` text DEFAULT 'main' NOT NULL,
	`branch` text,
	`worktree_path` text,
	`verify_command` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`node_id`) REFERENCES `node`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `task_status_idx` ON `task` (`status`);--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`rel_path` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_rel_path_unique` ON `workspace` (`rel_path`);